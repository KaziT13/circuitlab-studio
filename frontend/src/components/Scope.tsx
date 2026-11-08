import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { history, listSignals, runTransient, SignalInfo } from '../state/runtime';
import { buildNetlist } from '@ohmlab/shared/engine/netlist';
import { formatEng, parseEng } from '@ohmlab/shared/model/units';
import { Plot, PlotSeries } from './Plot';
import { download } from './Toolbar';

const PALETTE = ['#4da3ff', '#ffa94d', '#3ddc84', '#ff6bd5', '#ffd23f', '#4dd0e1', '#a78bfa', '#ff6b6b', '#c3e88d', '#f78c6c'];

function lowerBound(arr: number[], v: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function stats(t: number[], y: number[]) {
  let min = Infinity;
  let max = -Infinity;
  let area = 0;
  let sq = 0;
  let n = 0;
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    n++;
    if (i > 0 && Number.isFinite(y[i - 1])) {
      const dt = t[i] - t[i - 1];
      area += ((v + y[i - 1]) / 2) * dt;
      sq += ((v * v + y[i - 1] * y[i - 1]) / 2) * dt;
    }
  }
  const T = t.length > 1 ? t[t.length - 1] - t[0] : 0;
  const avg = T > 0 ? area / T : n ? y[y.length - 1] : 0;
  const rms = T > 0 ? Math.sqrt(sq / T) : Math.abs(avg);
  // frequency from rising crossings of the mean
  const mid = (min + max) / 2;
  const crossings: number[] = [];
  if (max - min > 1e-9 * Math.max(1, Math.abs(max))) {
    for (let i = 1; i < y.length; i++) {
      if (y[i - 1] < mid && y[i] >= mid) {
        const f = (mid - y[i - 1]) / (y[i] - y[i - 1]);
        crossings.push(t[i - 1] + f * (t[i] - t[i - 1]));
      }
    }
  }
  const freq = crossings.length >= 2 ? (crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0]) : NaN;
  return { min, max, avg, rms, pp: max - min, freq };
}

