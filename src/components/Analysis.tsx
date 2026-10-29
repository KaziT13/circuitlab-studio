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
