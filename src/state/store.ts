import { create } from 'zustand';
import { Circuit, Component, CompType, emptyCircuit, newId, Point, PropValue, snap, Wire } from '../model/types';
import { DEFS, nextLabel, terminalPositions } from '../model/library';
import type { SimSnapshot } from '../engine/simulator';
import type { Issue } from '../engine/netlist';

export type Selection = { kind: 'comp' | 'wire'; id: string } | null;
export type Tool = 'select' | 'wire' | 'probe';
export type SimStatus = 'stopped' | 'running' | 'paused';
export type BottomTab = 'scope' | 'dc' | 'ac' | 'calc' | 'tutor' | 'spice';
export type CenterView = 'schematic' | 'pcb';

export interface Probe {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
}

export const PROBE_COLORS = ['#ffd23f', '#4dd0e1', '#ff6bd5', '#7cff6b', '#ff9f43', '#a78bfa'];

export interface View {
  x: number;
  y: number;
  zoom: number;
}

interface State {
  circuit: Circuit;
  past: Circuit[];
  future: Circuit[];
  selection: Selection;
  tool: Tool;
  view: View;
  centerView: CenterView;

  simStatus: SimStatus;
  speed: number;
  timestep: number | null;
  snapshot: SimSnapshot | null;
  simError: string | null;
  lagging: boolean;
  autoH: number;
  pressed: Record<string, true>;

  showVoltages: boolean;
  showCurrents: boolean;
  showVoltageColors: boolean;
  learnMode: boolean;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  scopeSignals: string[];
  probes: Probe[];
  activeExample: string | null;
  toast: { text: string; level: Issue['level'] | 'success' } | null;

  set: (p: Partial<State>) => void;
  /** apply a change to the circuit, recording undo history */
  edit: (fn: (c: Circuit) => Circuit, opts?: { history?: boolean }) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  loadCircuit: (c: Circuit, example?: string | null) => void;

