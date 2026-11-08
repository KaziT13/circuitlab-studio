import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { DEFS, ParamDef, terminalPositions } from '@ohmlab/shared/model/library';
import { formatEng, parseEng } from '@ohmlab/shared/model/units';
import { buildNetlist, Issue } from '@ohmlab/shared/engine/netlist';
import { SymbolIcon } from './Library';
import { Component } from '@ohmlab/shared/model/types';
import { runtime } from '../state/runtime';
import { EXAMPLES } from '@ohmlab/shared/model/examples';

function EngInput({ value, unit, onCommit, param }: { value: number; unit?: string; onCommit: (v: number) => void; param: ParamDef }) {
  const [text, setText] = useState(formatEng(value, unit ?? '', 4));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(formatEng(value, unit ?? '', 4));
    setErr(null);
  }, [value, unit]);
  const commit = () => {
    const v = parseEng(text);
    if (!Number.isFinite(v)) return setErr('Not a number — try 4.7k, 10u, 2.2m');
    if (param.positive && v <= 0) return setErr('Must be greater than 0');
    if (param.min !== undefined && v < param.min) return setErr(`Must be ≥ ${param.min}`);
    setErr(null);
    if (v !== value) onCommit(v);
    else setText(formatEng(value, unit ?? '', 4));
  };
  return (
    <div className="eng-input">
      <input
        className={err ? 'invalid' : ''}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(formatEng(value, unit ?? '', 4));
            setErr(null);
          }
        }}
      />
      {err && <div className="field-err">{err}</div>}
    </div>
  );
}

