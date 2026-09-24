// Modified Nodal Analysis simulator: DC operating point, transient
// (trapezoidal / backward-Euler companion models) and AC phasor analysis.

import { Circuit, Component } from '../model/types';
import { solveComplex, solveReal, SingularMatrixError } from './linalg';
import { buildNetlist, Issue, Netlist } from './netlist';
import { CSys, Element, GMIN, makeElement, Reading, StampCtx, Sys } from './elements';

export interface SolveResult {
  ok: boolean;
  error?: string;
  iterations?: number;
}

export interface SimSnapshot {
  t: number;
  nodeV: number[];
  readings: Record<string, Reading>;
  /** currents flowing INTO each component at each terminal */
  termCurrents: Record<string, number[]>;
  kclResidual: number;
  powerBalance: number;
  issues: Issue[];
}

export interface ACComp {
  v: [number, number];
  i: [number, number];
}
export interface ACResult {
  ok: boolean;
  error?: string;
  freq: number;
  nodeV: [number, number][];
  comps: Record<string, ACComp>;
}

const MAX_NEWTON = 150;

export class Simulator {
  netlist: Netlist;
  elements: Element[] = [];
  byId = new Map<string, Element>();
  nn = 0;
  nb = 0;
  x: Float64Array;
  t = 0;
  /** use backward Euler on the next step (start-up / after a discontinuity) */
  needBE = true;
  lastCtx: StampCtx;
  sys: Sys;
  circuit: Circuit;
  hasNonlinear = false;

  constructor(circuit: Circuit, pressed: Set<string> = new Set()) {
    this.circuit = circuit;
    this.netlist = buildNetlist(circuit);
    this.x = new Float64Array(0);
    this.sys = new Sys(0, 0);
    this.lastCtx = { mode: 'dc', t: 0, h: 1e-5, method: 'be', x: this.x };
    this.compile(circuit, pressed, false);
  }

  /** Build the element list. With keepState, dynamic state (capacitor voltages,
   *  inductor currents, Newton history) of components that still exist is kept. */
  compile(circuit: Circuit, pressed: Set<string>, keepState = true) {
    const oldStates = new Map<string, unknown>();
    const oldX = this.x;
    const oldNodeOf = new Map<string, number[]>();
    if (keepState) {
      for (const el of this.elements) {
        oldStates.set(el.id, el.getState());
        oldNodeOf.set(el.id, el.nodes);
      }
    }
    this.circuit = circuit;
    this.netlist = buildNetlist(circuit);
    this.nn = Math.max(this.netlist.nodeCount - 1, 0);
    this.elements = [];
    this.byId.clear();
    let nb = 0;
    for (const c of circuit.components) {
      const comp: Component = pressed.has(c.id) ? { ...c, props: { ...c.props, __pressed: true } } : c;
      const el = makeElement(comp, this.netlist.compNodes.get(c.id)!);
      el.b0 = nb;
      el.nn = this.nn;
      nb += el.branches;
      el.reset();
      if (oldStates.has(c.id) && oldStates.get(c.id) !== null) el.setState(oldStates.get(c.id));
      this.elements.push(el);
      this.byId.set(c.id, el);
    }
    this.nb = nb;
    this.hasNonlinear = this.elements.some((e) => e.nonlinear);
    this.sys = new Sys(this.nn, this.nb);
    const x = new Float64Array(this.nn + this.nb);
    // carry node voltages over as a Newton starting guess
    if (keepState && oldX.length) {
      for (const el of this.elements) {
        const prev = oldNodeOf.get(el.id);
        if (!prev) continue;
        el.nodes.forEach((n, k) => {
          if (n > 0 && prev[k] > 0 && prev[k] - 1 < oldX.length) x[n - 1] = oldX[prev[k] - 1];
        });
      }
    }
    this.x = x;
    this.needBE = true;
  }

  reset() {
    this.t = 0;
    for (const el of this.elements) el.reset();
    this.x = new Float64Array(this.nn + this.nb);
    this.needBE = true;
  }

  blockingError(): string | null {
    const e = this.netlist.issues.find((i) => i.level === 'error');
    return e ? e.message : null;
  }

  private explainSingular(idx: number, ctx: StampCtx): string {
    if (idx >= this.nn) {
      const j = idx - this.nn;
      const el = this.elements.find((e) => e.branches > 0 && j >= e.b0 && j < e.b0 + e.branches);
      if (el) {
        if (el.comp.type === 'inductor' && ctx.mode === 'dc')
          return `Cannot solve: ${el.comp.label} (a DC short) forms a loop with a voltage source or another inductor. Add series resistance.`;
        return `Cannot solve: ${el.comp.label} creates a conflicting voltage loop or is connected across an ideal source. Check for parallel ideal sources / ammeters.`;
      }
    }
    return 'Circuit equations are singular — check for loops of ideal voltage sources, ammeters or inductors.';
  }
}
