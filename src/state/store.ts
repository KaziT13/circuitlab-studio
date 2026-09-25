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
