import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { pauseSim, resetSim, runSim, stepOnce, stepSize, stopSim } from '../state/runtime';
import { EXAMPLES } from '../model/examples';
import { Circuit, emptyCircuit } from '../model/types';
import { formatEng, parseEng } from '../model/units';
import { fitView } from './Canvas';
import { DEFS } from '../model/library';

const SAVE_KEY = 'ohmlab.saved.v1';

function readSaved(): Record<string, { circuit: Circuit; savedAt: number }> {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeSaved(v: Record<string, { circuit: Circuit; savedAt: number }>) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function validateCircuit(x: unknown): Circuit {
  const c = x as Circuit;
  if (!c || !Array.isArray(c.components) || !Array.isArray(c.wires)) throw new Error('File is not a Ohmlab circuit (missing components/wires).');
  for (const k of c.components) {
    if (!DEFS[k.type]) throw new Error(`Unknown component type "${k.type}".`);
    if (typeof k.x !== 'number' || typeof k.y !== 'number') throw new Error(`Component ${k.label} has invalid coordinates.`);
    k.props = { ...DEFS[k.type].defaults, ...(k.props ?? {}) };
    k.rot = k.rot ?? 0;
  }
  for (const w of c.wires) if (!Array.isArray(w.points)) throw new Error('A wire has no points.');
  return { name: c.name || 'Imported circuit', components: c.components, wires: c.wires };
}

export function download(name: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function loadExample(id: string) {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) return;
  stopSim();
  const c = ex.build();
  const s = useStore.getState();
  s.loadCircuit(c, id);
  const signals = ex.probes
    .map((p) => {
      const comp = c.components.find((k) => k.label === p.label);
      return comp ? `${p.q}:${comp.id}` : null;
    })
    .filter(Boolean) as string[];
  s.set({ speed: ex.speed, timestep: null, scopeSignals: signals, bottomTab: 'scope', bottomOpen: true });
  requestAnimationFrame(() => {
    fitView();
    runSim();
  });
}

function Menu({ label, children, wide }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`menu-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && <div className={`menu-pop ${wide ? 'wide' : ''}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function LoadDialog({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState(readSaved());
  const names = Object.keys(saved).sort((a, b) => saved[b].savedAt - saved[a].savedAt);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          Open saved circuit
          <button onClick={onClose}>✕</button>
        </div>
        {names.length === 0 && <div className="muted">No circuits saved in this browser yet. Use File → Save.</div>}
        {names.map((n) => (
          <div key={n} className="saved-row">
            <button
              className="link"
              onClick={() => {
                stopSim();
                useStore.getState().loadCircuit(saved[n].circuit);
                onClose();
                requestAnimationFrame(fitView);
              }}
            >
              {n}
            </button>
            <span className="muted small">
              {saved[n].circuit.components.length} parts · {new Date(saved[n].savedAt).toLocaleString()}
            </span>
            <button
              className="danger small-btn"
              onClick={() => {
                const next = { ...saved };
                delete next[n];
                writeSaved(next);
                setSaved(next);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toolbar() {
  const status = useStore((s) => s.simStatus);
  const speed = useStore((s) => s.speed);
  const timestep = useStore((s) => s.timestep);
  const snapshot = useStore((s) => s.snapshot);
  const circuitName = useStore((s) => s.circuit.name);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const showVoltages = useStore((s) => s.showVoltages);
  const showCurrents = useStore((s) => s.showCurrents);
  const showVoltageColors = useStore((s) => s.showVoltageColors);
  const learnMode = useStore((s) => s.learnMode);
  const centerView = useStore((s) => s.centerView);
  const simError = useStore((s) => s.simError);
  const set = useStore((s) => s.set);
  const notify = useStore((s) => s.notify);
  const [loadOpen, setLoadOpen] = useState(false);
  const [hText, setHText] = useState('');
  const [hEditing, setHEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const c = useStore.getState().circuit;
    const name = prompt('Save circuit as:', c.name)?.trim();
    if (!name) return;
    const all = readSaved();
    all[name] = { circuit: { ...c, name }, savedAt: Date.now() };
    if (writeSaved(all)) {
      useStore.getState().edit((x) => ({ ...x, name }), { history: false });
      notify(`Saved “${name}” in this browser.`, 'success');
    } else notify('Could not save: browser storage is unavailable.', 'error');
  };

  const sliderVal = Math.log10(speed);
  const statusLabel = simError ? 'Error' : status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Stopped';
  const statusCls = simError ? 'err' : status === 'running' ? 'ok' : status === 'paused' ? 'warn' : 'idle';

  return (
    <header className="toolbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path d="M2 12 H6 L8 7 L11 17 L14 7 L16 12 H22" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span>Ohmlab</span>
        <em>Studio</em>
      </div>

      <Menu label="File">
        {(close) => (
          <>
            <button
              onClick={() => {
                stopSim();
                useStore.getState().loadCircuit(emptyCircuit());
                close();
              }}
            >
              New circuit
            </button>
            <button onClick={() => (save(), close())}>Save to browser…</button>
            <button onClick={() => (setLoadOpen(true), close())}>Open saved…</button>
            <hr />
            <button
              onClick={() => {
                const c = useStore.getState().circuit;
                download(`${c.name.replace(/[^\w-]+/g, '_') || 'circuit'}.circuit.json`, JSON.stringify(c, null, 2), 'application/json');
                close();
              }}
            >
              Export JSON file
            </button>
            <button onClick={() => (fileRef.current?.click(), close())}>Import JSON file…</button>
            <hr />
            <button onClick={() => (set({ bottomTab: 'spice', bottomOpen: true }), close())}>SPICE netlist import / export…</button>
          </>
        )}
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const c = validateCircuit(JSON.parse(await f.text()));
            stopSim();
            useStore.getState().loadCircuit(c);
            requestAnimationFrame(fitView);
            notify(`Imported ${c.components.length} components.`, 'success');
          } catch (err) {
            notify(`Import failed: ${(err as Error).message}`, 'error');
          }
        }}
      />

      <Menu label="Examples" wide>
        {(close) =>
          EXAMPLES.map((ex, i) => (
            <button key={ex.id} className="ex-item" onClick={() => (loadExample(ex.id), close())}>
              <b>
                {i + 1}. {ex.title}
              </b>
              <span>{ex.summary}</span>
            </button>
          ))
        }
      </Menu>

      <div className="tb-group">
        <button className="icon" disabled={!past} onClick={() => useStore.getState().undo()} title="Undo (Ctrl/⌘+Z)">↶</button>
        <button className="icon" disabled={!future} onClick={() => useStore.getState().redo()} title="Redo (Ctrl/⌘+Shift+Z)">↷</button>
      </div>

      <div className="tb-group sim-controls">
        <button className={`run ${status === 'running' ? 'on' : ''}`} onClick={runSim} title="Run transient simulation">
          ▶ Run
        </button>
        <button onClick={pauseSim} disabled={status !== 'running'} title="Pause">
          ❚❚<span className="lbl"> Pause</span>
        </button>
        <button onClick={stopSim} disabled={status === 'stopped'} title="Stop and clear results">
          ■<span className="lbl"> Stop</span>
        </button>
        <button onClick={resetSim} title="Reset time to 0 and restore initial conditions">
          ⟲<span className="lbl"> Reset</span>
        </button>
        <button onClick={stepOnce} disabled={status === 'running'} title="Advance one time step">
          ⇥<span className="lbl"> Step</span>
        </button>
      </div>

      <div className="tb-group speed">
        <label title="Simulated time per real second">
          <span>Speed</span>
          <input
            type="range"
            min={-6}
            max={1}
            step={0.05}
            value={sliderVal}
            onChange={(e) => set({ speed: Math.pow(10, Number(e.target.value)) })}
          />
          <b className="mono">{formatEng(speed, 's')}/s</b>
        </label>
        <label title="Integration time step (blank = automatic)">
          <span>Δt</span>
          <input
            className="mono dt"
            placeholder={`auto ${formatEng(stepSize(), 's')}`}
            value={hEditing ? hText : timestep ? formatEng(timestep, 's') : ''}
            onFocus={() => {
              setHEditing(true);
              setHText(timestep ? formatEng(timestep, 's') : '');
            }}
            onChange={(e) => setHText(e.target.value)}
            onBlur={() => {
              setHEditing(false);
              const v = parseEng(hText);
              if (!hText.trim() || hText.trim().toLowerCase() === 'auto') set({ timestep: null });
              else if (Number.isFinite(v) && v > 0) set({ timestep: v });
              else notify('Time step must be a positive value such as 10u', 'warning');
              setHText('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      </div>

      <div className={`sim-status ${statusCls}`}>
        <span className="dot" />
        <span>{statusLabel}</span>
        <span className="mono">t = {formatEng(snapshot?.t ?? 0, 's')}</span>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group toggles">
        <button className={showVoltages ? 'on' : ''} onClick={() => set({ showVoltages: !showVoltages })} title="Show node voltages">
          V
        </button>
        <button className={showCurrents ? 'on' : ''} onClick={() => set({ showCurrents: !showCurrents })} title="Animate current flow">
          I
        </button>
        <button className={showVoltageColors ? 'on' : ''} onClick={() => set({ showVoltageColors: !showVoltageColors })} title="Color wires by voltage">
          ◐
        </button>
        <button className={learnMode ? 'on' : ''} onClick={() => set({ learnMode: !learnMode })} title="Learning mode: physics explanations">
          🎓<span className="lbl"> Learn</span>
        </button>
      </div>
      <div className="tb-group seg">
        <button className={centerView === 'schematic' ? 'on' : ''} onClick={() => set({ centerView: 'schematic' })}>
          Schematic
        </button>
        <button className={centerView === 'pcb' ? 'on' : ''} onClick={() => set({ centerView: 'pcb' })}>
          PCB
        </button>
      </div>
      <div className="circuit-name" title="Circuit name">
        {circuitName}
      </div>
      {loadOpen && <LoadDialog onClose={() => setLoadOpen(false)} />}
    </header>
  );
}
