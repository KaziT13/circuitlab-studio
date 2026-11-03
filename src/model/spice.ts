// SPICE netlist export and import.

import { Circuit, Component, CompType, newId, Point, Wire } from './types';
import { DEFS, terminalPositions } from './library';
import { buildNetlist } from '../engine/netlist';

const fmt = (v: number) => {
  const a = Math.abs(v);
  const table: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'Meg'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ];
  if (v === 0) return '0';
  for (const [s, p] of table) if (a >= s * 0.9999) return `${parseFloat((v / s).toPrecision(6))}${p}`;
  return v.toExponential(4);
};

export function exportSpice(c: Circuit, opts: { tstop?: number; tstep?: number } = {}): string {
  const nl = buildNetlist(c);
  const name = (i: number) => (i === 0 ? '0' : nl.netNames[i]);
  const lines: string[] = [`* ${c.name} — exported by Ohmlab`, `* ${new Date().toISOString()}`];
  const models = new Set<string>();
  const label = (prefix: string, comp: Component) => (comp.label.toUpperCase().startsWith(prefix) ? comp.label : `${prefix}${comp.label}`);
  for (const comp of c.components) {
    const n = nl.compNodes.get(comp.id)!.map(name);
    const p = comp.props;
    switch (comp.type) {
      case 'resistor':
        lines.push(`${label('R', comp)} ${n[0]} ${n[1]} ${fmt(Number(p.resistance))}`);
        break;
      case 'bulb':
        lines.push(`${label('R', comp)} ${n[0]} ${n[1]} ${fmt(Number(p.ratedVoltage) ** 2 / Number(p.ratedPower))} ; lamp ${p.ratedVoltage}V/${p.ratedPower}W`);
        break;
      case 'capacitor':
        lines.push(`${label('C', comp)} ${n[0]} ${n[1]} ${fmt(Number(p.capacitance))}${Number(p.initialVoltage) ? ` IC=${fmt(Number(p.initialVoltage))}` : ''}`);
        break;
      case 'inductor':
        lines.push(`${label('L', comp)} ${n[0]} ${n[1]} ${fmt(Number(p.inductance))}${Number(p.initialCurrent) ? ` IC=${fmt(Number(p.initialCurrent))}` : ''}`);
        break;
      case 'dcsource':
      case 'battery': {
        const r = Number(p.internalResistance);
        if (r > 0) {
          const mid = `${comp.label}_int`;
          lines.push(`${label('V', comp)} ${mid} ${n[1]} DC ${fmt(Number(p.voltage))}`);
          lines.push(`R${comp.label}_int ${n[0]} ${mid} ${fmt(r)}`);
        } else lines.push(`${label('V', comp)} ${n[0]} ${n[1]} DC ${fmt(Number(p.voltage))}`);
        break;
      }
      case 'acsource': {
        const r = Number(p.internalResistance);
        const src = `SIN(${fmt(Number(p.offset))} ${fmt(Number(p.amplitude))} ${fmt(Number(p.frequency))} 0 0 ${Number(p.phase)}) AC ${fmt(Number(p.amplitude))}`;
        if (r > 0) {
          const mid = `${comp.label}_int`;
          lines.push(`${label('V', comp)} ${mid} ${n[1]} ${src}`);
          lines.push(`R${comp.label}_int ${n[0]} ${mid} ${fmt(r)}`);
        } else lines.push(`${label('V', comp)} ${n[0]} ${n[1]} ${src}`);
        break;
      }
      case 'diode':
        models.add(`.model D_${comp.label} D(Is=${fmt(Number(p.saturationCurrent))} N=${Number(p.emission)})`);
        lines.push(`${label('D', comp)} ${n[0]} ${n[1]} D_${comp.label}`);
        break;
      case 'led': {
        const nVt = 2 * 0.025852;
        const is = 0.02 / (Math.exp(Number(p.forwardVoltage) / nVt) - 1);
        models.add(`.model LED_${comp.label} D(Is=${is.toExponential(4)} N=2) ; ${p.color} LED`);
        lines.push(`${label('D', comp)} ${n[0]} ${n[1]} LED_${comp.label}`);
        break;
      }
      case 'npn':
        models.add(`.model Q_${comp.label} NPN(Is=${fmt(Number(p.saturationCurrent))} BF=${p.beta} BR=${p.betaR})`);
        lines.push(`${label('Q', comp)} ${n[1]} ${n[0]} ${n[2]} Q_${comp.label}`);
        break;
      case 'switch':
        lines.push(`${label('R', comp)} ${n[0]} ${n[1]} ${p.closed ? fmt(Number(p.onResistance)) : '1T'} ; switch ${p.closed ? 'closed' : 'open'}`);
        break;
      case 'pushbutton':
        lines.push(`${label('R', comp)} ${n[0]} ${n[1]} 1T ; push button (released)`);
        break;
      case 'spdt': {
        const a = p.position !== 'B';
        lines.push(`R${comp.label}_A ${n[0]} ${n[2]} ${a ? fmt(Number(p.onResistance)) : '1T'} ; SPDT throw A`);
        lines.push(`R${comp.label}_B ${n[1]} ${n[2]} ${a ? '1T' : fmt(Number(p.onResistance))} ; SPDT throw B`);
        break;
      }
      case 'ammeter':
        lines.push(`V${comp.label} ${n[0]} ${n[1]} DC 0 ; ammeter`);
        break;
      case 'voltmeter':
        lines.push(`* voltmeter ${comp.label}: V(${n[0]}) - V(${n[1]})`);
        break;
      case 'ground':
        break;
    }
  }
  lines.push(...models);
  lines.push('.op');
  if (opts.tstop) lines.push(`.tran ${fmt(opts.tstep ?? opts.tstop / 1000)} ${fmt(opts.tstop)}`);
  lines.push('.end');
  return lines.join('\n');
}

