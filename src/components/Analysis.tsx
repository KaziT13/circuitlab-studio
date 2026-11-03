import { useMemo, useState } from 'react';
import { BottomTab, useStore } from '../state/store';
import { Simulator } from '../engine/simulator';
import { formatEng, parseEng } from '../model/units';
import { Plot } from './Plot';
import { Scope } from './Scope';
import { Tutor } from './Tutor';
import { exportSpice, importSpice } from '../model/spice';
import { download } from './Toolbar';
import { stopSim } from '../state/runtime';
import { fitView } from './Canvas';

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'scope', label: 'Oscilloscope / Graphs' },
  { id: 'dc', label: 'DC Operating Point' },
  { id: 'ac', label: 'AC Analysis' },
  { id: 'calc', label: "Ohm's Law Calculator" },
  { id: 'tutor', label: 'AI Tutor' },
  { id: 'spice', label: 'SPICE Netlist' },
];

export function BottomPanel() {
  const tab = useStore((s) => s.bottomTab);
  const open = useStore((s) => s.bottomOpen);
  const set = useStore((s) => s.set);
  return (
    <section className={`bottom ${open ? 'open' : 'closed'}`}>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id && open ? 'on' : ''} onClick={() => set({ bottomTab: t.id, bottomOpen: true })}>
            {t.label}
          </button>
        ))}
        <div className="tb-spacer" />
        <button className="icon" onClick={() => set({ bottomOpen: !open })} title={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="tab-body">
          {tab === 'scope' && <Scope />}
          {tab === 'dc' && <DcPanel />}
          {tab === 'ac' && <AcPanel />}
          {tab === 'calc' && <OhmCalc />}
          {tab === 'tutor' && <Tutor />}
          {tab === 'spice' && <SpicePanel />}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ DC

function DcPanel() {
  const circuit = useStore((s) => s.circuit);
  const pressed = useStore((s) => s.pressed);
  const result = useMemo(() => {
    const sim = new Simulator(circuit, new Set(Object.keys(pressed)));
    const r = sim.solveDC();
    return { sim, r, snap: r.ok ? sim.snapshot() : null };
  }, [circuit, pressed]);
  const { sim, r, snap } = result;
  if (!circuit.components.length) return <div className="pad muted">Build a circuit to compute its DC operating point.</div>;
  return (
    <div className="pad dc-panel">
      <div className="muted small">
        Nonlinear DC solution by Modified Nodal Analysis + Newton–Raphson ({r.iterations ?? 0} iteration{r.iterations === 1 ? '' : 's'}). Capacitors are open
        circuits, inductors are short circuits and AC sources contribute only their DC offset. Recomputed automatically on every edit.
      </div>
      {!r.ok && <div className="issue error">{r.error}</div>}
      {snap && (
        <div className="dc-grid">
          <table className="data">
            <thead>
              <tr>
                <th>Node</th>
                <th>Voltage</th>
              </tr>
            </thead>
            <tbody>
              {snap.nodeV.map((v, i) => (
                <tr key={i}>
                  <td>{sim.netlist.netNames[i]}</td>
                  <td className="mono">{formatEng(v, 'V', 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data">
            <thead>
              <tr>
                <th>Component</th>
                <th>Voltage</th>
                <th>Current</th>
                <th>Power</th>
                <th>R = V/I</th>
              </tr>
            </thead>
            <tbody>
              {circuit.components
                .filter((c) => c.type !== 'ground')
                .map((c) => {
                  const rd = snap.readings[c.id];
                  const isSrc = c.type === 'dcsource' || c.type === 'acsource' || c.type === 'battery';
                  return (
                    <tr key={c.id} onClick={() => useStore.getState().set({ selection: { kind: 'comp', id: c.id } })} className="clickable">
                      <td>{c.label}</td>
                      <td className="mono">{c.type === 'ammeter' ? '—' : formatEng(rd.v, 'V', 4)}</td>
                      <td className="mono">{c.type === 'voltmeter' ? '—' : formatEng(isSrc ? -rd.i : rd.i, 'A', 4)}</td>
                      <td className="mono">{c.type === 'voltmeter' || c.type === 'ammeter' ? '—' : isSrc ? `${formatEng(-rd.p, 'W', 4)} out` : formatEng(rd.p, 'W', 4)}</td>
                      <td className="mono">{c.type === 'resistor' || c.type === 'bulb' ? formatEng(Math.abs(rd.v / rd.i), 'Ω', 4) : '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div className="checks">
            <div className="section-title">Verification</div>
            <div className="kv-line">
              <span>KCL — max node current residual</span>
              <b className="mono ok">{formatEng(snap.kclResidual, 'A')}</b>
            </div>
            <div className="kv-line">
              <span>Tellegen — Σ power (should be 0)</span>
              <b className="mono ok">{formatEng(snap.powerBalance, 'W')}</b>
            </div>
            <div className="kv-line">
              <span>Total power delivered by sources</span>
              <b className="mono">
                {formatEng(
                  circuit.components
                    .filter((c) => ['dcsource', 'acsource', 'battery'].includes(c.type))
                    .reduce((a, c) => a - snap.readings[c.id].p, 0),
                  'W',
                )}
              </b>
            </div>
            <div className="kv-line">
              <span>Unknowns solved (nodes + branch currents)</span>
              <b className="mono">
                {sim.nn} + {sim.nb}
              </b>
            </div>
            {snap.issues.map((i, k) => (
              <div key={k} className={`issue ${i.level}`}>
                {i.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ AC

const deg = (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI;

function AcPanel() {
  const circuit = useStore((s) => s.circuit);
  const pressed = useStore((s) => s.pressed);
  const acSrc = circuit.components.find((c) => c.type === 'acsource');
  const [fText, setFText] = useState('');
  const freq = parseEng(fText) > 0 ? parseEng(fText) : Number(acSrc?.props.frequency ?? 1000);
  const [f0, setF0] = useState('10');
  const [f1, setF1] = useState('100k');
  const [probe, setProbe] = useState('');
  const [db, setDb] = useState(true);

  const sim = useMemo(() => new Simulator(circuit, new Set(Object.keys(pressed))), [circuit, pressed]);
  const res = useMemo(() => sim.solveAC(freq), [sim, freq]);
  const probes = useMemo(() => {
    const out: { key: string; name: string; unit: string }[] = [];
    for (let i = 1; i < sim.netlist.nodeCount; i++) out.push({ key: `n:${i}`, name: `V(${sim.netlist.netNames[i]})`, unit: 'V' });
    for (const c of circuit.components) {
      if (c.type === 'ground') continue;
      if (c.type !== 'ammeter') out.push({ key: `v:${c.id}`, name: `V(${c.label})`, unit: 'V' });
      if (c.type !== 'voltmeter') out.push({ key: `i:${c.id}`, name: `I(${c.label})`, unit: 'A' });
    }
    return out;
  }, [sim, circuit]);
  // default probe: a voltmeter reading if present, otherwise the highest-numbered node (usually the output)
  const probeKey =
    probes.find((p) => p.key === probe)?.key ??
    probes.find((p) => p.key.startsWith('v:') && circuit.components.find((c) => `v:${c.id}` === p.key)?.type === 'voltmeter')?.key ??
    (sim.netlist.nodeCount > 1 ? `n:${sim.netlist.nodeCount - 1}` : probes[0]?.key);
  const sweep = useMemo(() => {
    const a = parseEng(f0);
    const b = parseEng(f1);
    if (!probeKey || !(a > 0) || !(b > a)) return null;
    return sim.acSweep(a, b, 300, [probeKey]);
  }, [sim, f0, f1, probeKey]);
  const pInfo = probes.find((p) => p.key === probeKey);

  if (!circuit.components.length) return <div className="pad muted">Build a circuit to run AC analysis.</div>;
  return (
    <div className="pad ac-panel">
      <div className="ac-left">
        <div className="muted small">
          Phasor (small-signal) analysis: every AC source is applied as Vp∠φ at the analysis frequency; DC sources are zeroed; diodes and transistors are
          linearised at their DC operating point. Impedances: Z_R = R, Z_L = jωL, Z_C = 1/(jωC).
        </div>
        <label className="inline">
          Frequency
          <input className="mono" placeholder={formatEng(freq, 'Hz')} value={fText} onChange={(e) => setFText(e.target.value)} />
          <span className="muted small">ω = {formatEng(2 * Math.PI * freq, 'rad/s')}</span>
        </label>
        {!acSrc && <div className="issue warning">No AC source in the circuit — add one to excite the circuit.</div>}
        {!res.ok && <div className="issue error">{res.error}</div>}
        {res.ok && (
          <table className="data">
            <thead>
              <tr>
                <th>Component</th>
                <th>|V|</th>
                <th>∠V</th>
                <th>|I|</th>
                <th>∠I</th>
                <th>|Z| = |V/I|</th>
              </tr>
            </thead>
            <tbody>
              {circuit.components
                .filter((c) => c.type !== 'ground' && c.type !== 'voltmeter')
                .map((c) => {
                  const { v } = res.comps[c.id];
                  const isSrc = c.type === 'dcsource' || c.type === 'acsource' || c.type === 'battery';
                  // sources: current out of the + terminal (generator convention)
                  const i: [number, number] = isSrc ? [-res.comps[c.id].i[0], -res.comps[c.id].i[1]] : res.comps[c.id].i;
                  const vm = Math.hypot(v[0], v[1]);
                  const im = Math.hypot(i[0], i[1]);
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="mono">{formatEng(vm, 'V', 4)}</td>
                      <td className="mono">{vm > 1e-12 ? deg(v[0], v[1]).toFixed(1) + '°' : '—'}</td>
                      <td className="mono">{formatEng(im, 'A', 4)}</td>
                      <td className="mono">{im > 1e-15 ? deg(i[0], i[1]).toFixed(1) + '°' : '—'}</td>
                      <td className="mono">{im > 1e-15 && c.type !== 'ammeter' && !isSrc ? formatEng(vm / im, 'Ω', 4) : isSrc && im > 1e-15 ? `${formatEng(vm / im, 'Ω', 4)} load` : '—'}</td>
                    </tr>
                  );
                })}
              {circuit.components
                .filter((c) => c.type === 'voltmeter')
                .map((c) => {
                  const { v } = res.comps[c.id];
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="mono">{formatEng(Math.hypot(v[0], v[1]), 'V', 4)}</td>
                      <td className="mono">{deg(v[0], v[1]).toFixed(1)}°</td>
                      <td colSpan={3} className="muted">voltmeter (peak phasor)</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
      <div className="ac-right">
        <div className="scope-controls">
          <b>Frequency sweep (Bode)</b>
          <select value={probeKey} onChange={(e) => setProbe(e.target.value)}>
            {probes.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <label>
            from <input className="mono short" value={f0} onChange={(e) => setF0(e.target.value)} />
          </label>
          <label>
            to <input className="mono short" value={f1} onChange={(e) => setF1(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={db} onChange={(e) => setDb(e.target.checked)} /> dB
          </label>
        </div>
        {sweep && !sweep.ok && <div className="issue error">{sweep.error}</div>}
        {sweep?.ok && probeKey && (
          <>
            <Plot
              x={sweep.f}
              ys={[db ? sweep.data[probeKey].mag.map((m) => 20 * Math.log10(Math.max(m, 1e-15))) : sweep.data[probeKey].mag]}
              series={[{ label: `|${pInfo?.name}|${db ? ' dB' : ''}`, color: '#4da3ff', unit: db ? 'dB' : pInfo?.unit ?? '' }]}
              xUnit="Hz"
              yUnit={db ? 'dB' : pInfo?.unit ?? ''}
              height={120}
              logX
              syncKey="bode"
            />
            <Plot
              x={sweep.f}
              ys={[sweep.data[probeKey].phase]}
              series={[{ label: `∠${pInfo?.name}`, color: '#ffa94d', unit: '°' }]}
              xUnit="Hz"
              yUnit="°"
              height={110}
              logX
              syncKey="bode"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Ohm's law calculator

function OhmCalc() {
  const [vals, setVals] = useState({ V: '', I: '', R: '', P: '' });
  const [out, setOut] = useState<{ V: number; I: number; R: number; P: number; how: string } | null>(null);
  const [err, setErr] = useState('');
  const [list, setList] = useState('1k, 2.2k, 3.3k');
  const solve = () => {
    const n = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() ? parseEng(v) : NaN])) as Record<'V' | 'I' | 'R' | 'P', number>;
    const known = (Object.keys(n) as ('V' | 'I' | 'R' | 'P')[]).filter((k) => Number.isFinite(n[k]));
    if (known.length !== 2) {
      setErr('Enter exactly two of V, I, R, P.');
      setOut(null);
      return;
    }
    setErr('');
    let { V, I, R, P } = n;
    const k = known.sort().join('');
    let how = '';
    switch (k) {
      case 'IV':
        R = V / I;
        P = V * I;
        how = 'R = V/I,  P = V·I';
        break;
      case 'RV':
        I = V / R;
        P = (V * V) / R;
        how = 'I = V/R,  P = V²/R';
        break;
      case 'PV':
        I = P / V;
        R = (V * V) / P;
        how = 'I = P/V,  R = V²/P';
        break;
      case 'IR':
        V = I * R;
        P = I * I * R;
        how = 'V = I·R,  P = I²R';
        break;
      case 'IP':
        V = P / I;
        R = P / (I * I);
        how = 'V = P/I,  R = P/I²';
        break;
      case 'PR':
        I = Math.sqrt(P / R);
        V = Math.sqrt(P * R);
        how = 'I = √(P/R),  V = √(P·R)';
        break;
    }
    setOut({ V, I, R, P, how });
  };
  const parts = list
    .split(/[,;\s]+/)
    .map(parseEng)
    .filter((v) => v > 0);
  const series = parts.reduce((a, b) => a + b, 0);
  const parallel = parts.length ? 1 / parts.reduce((a, b) => a + 1 / b, 0) : NaN;
  const units: Record<string, string> = { V: 'V', I: 'A', R: 'Ω', P: 'W' };
  return (
    <div className="pad calc">
      <div className="calc-card">
        <div className="section-title">Ohm's law & power</div>
        <div className="formulas mono">V = I·R &nbsp;·&nbsp; P = I·V &nbsp;·&nbsp; P = I²R &nbsp;·&nbsp; P = V²/R</div>
        <div className="calc-grid">
          {(['V', 'I', 'R', 'P'] as const).map((k) => (
            <label key={k}>
              <span>
                {k} ({units[k]})
              </span>
              <input className="mono" placeholder={k === 'V' ? 'e.g. 9' : k === 'I' ? 'e.g. 20m' : k === 'R' ? 'e.g. 4.7k' : 'e.g. 0.25'} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && solve()} />
            </label>
          ))}
        </div>
        <div className="btn-row">
          <button className="primary" onClick={solve}>
            Solve
          </button>
          <button onClick={() => (setVals({ V: '', I: '', R: '', P: '' }), setOut(null), setErr(''))}>Clear</button>
        </div>
        {err && <div className="issue warning">{err}</div>}
        {out && (
          <div className="calc-out">
            {(['V', 'I', 'R', 'P'] as const).map((k) => (
              <div key={k}>
                <span>{k}</span>
                <b className="mono">{formatEng(out[k], units[k], 4)}</b>
              </div>
            ))}
            <div className="muted small mono">{out.how}</div>
          </div>
        )}
      </div>
      <div className="calc-card">
        <div className="section-title">Series / parallel resistance</div>
        <input className="mono wide" value={list} onChange={(e) => setList(e.target.value)} />
        <div className="kv-line">
          <span>Series R = ΣRᵢ</span>
          <b className="mono">{parts.length ? formatEng(series, 'Ω', 4) : '—'}</b>
        </div>
        <div className="kv-line">
          <span>Parallel R = 1/Σ(1/Rᵢ)</span>
          <b className="mono">{parts.length ? formatEng(parallel, 'Ω', 4) : '—'}</b>
        </div>
      </div>
      <TauCalc />
    </div>
  );
}

function TauCalc() {
  const [r, setR] = useState('1k');
  const [c, setC] = useState('100u');
  const [l, setL] = useState('10m');
  const R = parseEng(r);
  const C = parseEng(c);
  const L = parseEng(l);
  return (
    <div className="calc-card">
      <div className="section-title">Time constants & resonance</div>
      <div className="calc-grid three">
        <label>
          <span>R (Ω)</span>
          <input className="mono" value={r} onChange={(e) => setR(e.target.value)} />
        </label>
        <label>
          <span>C (F)</span>
          <input className="mono" value={c} onChange={(e) => setC(e.target.value)} />
        </label>
        <label>
          <span>L (H)</span>
          <input className="mono" value={l} onChange={(e) => setL(e.target.value)} />
        </label>
      </div>
      <div className="kv-line">
        <span>τ = RC</span>
        <b className="mono">{formatEng(R * C, 's')}</b>
      </div>
      <div className="kv-line">
        <span>τ = L/R</span>
        <b className="mono">{formatEng(L / R, 's')}</b>
      </div>
      <div className="kv-line">
        <span>f₀ = 1/(2π√LC)</span>
        <b className="mono">{formatEng(1 / (2 * Math.PI * Math.sqrt(L * C)), 'Hz')}</b>
      </div>
      <div className="kv-line">
        <span>Series ζ = (R/2)√(C/L)</span>
        <b className="mono">{((R / 2) * Math.sqrt(C / L)).toFixed(3)}</b>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ SPICE

function SpicePanel() {
  const circuit = useStore((s) => s.circuit);
  const notify = useStore((s) => s.notify);
  const [tstop, setTstop] = useState('10m');
  const text = useMemo(() => exportSpice(circuit, { tstop: parseEng(tstop) > 0 ? parseEng(tstop) : undefined }), [circuit, tstop]);
  const [input, setInput] = useState('* RC low-pass\nV1 in 0 SIN(0 5 1k) AC 5\nR1 in out 1k\nC1 out 0 159n\n.end');
  const [warnings, setWarnings] = useState<string[]>([]);
  return (
    <div className="pad spice">
      <div className="spice-col">
        <div className="scope-controls">
          <b>Export</b>
          <label>
            .tran stop <input className="mono short" value={tstop} onChange={(e) => setTstop(e.target.value)} />
          </label>
          <button onClick={() => navigator.clipboard?.writeText(text).then(() => notify('Netlist copied to clipboard.', 'success'))}>Copy</button>
          <button onClick={() => download(`${circuit.name.replace(/[^\w-]+/g, '_')}.cir`, text)}>Download .cir</button>
        </div>
        <textarea className="mono" readOnly value={text} />
      </div>
      <div className="spice-col">
        <div className="scope-controls">
          <b>Import</b>
          <span className="muted small">R, C, L, V (DC / SIN), D, Q (NPN) and .model lines</span>
          <button
            className="primary"
            onClick={() => {
              try {
                const { circuit: c, warnings } = importSpice(input);
                stopSim();
                useStore.getState().loadCircuit(c);
                setWarnings(warnings);
                requestAnimationFrame(fitView);
                notify(`Imported ${c.components.length} components from netlist.`, 'success');
              } catch (e) {
                notify(`Netlist import failed: ${(e as Error).message}`, 'error');
              }
            }}
          >
            Build schematic
          </button>
        </div>
        <textarea className="mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        {warnings.map((w, i) => (
          <div key={i} className="issue warning">
            {w}
          </div>
        ))}
      </div>
    </div>
  );
}
