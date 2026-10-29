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