const SUFFIX: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

export function parseSpiceValue(s: string): number {
  const m = s.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(meg|mil|[tgkmunpf])?/i);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  return m[2] ? v * SUFFIX[m[2].toLowerCase()] : v;
}

interface ParsedEl {
  type: CompType;
  label: string;
  nodes: string[]; // ordered as Ohmlab terminals
  props: Record<string, number | string | boolean>;
}

export interface ImportResult {
  circuit: Circuit;
  warnings: string[];
}

export function importSpice(text: string): ImportResult {
  const warnings: string[] = [];
  // join continuation lines
  const raw = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const l of raw) {
    const t = l.replace(/;.*$/, '').trim();
    if (!t) continue;
    if (t.startsWith('+') && lines.length) lines[lines.length - 1] += ' ' + t.slice(1);
    else lines.push(t);
  }
  const models = new Map<string, { kind: string; params: Record<string, number> }>();
  for (const l of lines) {
    const m = l.match(/^\.model\s+(\S+)\s+(\w+)\s*\(?([^)]*)\)?/i);
    if (m) {
      const params: Record<string, number> = {};
      for (const kv of m[3].matchAll(/(\w+)\s*=\s*([^\s,]+)/g)) params[kv[1].toLowerCase()] = parseSpiceValue(kv[2]);
      models.set(m[1].toLowerCase(), { kind: m[2].toUpperCase(), params });
    }
  }
  const els: ParsedEl[] = [];
  lines.forEach((l, idx) => {
    if (idx === 0 && !/^[rclvdqi]\S*\s+\S+\s+\S+/i.test(l)) return; // title line
    if (l.startsWith('*') || l.startsWith('.')) return;
    const tok = l.split(/\s+/);
    const name = tok[0];
    const kind = name[0].toUpperCase();
    const val = (i: number) => parseSpiceValue(tok[i] ?? '');
    try {
      switch (kind) {
        case 'R':
          els.push({ type: 'resistor', label: name, nodes: [tok[1], tok[2]], props: { resistance: val(3) } });
          break;
        case 'C': {
          const ic = l.match(/ic\s*=\s*(\S+)/i);
          els.push({ type: 'capacitor', label: name, nodes: [tok[1], tok[2]], props: { capacitance: val(3), initialVoltage: ic ? parseSpiceValue(ic[1]) : 0 } });
          break;
        }
        case 'L': {
          const ic = l.match(/ic\s*=\s*(\S+)/i);
          els.push({ type: 'inductor', label: name, nodes: [tok[1], tok[2]], props: { inductance: val(3), initialCurrent: ic ? parseSpiceValue(ic[1]) : 0 } });
          break;
        }
        case 'V': {
          const rest = tok.slice(3).join(' ');
          const sin = rest.match(/sin\s*\(([^)]*)\)/i);
          if (sin) {
            const a = sin[1].trim().split(/[\s,]+/).map(parseSpiceValue);
            els.push({
              type: 'acsource',
              label: name,
              nodes: [tok[1], tok[2]],
              props: { offset: a[0] || 0, amplitude: a[1] || 0, frequency: a[2] || 60, phase: a[5] || 0, internalResistance: 0 },
            });
          } else {
            const dc = rest.match(/dc\s+(\S+)/i);
            const v = dc ? parseSpiceValue(dc[1]) : parseSpiceValue(tok[3] ?? '0');
            if (/pulse|pwl|exp/i.test(rest)) warnings.push(`${name}: PULSE/PWL/EXP sources are not supported — imported as DC ${v || 0} V.`);
            const isAmmeter = (v || 0) === 0;
            els.push(
              isAmmeter
                ? { type: 'ammeter', label: name, nodes: [tok[1], tok[2]], props: {} }
                : { type: 'dcsource', label: name, nodes: [tok[1], tok[2]], props: { voltage: v || 0, internalResistance: 0 } },
            );
          }
          break;
        }
        case 'D': {
          const m = models.get((tok[3] ?? '').toLowerCase());
          const isLed = /led/i.test(tok[3] ?? '') || (m?.params.n ?? 1) >= 1.8;
          if (isLed) {
            const is = m?.params.is ?? 2e-18;
            const nVt = (m?.params.n ?? 2) * 0.025852;
            const vf = nVt * Math.log(0.02 / is + 1);
            els.push({ type: 'led', label: name, nodes: [tok[1], tok[2]], props: { color: 'red', forwardVoltage: +vf.toFixed(3), maxCurrent: 0.03 } });
          } else {
            els.push({
              type: 'diode',
              label: name,
              nodes: [tok[1], tok[2]],
              props: { saturationCurrent: m?.params.is ?? 1e-14, emission: m?.params.n ?? 1, maxCurrent: 1 },
            });
          }
          break;
        }
        case 'Q': {
          const m = models.get((tok[4] ?? '').toLowerCase());
          if (m && m.kind === 'PNP') warnings.push(`${name}: PNP transistors are not supported — imported as NPN.`);
          els.push({
            type: 'npn',
            label: name,
            nodes: [tok[2], tok[1], tok[3]], // B, C, E
            props: { beta: m?.params.bf ?? 100, betaR: m?.params.br ?? 1, saturationCurrent: m?.params.is ?? 1e-14 },
          });
          break;
        }
        default:
          warnings.push(`Line skipped (unsupported element "${name}"): ${l}`);
      }
    } catch {
      warnings.push(`Could not parse: ${l}`);
    }
  });
  for (const e of els) {
    for (const [k, v] of Object.entries(e.props))
      if (typeof v === 'number' && !Number.isFinite(v)) {
        warnings.push(`${e.label}: invalid value for ${k}, using default.`);
        e.props[k] = DEFS[e.type].defaults[k];
      }
  }
  if (!els.length) throw new Error('No supported elements found in the netlist.');
  return { circuit: layoutSchematic(els), warnings };
}