  addComponent: (type: CompType, at: Point) => string;
  moveComponent: (id: string, x: number, y: number, attached: { wireId: string; idx: number; dx: number; dy: number }[]) => void;
  rotateSelected: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  setProp: (id: string, key: string, value: PropValue) => void;
  setLabel: (id: string, label: string) => void;
  addWire: (pts: Point[]) => void;
  toggleSwitch: (id: string) => void;
  setPressed: (id: string, on: boolean) => void;
  addProbe: (p: Point) => void;
  removeProbe: (id: string) => void;
  notify: (text: string, level?: Issue['level'] | 'success') => void;
}

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x) === 0;
      const sameDir = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0;
      if (collinear && sameDir) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  circuit: emptyCircuit(),
  past: [],
  future: [],
  selection: null,
  tool: 'select',
  view: { x: 80, y: 40, zoom: 1.25 },
  centerView: 'schematic',

  simStatus: 'stopped',
  speed: 0.01,
  timestep: null,
  snapshot: null,
  simError: null,
  lagging: false,
  autoH: 1e-5,
  pressed: {},

  showVoltages: true,
  showCurrents: true,
  showVoltageColors: true,
  learnMode: true,
  bottomTab: 'scope',
  bottomOpen: true,
  leftOpen: true,
  rightOpen: true,
  scopeSignals: [],
  probes: [],
  activeExample: null,
  toast: null,

  set: (p) => set(p),

  pushHistory: () => {
    const { circuit, past } = get();
    set({ past: [...past.slice(-99), circuit], future: [] });
  },

  edit: (fn, opts = {}) => {
    const { circuit, past } = get();
    const next = fn(circuit);
    if (next === circuit) return;
    if (opts.history !== false) set({ circuit: next, past: [...past.slice(-99), circuit], future: [] });
    else set({ circuit: next });
  },

  undo: () => {
    const { past, circuit, future } = get();
    if (!past.length) return;
    set({ circuit: past[past.length - 1], past: past.slice(0, -1), future: [circuit, ...future], selection: null });
  },
  redo: () => {
    const { past, circuit, future } = get();
    if (!future.length) return;
    set({ circuit: future[0], future: future.slice(1), past: [...past, circuit], selection: null });
  },

  loadCircuit: (c, example = null) => {
    get().pushHistory();
    set({ circuit: c, selection: null, activeExample: example, probes: [], scopeSignals: [] });
  },

  addComponent: (type, at) => {
    const id = newId(type);
    get().edit((c) => {
      const comp: Component = {
        id,
        type,
        x: snap(at.x),
        y: snap(at.y),
        rot: 0,
        label: nextLabel(type, c.components),
        props: { ...DEFS[type].defaults },
      };
      return { ...c, components: [...c.components, comp] };
    });
    set({ selection: { kind: 'comp', id } });
    return id;
  },

  moveComponent: (id, x, y, attached) => {
    get().edit(
      (c) => {
        const comp = c.components.find((k) => k.id === id);
        if (!comp || (comp.x === x && comp.y === y)) return c;
        const dx = x - comp.x;
        const dy = y - comp.y;
        const byWire = new Map<string, { idx: number }[]>();
        for (const a of attached) {
          if (!byWire.has(a.wireId)) byWire.set(a.wireId, []);
          byWire.get(a.wireId)!.push(a);
        }
        return {
          ...c,
          components: c.components.map((k) => (k.id === id ? { ...k, x, y } : k)),
          wires: c.wires.map((w) => {
            const at = byWire.get(w.id);
            if (!at) return w;
            const pts = w.points.map((p) => ({ ...p }));
            for (const a of at) {
              pts[a.idx] = { x: pts[a.idx].x + dx, y: pts[a.idx].y + dy };
              // keep the adjacent segment orthogonal by dragging its neighbour along
              const nIdx = a.idx === 0 ? 1 : a.idx - 1;
              if (pts.length > 2 && nIdx >= 0 && nIdx < pts.length && nIdx !== 0 && nIdx !== pts.length - 1) {
                const n = pts[nIdx];
                const orig = w.points[a.idx];
                if (n.x === orig.x) n.x = pts[a.idx].x;
                else if (n.y === orig.y) n.y = pts[a.idx].y;
              }
            }
            return { ...w, points: pts };
          }),
        };
      },
      { history: false },
    );
  },

  rotateSelected: () => {
    const sel = get().selection;
    if (sel?.kind !== 'comp') return;
    get().edit((c) => ({
      ...c,
      components: c.components.map((k) => (k.id === sel.id ? { ...k, rot: (k.rot + 90) % 360 } : k)),
    }));
  },

  deleteSelected: () => {
    const sel = get().selection;
    if (!sel) return;
    get().edit((c) =>
      sel.kind === 'comp'
        ? { ...c, components: c.components.filter((k) => k.id !== sel.id) }
        : { ...c, wires: c.wires.filter((w) => w.id !== sel.id) },
    );
    set({ selection: null });
  },

  duplicateSelected: () => {
    const sel = get().selection;
    if (sel?.kind !== 'comp') return;
    const src = get().circuit.components.find((k) => k.id === sel.id);
    if (!src) return;
    const id = newId(src.type);
    get().edit((c) => ({
      ...c,
      components: [
        ...c.components,
        { ...src, id, x: src.x + 60, y: src.y + 60, label: nextLabel(src.type, c.components), props: { ...src.props } },
      ],
    }));
    set({ selection: { kind: 'comp', id } });
  },

  setProp: (id, key, value) =>
    get().edit((c) => ({
      ...c,
      components: c.components.map((k) => (k.id === id ? { ...k, props: { ...k.props, [key]: value } } : k)),
    })),

  setLabel: (id, label) =>
    get().edit((c) => ({ ...c, components: c.components.map((k) => (k.id === id ? { ...k, label } : k)) })),

  addWire: (pts) => {
    const points = simplify(pts.map((p) => ({ x: snap(p.x), y: snap(p.y) })));
    if (points.length < 2) return;
    const w: Wire = { id: newId('w'), points };
    get().edit((c) => ({ ...c, wires: [...c.wires, w] }));
  },

  toggleSwitch: (id) => {
    const comp = get().circuit.components.find((k) => k.id === id);
    if (!comp) return;
    if (comp.type === 'switch') get().setProp(id, 'closed', !comp.props.closed);
    if (comp.type === 'spdt') get().setProp(id, 'position', comp.props.position === 'A' ? 'B' : 'A');
  },

  setPressed: (id, on) => {
    const p = { ...get().pressed };
    if (on) p[id] = true;
    else delete p[id];
    set({ pressed: p });
  },

  addProbe: (pt) => {
    const probes = get().probes;
    if (probes.some((p) => p.x === pt.x && p.y === pt.y)) return;
    const k = probes.length;
    const probe: Probe = { id: newId('probe'), x: pt.x, y: pt.y, color: PROBE_COLORS[k % PROBE_COLORS.length], name: `CH${k + 1}` };
    set({ probes: [...probes, probe], scopeSignals: [...get().scopeSignals, `probe:${probe.id}`] });
  },
  removeProbe: (id) =>
    set({ probes: get().probes.filter((p) => p.id !== id), scopeSignals: get().scopeSignals.filter((s) => s !== `probe:${id}`) }),

  notify: (text, level = 'info') => {
    set({ toast: { text, level } });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

/** wire endpoints that sit on a component's terminals (they follow the component when dragged) */
export function attachedWireEnds(c: Circuit, compId: string) {
  const comp = c.components.find((k) => k.id === compId);
  if (!comp) return [];
  const terms = terminalPositions(comp);
  const out: { wireId: string; idx: number; dx: number; dy: number }[] = [];
  for (const w of c.wires) {
    const last = w.points.length - 1;
    [0, last].forEach((idx) => {
      const p = w.points[idx];
      if (terms.some((t) => t.x === p.x && t.y === p.y)) {
        // don't move it if another component's terminal also sits there
        const shared = c.components.some(
          (o) => o.id !== compId && terminalPositions(o).some((t) => t.x === p.x && t.y === p.y),
        );
        if (!shared && !out.some((o) => o.wireId === w.id && o.idx === idx)) out.push({ wireId: w.id, idx, dx: 0, dy: 0 });
      }
    });
  }
  return out;
}