function Readings({ comp }: { comp: Component }) {
  const snapshot = useStore((s) => s.snapshot);
  const status = useStore((s) => s.simStatus);
  const r = status !== 'stopped' ? snapshot?.readings[comp.id] : undefined;
  if (comp.type === 'ground') return null;
  if (!r)
    return (
      <div className="section">
        <div className="section-title">Measurements</div>
        <div className="muted small">Run the simulation (▶) to see live voltage, current and power.</div>
      </div>
    );
  const isSource = comp.type === 'dcsource' || comp.type === 'acsource' || comp.type === 'battery';
  const rows: [string, string, string?][] = [];
  if (comp.type === 'npn') {
    const x = r.extra!;
    rows.push(['Region', String(x.region), x.region === 'Saturation' ? 'warn' : x.region === 'Forward active' ? 'ok' : undefined]);
    rows.push(['I_C', formatEng(Number(x.Ic), 'A')]);
    rows.push(['I_B', formatEng(Number(x.Ib), 'A')]);
    rows.push(['I_E', formatEng(Number(x.Ie), 'A')]);
    rows.push(['V_BE', formatEng(Number(x.Vbe), 'V')]);
    rows.push(['V_CE', formatEng(Number(x.Vce), 'V')]);
    rows.push(['I_C / I_B', Number(x.hFE).toFixed(1)]);
  } else {
    if (comp.type !== 'ammeter') rows.push([isSource ? 'Terminal voltage' : 'Voltage across', formatEng(r.v, 'V')]);
    if (comp.type !== 'voltmeter') rows.push([isSource ? 'Current (out of +)' : 'Current through', formatEng(isSource ? -r.i : r.i, 'A')]);
  }
  if (comp.type !== 'voltmeter' && comp.type !== 'ammeter') {
    if (isSource) rows.push(['Power delivered', formatEng(-r.p, 'W'), -r.p < 0 ? 'warn' : undefined]);
    else rows.push(['Power dissipated', formatEng(r.p, 'W')]);
  }
  const x = r.extra ?? {};
  if (comp.type === 'resistor' && r.i !== 0) rows.push(['V / I', formatEng(Math.abs(r.v / r.i), 'Ω')]);
  if (x.ratingUse !== undefined) {
    const u = Number(x.ratingUse);
    rows.push(['Of rating', `${(Math.abs(u) * 100).toFixed(1)} %`, Math.abs(u) > 1 ? 'err' : Math.abs(u) > 0.8 ? 'warn' : 'ok']);
  }
  if (x.energy !== undefined) rows.push(['Stored energy', formatEng(Number(x.energy), 'J')]);
  if (x.charge !== undefined) rows.push(['Charge Q = CV', formatEng(Number(x.charge), 'C')]);
  if (x.brightness !== undefined) rows.push(['Brightness', `${Math.round(Math.min(Number(x.brightness), 1.5) * 100)} %`]);
  if (x.state !== undefined) rows.push(['State', String(x.state)]);
  if (x.resistance !== undefined) rows.push(['Filament R', formatEng(Number(x.resistance), 'Ω')]);
  if (x.emf !== undefined && comp.type === 'acsource') rows.push(['Instantaneous EMF', formatEng(Number(x.emf), 'V')]);
  return (
    <div className="section">
      <div className="section-title">
        Measurements <span className="muted small">t = {formatEng(snapshot!.t, 's')}</span>
      </div>
      <table className="kv">
        <tbody>
          {rows.map(([k, v, cls]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className={`mono ${cls ?? ''}`}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompEditor({ comp }: { comp: Component }) {
  const def = DEFS[comp.type];
  const setProp = useStore((s) => s.setProp);
  const setLabel = useStore((s) => s.setLabel);
  const learnMode = useStore((s) => s.learnMode);
  const status = useStore((s) => s.simStatus);
  const pressed = useStore((s) => s.pressed);
  const [label, setLabelText] = useState(comp.label);
  useEffect(() => setLabelText(comp.label), [comp.label]);
  const R = Number(comp.props.resistance);
  const tol = Number(comp.props.tolerance);
  const theveninTau = useMemo(() => {
    if ((comp.type !== 'capacitor' && comp.type !== 'inductor') || !runtime.sim) return null;
    const r = runtime.sim.theveninResistance(comp.id);
    if (!Number.isFinite(r)) return null;
    return comp.type === 'capacitor' ? { r, tau: r * Number(comp.props.capacitance) } : { r, tau: Number(comp.props.inductance) / r };
  }, [comp, status]);

  return (
    <>
      <div className="comp-head">
        <SymbolIcon type={comp.type} size={52} />
        <div>
          <div className="comp-type">{def.name}</div>
          <input
            className="label-input"
            value={label}
            onChange={(e) => setLabelText(e.target.value)}
            onBlur={() => label.trim() && label !== comp.label && setLabel(comp.id, label.trim())}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>
      <div className="btn-row">
        <button onClick={() => useStore.getState().rotateSelected()} title="Rotate 90° (R)">⟳ Rotate</button>
        <button onClick={() => useStore.getState().duplicateSelected()} title="Duplicate (Ctrl/⌘+D)">⧉ Duplicate</button>
        <button className="danger" onClick={() => useStore.getState().deleteSelected()} title="Delete (Del)">✕ Delete</button>
      </div>

      {def.params.length > 0 && (
        <div className="section">
          <div className="section-title">Properties</div>
          {def.params.map((p) => (
            <label key={p.key} className="field">
              <span>
                {p.label}
                {p.unit && <em> ({p.unit})</em>}
              </span>
              {p.kind === 'number' && (
                <EngInput value={Number(comp.props[p.key])} unit={p.unit === '%' || p.unit === '°' ? '' : p.unit} param={p} onCommit={(v) => setProp(comp.id, p.key, v)} />
              )}
              {p.kind === 'boolean' && (
                <input type="checkbox" checked={!!comp.props[p.key]} onChange={(e) => setProp(comp.id, p.key, e.target.checked)} />
              )}
              {p.kind === 'select' && (
                <select
                  value={String(comp.props[p.key])}
                  onChange={(e) => {
                    setProp(comp.id, p.key, e.target.value);
                    if (comp.type === 'led' && p.key === 'color') {
                      const vf = { red: 1.9, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.1 }[e.target.value];
                      if (vf) setProp(comp.id, 'forwardVoltage', vf);
                    }
                  }}
                >
                  {p.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
          {comp.type === 'resistor' && tol > 0 && (
            <div className="muted small">
              Tolerance range: {formatEng(R * (1 - tol / 100), 'Ω')} – {formatEng(R * (1 + tol / 100), 'Ω')}
            </div>
          )}
          {comp.type === 'bulb' && (
            <div className="muted small">
              Filament resistance R = V²/P = {formatEng(Number(comp.props.ratedVoltage) ** 2 / Number(comp.props.ratedPower), 'Ω')}
            </div>
          )}
          {comp.type === 'pushbutton' && (
            <div className="muted small">{pressed[comp.id] ? 'Pressed' : 'Released'} — press and hold it on the canvas while running.</div>
          )}
          {(comp.type === 'switch' || comp.type === 'spdt') && (
            <div className="muted small">Tip: click the switch on the canvas while the simulation runs (double-click when stopped).</div>
          )}
          {theveninTau && (
            <div className="muted small">
              Thevenin resistance seen: {formatEng(theveninTau.r, 'Ω')} → τ = {formatEng(theveninTau.tau, 's')}
            </div>
          )}
        </div>
      )}

      <Readings comp={comp} />

      {learnMode && (
        <div className="section learn">
          <div className="section-title">Learn · {def.name}</div>
          <p>{def.edu.what}</p>
          <div className="learn-row">
            <span>Symbol</span>
            <SymbolIcon type={comp.type} size={40} />
          </div>
          <div className="learn-row">
            <span>Equation</span>
            <code>{def.edu.equation}</code>
          </div>
          <div className="learn-row">
            <span>Unit</span>
            <div>{def.edu.unit}</div>
          </div>
          <div className="learn-row">
            <span>Effect</span>
            <div>{def.edu.effect}</div>
          </div>
        </div>
      )}
    </>
  );
}

export function StatusList() {
  const circuit = useStore((s) => s.circuit);
  const snapshot = useStore((s) => s.snapshot);
  const simError = useStore((s) => s.simError);
  const status = useStore((s) => s.simStatus);
  const lagging = useStore((s) => s.lagging);
  const netlist = useMemo(() => buildNetlist(circuit), [circuit]);
  const issues: Issue[] = [...netlist.issues];
  if (simError) issues.unshift({ level: 'error', message: simError });
  if (status !== 'stopped' && snapshot) issues.push(...snapshot.issues);
  if (lagging && status === 'running') issues.push({ level: 'info', message: 'Simulation is running slower than the requested speed (CPU-bound).' });
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const ok = status !== 'stopped' && !!snapshot && errors === 0;
  const select = (id?: string) => id && useStore.getState().set({ selection: { kind: 'comp', id } });
  return (
    <div className="section status-section">
      <div className="section-title">Circuit status</div>
      {ok && (
        <div className={`status-banner ${warns ? 'warn' : 'ok'}`}>
          <b>{warns ? 'Running with warnings' : 'Operating correctly'}</b>
          <div className="small mono">
            KCL max residual {formatEng(snapshot!.kclResidual, 'A')} · ΣP {formatEng(snapshot!.powerBalance, 'W')}
          </div>
        </div>
      )}
      {!ok && errors === 0 && status === 'stopped' && circuit.components.length > 0 && (
        <div className="status-banner idle">Ready — press Run to simulate.</div>
      )}
      {issues.map((i, k) => (
        <div key={k} className={`issue ${i.level} ${i.compId ? 'clickable' : ''}`} onClick={() => select(i.compId)}>
          <span className="issue-dot" />
          {i.message}
        </div>
      ))}
    </div>
  );
}

export function Properties() {
  const selection = useStore((s) => s.selection);
  const circuit = useStore((s) => s.circuit);
  const snapshot = useStore((s) => s.snapshot);
  const status = useStore((s) => s.simStatus);
  const netlist = useMemo(() => buildNetlist(circuit), [circuit]);
  const comp = selection?.kind === 'comp' ? circuit.components.find((c) => c.id === selection.id) : undefined;
  const wire = selection?.kind === 'wire' ? circuit.wires.find((w) => w.id === selection.id) : undefined;

  return (
    <aside className="panel props">
      <div className="panel-head">
        <span>Properties &amp; Measurements</span>
      </div>
      <div className="props-scroll">
        {comp && <CompEditor key={comp.id} comp={comp} />}
        {wire && (
          <div className="section">
            <div className="section-title">Wire</div>
            {(() => {
              const net = netlist.wireNet.get(wire.id) ?? -1;
              return (
                <table className="kv">
                  <tbody>
                    <tr>
                      <td>Node</td>
                      <td className="mono">{net >= 0 ? netlist.netNames[net] : 'unconnected'}</td>
                    </tr>
                    {status !== 'stopped' && snapshot && net >= 0 && (
                      <tr>
                        <td>Voltage</td>
                        <td className="mono">{formatEng(snapshot.nodeV[net], 'V')}</td>
                      </tr>
                    )}
                    <tr>
                      <td>Segments</td>
                      <td className="mono">{wire.points.length - 1}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <div className="btn-row">
              <button className="danger" onClick={() => useStore.getState().deleteSelected()}>
                ✕ Delete wire
              </button>
            </div>
            <div className="muted small">Drag from a wire to branch a new wire off it (T-junction).</div>
          </div>
        )}
        {!comp && !wire && (
          <div className="section">
            <div className="section-title">Circuit</div>
            <table className="kv">
              <tbody>
                <tr>
                  <td>Name</td>
                  <td>{circuit.name}</td>
                </tr>
                <tr>
                  <td>Components</td>
                  <td className="mono">{circuit.components.length}</td>
                </tr>
                <tr>
                  <td>Wires</td>
                  <td className="mono">{circuit.wires.length}</td>
                </tr>
                <tr>
                  <td>Nodes (incl. reference)</td>
                  <td className="mono">{netlist.nodeCount}</td>
                </tr>
                <tr>
                  <td>Terminals</td>
                  <td className="mono">{circuit.components.reduce((n, c) => n + terminalPositions(c).length, 0)}</td>
                </tr>
              </tbody>
            </table>
            <div className="muted small">Select a component to edit its properties and see its measurements.</div>
            <ExampleInfo />
          </div>
        )}
        <StatusList />
      </div>
    </aside>
  );
}

function ExampleInfo() {
  const id = useStore((s) => s.activeExample);
  const learnMode = useStore((s) => s.learnMode);
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return null;
  return (
    <div className="example-info">
      <div className="section-title">{ex.title}</div>
      {learnMode && <p>{ex.theory}</p>}
      <div className="small muted">Hand-calculated results — compare with the simulation:</div>
      <ul>
        {ex.expected.map((e) => (
          <li key={e} className="mono small">
            {e}
          </li>
        ))}
      </ul>
    </div>
  );
}
