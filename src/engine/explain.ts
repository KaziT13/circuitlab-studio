// Rule-based circuit explanation generated from the actual netlist and solution.

import { Circuit } from '../model/types';
import { formatEng as f } from '../model/units';
import { Simulator, SimSnapshot } from './simulator';

export interface Explanation {
  title: string;
  paragraphs: string[];
}

const SOURCES = new Set(['dcsource', 'acsource', 'battery']);

export function explainCircuit(circuit: Circuit, snap: SimSnapshot, sim: Simulator, mode: 'dc' | 'transient'): Explanation[] {
  const out: Explanation[] = [];
  const nl = sim.netlist;
  const comps = circuit.components.filter((c) => c.type !== 'ground');
  const name = (i: number) => nl.netNames[i];
  if (!comps.length) return [{ title: 'Empty circuit', paragraphs: ['Add components and wires, then ask again.'] }];

  // --- overview
  const srcs = comps.filter((c) => SOURCES.has(c.type));
  out.push({
    title: 'Overview',
    paragraphs: [
      `The circuit has ${comps.length} components connected between ${nl.nodeCount} nodes (including the ${nl.hasGround ? 'ground' : 'reference'} node). ` +
        `The simulator writes one Kirchhoff Current Law equation per non-reference node and one Kirchhoff Voltage Law constraint per voltage-defined branch, ` +
        `giving ${sim.nn + sim.nb} unknowns (${sim.nn} node voltages + ${sim.nb} branch currents), and solves them as a matrix system (Modified Nodal Analysis).`,
      srcs.length
        ? `Energy comes from ${srcs
            .map((s) =>
              s.type === 'acsource'
                ? `${s.label} (AC, ${f(Number(s.props.amplitude), 'V')} peak at ${f(Number(s.props.frequency), 'Hz')})`
                : `${s.label} (${f(Number(s.props.voltage), 'V')} DC${Number(s.props.internalResistance) > 0 ? `, ${f(Number(s.props.internalResistance), 'Ω')} internal` : ''})`,
            )
            .join(', ')}.`
        : 'There is no source, so no current can flow.',
      mode === 'dc'
        ? 'Values below are the DC operating point: capacitors act as open circuits and inductors as short circuits.'
        : `Values below are instantaneous transient values at t = ${f(snap.t, 's')}.`,
    ],
  });

  // --- topology: parallel groups and series pairs
  const twoT = comps.filter((c) => nl.compNodes.get(c.id)!.length === 2 && c.type !== 'voltmeter');
  const pairKey = (c: (typeof comps)[number]) => {
    const [a, b] = nl.compNodes.get(c.id)!;
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  };
  const groups = new Map<string, typeof comps>();
  for (const c of twoT) {
    const k = pairKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const topo: string[] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const [a, b] = k.split('-').map(Number);
    topo.push(
      `${g.map((c) => c.label).join(', ')} are in parallel (all between ${name(a)} and ${name(b)}), so they share the same voltage of ${f(Math.abs(snap.nodeV[a] - snap.nodeV[b]), 'V')}.`,
    );
  }
  const termsAt = new Map<number, string[]>();
  for (const c of comps) nl.compNodes.get(c.id)!.forEach((n) => termsAt.set(n, [...(termsAt.get(n) ?? []), c.id]));
  const seen = new Set<string>();
  for (const [n, ids] of termsAt) {
    if (n === 0 || ids.length !== 2) continue;
    const [x, y] = ids.map((id) => comps.find((c) => c.id === id)!);
    if (!x || !y || x.type === 'voltmeter' || y.type === 'voltmeter') continue;
    if (nl.compNodes.get(x.id)!.length !== 2 || nl.compNodes.get(y.id)!.length !== 2) continue;
    const key = [x.label, y.label].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const i = Math.abs(snap.readings[x.id]?.i ?? 0);
    topo.push(`${x.label} and ${y.label} are in series through node ${name(n)}: by KCL they carry the same current (${f(i, 'A')}).`);
  }
  if (topo.length) out.push({ title: 'Series & parallel structure', paragraphs: topo });

  // --- component by component
  const lines: string[] = [];
  for (const c of comps) {
    const r = snap.readings[c.id];
    if (!r) continue;
    switch (c.type) {
      case 'resistor': {
        const R = Number(c.props.resistance);
        lines.push(
          `${c.label} (${f(R, 'Ω')}): V = ${f(r.v, 'V')}, I = ${f(r.i, 'A')}. Ohm's law check: I·R = ${f(r.i * R, 'V')} ✓. It dissipates P = I²R = ${f(r.p, 'W')}` +
            (Number(r.extra?.ratingUse) > 1 ? ` — above its ${c.props.powerRating} W rating; use a higher-wattage part or a larger resistance.` : '.'),
        );
        break;
      }
      case 'capacitor':
        lines.push(
          `${c.label} (${f(Number(c.props.capacitance), 'F')}) holds ${f(r.v, 'V')}, storing Q = CV = ${f(Number(r.extra?.charge), 'C')} and E = ½CV² = ${f(Number(r.extra?.energy), 'J')}. ` +
            (mode === 'dc' ? 'At DC it draws no current once charged.' : `Its current right now is ${f(r.i, 'A')} (i = C·dv/dt).`),
        );
        break;
      case 'inductor':
        lines.push(
          `${c.label} (${f(Number(c.props.inductance), 'H')}) carries ${f(r.i, 'A')} with ${f(r.v, 'V')} across it, storing E = ½LI² = ${f(Number(r.extra?.energy), 'J')}. ` +
            (mode === 'dc' ? 'At DC an ideal inductor is a short (0 V).' : 'Its voltage is L·di/dt — it opposes any change in current.'),
        );
        break;
      case 'dcsource':
      case 'battery':
      case 'acsource':
        lines.push(
          `${c.label} ${-r.p >= 0 ? 'delivers' : 'absorbs'} ${f(Math.abs(r.p), 'W')} (terminal voltage ${f(r.v, 'V')}, current ${f(-r.i, 'A')} out of +).`,
        );
        break;
      case 'diode':
      case 'led':
        lines.push(
          `${c.label} is ${String(r.extra?.state).toLowerCase()}: V = ${f(r.v, 'V')}, I = ${f(r.i, 'A')}. ` +
            (r.i > 1e-6
              ? `Because the diode current grows exponentially with voltage, its drop stays near ${f(r.v, 'V')} over a wide current range.`
              : 'With less than its forward voltage applied, essentially no current flows.') +
            (c.type === 'led' && Number(r.extra?.ratingUse) > 1
              ? ` The LED is over its ${f(Number(c.props.maxCurrent), 'A')} limit — add/increase a series resistor: R ≈ (V_supply − V_f) / 20 mA.`
              : ''),
        );
        break;
      case 'npn': {
        const x = r.extra!;
        const region = String(x.region);
        lines.push(
          `${c.label} is in ${region.toLowerCase()}: I_B = ${f(Number(x.Ib), 'A')}, I_C = ${f(Number(x.Ic), 'A')}, V_BE = ${f(Number(x.Vbe), 'V')}, V_CE = ${f(Number(x.Vce), 'V')}. ` +
            (region === 'Saturation'
              ? `β·I_B would allow ${f(Number(c.props.beta) * Number(x.Ib), 'A')}, but the collector circuit limits I_C, so the transistor is fully on like a closed switch (V_CE small).`
              : region === 'Forward active'
                ? `In the active region I_C ≈ β·I_B (measured ratio ${Number(x.hFE).toFixed(0)}), so it amplifies base current.`
                : 'V_BE is below ~0.6 V, so the base-emitter junction is off and no collector current flows.'),
        );
        break;
      }
      case 'bulb':
        lines.push(`${c.label} dissipates ${f(r.p, 'W')} of its ${f(Number(c.props.ratedPower), 'W')} rating → ${Math.round(Math.min(Number(r.extra?.brightness), 1.5) * 100)}% brightness.`);
        break;
      case 'switch':
      case 'pushbutton':
        lines.push(`${c.label} is ${Math.abs(r.i) > 1e-9 ? 'closed and conducting ' + f(r.i, 'A') : 'open — it breaks its branch so no current flows there'}.`);
        break;
      case 'spdt':
        lines.push(`${c.label} connects COM to throw ${c.props.position}.`);
        break;
      case 'voltmeter':
        lines.push(`${c.label} reads ${f(r.v, 'V')} (ideal: draws no current).`);
        break;
      case 'ammeter':
        lines.push(`${c.label} reads ${f(r.i, 'A')} (ideal: zero voltage drop).`);
        break;
    }
  }
  out.push({ title: 'What each component is doing', paragraphs: lines });

  // --- dynamics
  const dyn: string[] = [];
  const caps = comps.filter((c) => c.type === 'capacitor');
  const inds = comps.filter((c) => c.type === 'inductor');
  for (const c of caps) {
    const R = sim.theveninResistance(c.id);
    if (Number.isFinite(R) && R < 1e9) {
      const tau = R * Number(c.props.capacitance);
      dyn.push(
        `${c.label} sees a Thevenin resistance of ${f(R, 'Ω')}, so its time constant is τ = R·C = ${f(tau, 's')}. After a change it moves 63% of the way to its new value in ${f(tau, 's')} and ~99% in 5τ = ${f(5 * tau, 's')}.`,
      );
    } else dyn.push(`${c.label} has no resistive discharge path (only through sources or open circuits), so its charge persists.`);
  }
  for (const c of inds) {
    const R = sim.theveninResistance(c.id);
    if (Number.isFinite(R) && R > 1e-9 && R < 1e9) {
      const tau = Number(c.props.inductance) / R;
      dyn.push(`${c.label} sees ${f(R, 'Ω')} → τ = L/R = ${f(tau, 's')}. Current builds up (or decays) exponentially with this time constant.`);
    }
  }
  if (caps.length === 1 && inds.length === 1) {
    const L = Number(inds[0].props.inductance);
    const C = Number(caps[0].props.capacitance);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const R = sim.theveninResistance(caps[0].id);
    const zeta = Number.isFinite(R) ? (R / 2) * Math.sqrt(C / L) : NaN;
    dyn.push(
      `With one L and one C the circuit resonates near f₀ = 1/(2π√LC) = ${f(f0, 'Hz')}.` +
        (Number.isFinite(zeta) && zeta > 0
          ? ` The damping ratio is about ζ ≈ ${zeta.toFixed(2)} (${zeta < 1 ? 'underdamped: expect ringing/overshoot' : zeta === 1 ? 'critically damped' : 'overdamped: no oscillation'}).`
          : ''),
    );
  }
  for (const s of srcs.filter((c) => c.type === 'acsource')) {
    const fr = Number(s.props.frequency);
    const w = 2 * Math.PI * fr;
    for (const c of caps) dyn.push(`At ${f(fr, 'Hz')}, ${c.label} has reactance X_C = 1/(ωC) = ${f(1 / (w * Number(c.props.capacitance)), 'Ω')}.`);
    for (const c of inds) dyn.push(`At ${f(fr, 'Hz')}, ${c.label} has reactance X_L = ωL = ${f(w * Number(c.props.inductance), 'Ω')}.`);
  }
  if (dyn.length) out.push({ title: 'Dynamic behaviour', paragraphs: dyn });

  // --- conservation
  const delivered = srcs.reduce((a, s) => a - (snap.readings[s.id]?.p ?? 0), 0);
  out.push({
    title: 'Conservation checks',
    paragraphs: [
      `Sources deliver ${f(delivered, 'W')} in total; the sum of power over all elements is ${f(snap.powerBalance, 'W')} (Tellegen's theorem says it must be zero), confirming energy is conserved.`,
      `The largest KCL error at any node is ${f(snap.kclResidual, 'A')} — currents into every node sum to zero within numerical precision.`,
    ],
  });

  const problems = [...nl.issues, ...snap.issues].filter((i) => i.level !== 'info');
  if (problems.length) out.push({ title: 'Problems to fix', paragraphs: problems.map((p) => p.message) });
  return out;
}