/** Auto-place: components in rows, every net drawn as a horizontal bus below with vertical drops. */
function layoutSchematic(els: ParsedEl[]): Circuit {
  const comps: Component[] = [];
  const termNet: { p: Point; net: string }[] = [];
  // one row: every terminal gets a unique x (≡ 20 mod 40), so vertical drops never touch other terminals
  const perRow = Number.POSITIVE_INFINITY;
  const pitchX = 160;
  const pitchY = 160;
  els.forEach((e, i) => {
    const row = Number.isFinite(perRow) ? Math.floor(i / perRow) : 0;
    const col = Number.isFinite(perRow) ? i % perRow : i;
    const vertical = e.type === 'dcsource' || e.type === 'acsource';
    const rot = vertical ? 90 : e.type === 'npn' ? 90 : 0;
    const comp: Component = {
      id: newId(e.type),
      type: e.type,
      x: 100 + col * pitchX,
      y: 100 + row * pitchY,
      rot,
      label: e.label,
      props: { ...DEFS[e.type].defaults, ...e.props },
    };
    comps.push(comp);
    terminalPositions(comp).forEach((p, k) => termNet.push({ p, net: e.nodes[k] }));
  });
  const isGround = (n: string) => n === '0' || n.toLowerCase() === 'gnd';
  // ground bus last so its symbol hangs below every other bus
  const nets = [...new Set(termNet.map((t) => t.net))].sort((a, b) => Number(isGround(a)) - Number(isGround(b)));
  const maxY = Math.max(...termNet.map((t) => t.p.y));
  const wires: Wire[] = [];
  nets.forEach((net, i) => {
    const pts = termNet.filter((t) => t.net === net);
    const busY = maxY + 60 + i * 20;
    if (pts.length === 1 && !isGround(net)) {
      return; // dangling terminal
    }
    for (const t of pts) wires.push({ id: newId('w'), points: [t.p, { x: t.p.x, y: busY }] });
    const xs = pts.map((t) => t.p.x);
    let minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (isGround(net)) {
      const gx = minX - 20; // ≡ 0 mod 40: off the terminal lattice
      wires.push({ id: newId('w'), points: [{ x: gx, y: busY }, { x: minX, y: busY }] });
      comps.push({ id: newId('ground'), type: 'ground', x: gx, y: busY + 20, rot: 0, label: 'GND', props: {} });
      minX = gx;
    }
    // split the bus at every drop so drops connect at bus vertices
    const stops = [...new Set([minX, ...xs, maxX])].sort((a, b) => a - b);
    if (stops.length >= 2) wires.push({ id: newId('w'), points: stops.map((x) => ({ x, y: busY })) });
  });
  return { name: 'Imported SPICE netlist', components: comps, wires };
}
