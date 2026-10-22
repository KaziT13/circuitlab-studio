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
