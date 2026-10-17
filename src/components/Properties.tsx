import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { DEFS, ParamDef, terminalPositions } from '../model/library';
import { formatEng, parseEng } from '../model/units';
import { buildNetlist, Issue } from '../engine/netlist';
import { SymbolIcon } from './Library';
import { Component } from '../model/types';
import { runtime } from '../state/runtime';
import { EXAMPLES } from '../model/examples';

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