export function Scope() {
  const circuit = useStore((s) => s.circuit);
  const probes = useStore((s) => s.probes);
  const scopeSignals = useStore((s) => s.scopeSignals);
  const speed = useStore((s) => s.speed);
  const status = useStore((s) => s.simStatus);
  const set = useStore((s) => s.set);
  const notify = useStore((s) => s.notify);

  const [mode, setMode] = useState<'roll' | 'trigger' | 'all'>('roll');
  const [win, setWin] = useState<number | null>(null);
  const [winText, setWinText] = useState('');
  const [trigLevel, setTrigLevel] = useState(0);
  const [trigText, setTrigText] = useState('0');
  const [yMin, setYMin] = useState('');
  const [yMax, setYMax] = useState('');
  const [filter, setFilter] = useState('');
  const [tranStop, setTranStop] = useState('');
  const [tranStep, setTranStep] = useState('');
  const [tick, setTick] = useState(0);
  const lastV = useRef(-1);

  useEffect(() => {
    const id = setInterval(() => {
      if (history.version !== lastV.current) {
        lastV.current = history.version;
        setTick((t) => t + 1);
      }
    }, 70);
    return () => clearInterval(id);
  }, []);

  const signals = useMemo(() => listSignals(circuit, buildNetlist(circuit)), [circuit, probes]);
  const selected: SignalInfo[] = scopeSignals.map((k) => signals.find((s) => s.key === k)).filter(Boolean) as SignalInfo[];
  const colorOf = (s: SignalInfo, i: number) => {
    if (s.key.startsWith('probe:')) return probes.find((p) => `probe:${p.id}` === s.key)?.color ?? PALETTE[i % PALETTE.length];
    return PALETTE[i % PALETTE.length];
  };
  const toggle = (key: string) =>
    set({ scopeSignals: scopeSignals.includes(key) ? scopeSignals.filter((k) => k !== key) : [...scopeSignals, key] });

  const windowLen = win ?? Math.max(speed * 4, 1e-9);

  const view = useMemo(() => {
    const T = history.t;
    if (!T.length) return { x: [] as number[], cols: selected.map(() => [] as number[]), trig: false, tAll: [] as number[], rawCols: [] as number[][] };
    const tEnd = T[T.length - 1];
    let start = mode === 'all' ? T[0] : tEnd - windowLen;
    let end = tEnd;
    let offset = 0;
    let trig = false;
    if (mode === 'trigger' && selected.length) {
      const src = history.data.get(selected[0].key);
      if (src) {
        const limit = lowerBound(T, tEnd - windowLen * 0.9);
        for (let i = Math.min(limit, T.length - 1); i > 0; i--) {
          if (src[i - 1] < trigLevel && src[i] >= trigLevel) {
            const tc = T[i - 1] + ((trigLevel - src[i - 1]) / (src[i] - src[i - 1])) * (T[i] - T[i - 1]);
            start = tc - windowLen * 0.1;
            end = start + windowLen;
            offset = tc;
            trig = true;
            break;
          }
          if (T[i] < tEnd - 20 * windowLen) break;
        }
      }
    }
    const i0 = lowerBound(T, start);
    const i1 = Math.min(lowerBound(T, end + 1e-15) , T.length);
    const n = i1 - i0;
    const stride = Math.max(1, Math.ceil(n / 3000));
    const x: number[] = [];
    const cols = selected.map(() => [] as number[]);
    const tAll = T.slice(i0, i1);
    const rawCols = selected.map((s) => (history.data.get(s.key) ?? []).slice(i0, i1));
    for (let i = i0; i < i1; i += stride) {
      x.push(T[i] - offset);
      selected.forEach((s, k) => cols[k].push(history.data.get(s.key)?.[i] ?? NaN));
    }
    return { x, cols, trig, tAll, rawCols };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, scopeSignals.join(','), signals, mode, windowLen, trigLevel]);

  const units = (['V', 'A', 'W'] as const).filter((u) => selected.some((s) => s.unit === u));
  const plotH = units.length <= 1 ? 210 : units.length === 2 ? 128 : 92;
  const yRange: [number, number] | null = (() => {
    const a = parseEng(yMin);
    const b = parseEng(yMax);
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
  })();

  const exportCsv = (all: boolean) => {
    const keys = all ? [...history.data.keys()] : selected.map((s) => s.key);
    if (!history.t.length) return notify('No simulation data recorded yet — run the simulation first.', 'warning');
    const nameOf = (k: string) => signals.find((s) => s.key === k)?.name ?? k;
    const rows = [['time_s', ...keys.map(nameOf)].join(',')];
    history.t.forEach((t, i) => rows.push([t.toPrecision(9), ...keys.map((k) => (history.data.get(k)?.[i] ?? NaN).toPrecision(9))].join(',')));
    download(`${circuit.name.replace(/[^\w-]+/g, '_')}_sim.csv`, rows.join('\n'), 'text/csv');
    notify(`Exported ${history.t.length} samples × ${keys.length} signals.`, 'success');
  };

  const runTran = () => {
    const tstop = parseEng(tranStop);
    if (!(tstop > 0)) return notify('Enter a stop time, e.g. 50m', 'warning');
    let h = parseEng(tranStep);
    if (!(h > 0)) h = tstop / 4000;
    const r = runTransient(tstop, h);
    if (!r.ok) notify(`Transient failed: ${r.error}`, 'error');
    else {
      setMode('all');
      notify(`.tran complete: ${r.steps} steps of ${formatEng(h, 's')}`, 'success');
    }
  };

  const groups = [...new Set(signals.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())).map((s) => s.group))];

  return (
    <div className="scope">
      <div className="scope-side">
        <input className="sig-filter" placeholder="Filter signals…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="sig-list">
          {signals.length === 0 && <div className="muted small">Add components to get signals.</div>}
          {groups.map((g) => (
            <div key={g}>
              <div className="sig-group">{g}</div>
              {signals
                .filter((s) => s.group === g && s.name.toLowerCase().includes(filter.toLowerCase()))
                .map((s) => {
                  const idx = scopeSignals.indexOf(s.key);
                  return (
                    <label key={s.key} className="sig-row">
                      <input type="checkbox" checked={idx >= 0} onChange={() => toggle(s.key)} />
                      <span className="swatch" style={{ background: idx >= 0 ? colorOf(s, idx) : 'transparent' }} />
                      {s.name}
                    </label>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="muted small">Tip: use the probe tool on the canvas to clip scope probes onto wires.</div>
      </div>
      <div className="scope-main">
        <div className="scope-controls">
          <div className="seg">
            <button className={mode === 'roll' ? 'on' : ''} onClick={() => setMode('roll')} title="Strip chart: newest data at the right">Roll</button>
            <button className={mode === 'trigger' ? 'on' : ''} onClick={() => setMode('trigger')} title="Oscilloscope: trigger on rising edge of first channel">Trigger</button>
            <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')} title="Show the entire recording">All</button>
          </div>
          <label>
            Window
            <input
              className="mono"
              placeholder={formatEng(windowLen, 's')}
              value={winText}
              onChange={(e) => setWinText(e.target.value)}
              onBlur={() => {
                const v = parseEng(winText);
                setWin(Number.isFinite(v) && v > 0 ? v : null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          {mode === 'trigger' && (
            <label>
              Trig level
              <input
                className="mono"
                value={trigText}
                onChange={(e) => setTrigText(e.target.value)}
                onBlur={() => {
                  const v = parseEng(trigText);
                  if (Number.isFinite(v)) setTrigLevel(v);
                }}
              />
              <span className={`trig-led ${view.trig ? 'on' : ''}`}>{view.trig ? "TRIG'D" : 'AUTO'}</span>
            </label>
          )}
          <label title="Leave blank for autoscale">
            Y
            <input className="mono short" placeholder="min" value={yMin} onChange={(e) => setYMin(e.target.value)} />
            <input className="mono short" placeholder="max" value={yMax} onChange={(e) => setYMax(e.target.value)} />
          </label>
          <span className="sep" />
          <label title="Batch transient analysis from t = 0 (like SPICE .tran)">
            .tran
            <input className="mono short" placeholder="stop" value={tranStop} onChange={(e) => setTranStop(e.target.value)} />
            <input className="mono short" placeholder="step" value={tranStep} onChange={(e) => setTranStep(e.target.value)} />
            <button onClick={runTran}>Run</button>
          </label>
          <span className="sep" />
          <button onClick={() => exportCsv(false)} title="Export selected signals as CSV">CSV (selected)</button>
          <button onClick={() => exportCsv(true)} title="Export every recorded signal as CSV">CSV (all)</button>
        </div>
        <div className="plots">
          {selected.length === 0 && <div className="plot-empty">Select signals on the left (or place probes) to plot voltage, current and power versus time.</div>}
          {selected.length > 0 && view.x.length === 0 && (
            <div className="plot-empty">{status === 'stopped' ? 'Press ▶ Run (or run a .tran) to record waveforms.' : 'Waiting for data…'}</div>
          )}
          {view.x.length > 0 &&
            units.map((u) => {
              const idxs = selected.map((s, i) => [s, i] as const).filter(([s]) => s.unit === u);
              const series: PlotSeries[] = idxs.map(([s, i]) => ({ label: s.name, color: colorOf(s, i), unit: u }));
              return (
                <Plot
                  key={u + idxs.map(([s]) => s.key).join()}
                  x={view.x}
                  ys={idxs.map(([, i]) => view.cols[i])}
                  series={series}
                  xUnit="s"
                  yUnit={u}
                  height={plotH}
                  syncKey="scope"
                  yRange={units.length === 1 ? yRange : null}
                />
              );
            })}
        </div>
        {view.x.length > 1 && selected.length > 0 && (
          <table className="meas-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Min</th>
                <th>Max</th>
                <th>p-p</th>
                <th>Avg</th>
                <th>RMS</th>
                <th>Freq</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((s, i) => {
                const st = stats(view.tAll, view.rawCols[i]);
                return (
                  <tr key={s.key}>
                    <td>
                      <span className="swatch" style={{ background: colorOf(s, i) }} /> {s.name}
                    </td>
                    <td>{formatEng(st.min, s.unit)}</td>
                    <td>{formatEng(st.max, s.unit)}</td>
                    <td>{formatEng(st.pp, s.unit)}</td>
                    <td>{formatEng(st.avg, s.unit)}</td>
                    <td>{formatEng(st.rms, s.unit)}</td>
                    <td>{Number.isFinite(st.freq) ? formatEng(st.freq, 'Hz') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
