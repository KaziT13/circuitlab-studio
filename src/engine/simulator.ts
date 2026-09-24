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

  /** Newton–Raphson solve of the (possibly nonlinear) MNA system. */
  private newton(ctx: StampCtx, maxIter = MAX_NEWTON, gminExtra = 0): SolveResult {
    const s = this.sys;
    const size = s.size;
    if (size === 0) return { ok: true, iterations: 0 };
    let x = this.x;
    for (let it = 0; it < maxIter; it++) {
      s.clear();
      ctx.x = x;
      for (const el of this.elements) el.stamp(s, ctx);
      // gmin to ground on every node keeps floating nodes solvable
      for (let k = 0; k < this.nn; k++) s.A[k * size + k] += GMIN + gminExtra;
      let xn: Float64Array;
      try {
        xn = solveReal(s.A, s.b, size);
      } catch (e) {
        if (e instanceof SingularMatrixError) return { ok: false, error: this.explainSingular(e.row, ctx) };
        throw e;
      }
      for (let k = 0; k < size; k++) {
        if (!Number.isFinite(xn[k])) return { ok: false, error: 'Numerical overflow — the solution diverged.' };
      }
      if (!this.hasNonlinear) {
        this.x = xn;
        return { ok: true, iterations: 1 };
      }
      let conv = true;
      for (let k = 0; k < size; k++) {
        const tol = k < this.nn ? 1e-6 + 1e-6 * Math.abs(xn[k]) : 1e-9 + 1e-6 * Math.abs(xn[k]);
        if (Math.abs(xn[k] - x[k]) > tol) {
          conv = false;
          break;
        }
      }
      const limited = this.elements.some((e) => e.limited);
      x = xn;
      if (conv && !limited && it > 0) {
        this.x = x;
        return { ok: true, iterations: it + 1 };
      }
    }
    this.x = x;
    return { ok: false, error: 'Newton–Raphson iteration did not converge (nonlinear devices).' };
  }

  /** DC operating point: capacitors open, inductors shorted, AC sources at their DC offset. */
  solveDC(): SolveResult {
    const err = this.blockingError();
    if (err) return { ok: false, error: err };
    const ctx: StampCtx = { mode: 'dc', t: 0, h: 1, method: 'be', x: this.x };
    this.lastCtx = ctx;
    for (const el of this.elements) if (el.nonlinear) el.reset();
    this.x = new Float64Array(this.nn + this.nb);
    let r = this.newton(ctx);
    if (!r.ok && this.hasNonlinear && !r.error?.startsWith('Cannot')) {
      // gmin stepping fallback
      this.x = new Float64Array(this.nn + this.nb);
      for (const el of this.elements) if (el.nonlinear) el.reset();
      for (let g = 1e-2; g >= 1e-12; g /= 10) {
        r = this.newton(ctx, MAX_NEWTON, g);
        if (!r.ok) break;
      }
      if (r.ok) r = this.newton(ctx);
      if (!r.ok) {
        // source stepping fallback
        this.x = new Float64Array(this.nn + this.nb);
        for (const el of this.elements) if (el.nonlinear) el.reset();
        for (let sc = 0.1; sc <= 1.0001; sc += 0.1) {
          ctx.srcScale = Math.min(sc, 1);
          r = this.newton(ctx);
          if (!r.ok) break;
        }
        ctx.srcScale = 1;
      }
    }
    return r;
  }

  /** Advance the transient simulation by one step of size h. */
  step(h: number): SolveResult {
    const err = this.blockingError();
    if (err) return { ok: false, error: err };
    const method = this.needBE ? 'be' : 'trap';
    const ctx: StampCtx = { mode: 'tran', t: this.t + h, h, method, x: this.x };
    const saved = this.x;
    let r = this.newton(ctx);
    if (!r.ok && this.hasNonlinear && !r.error?.startsWith('Cannot')) {
      // retry with smaller sub-steps using backward Euler
      this.x = saved;
      const sub = 8;
      for (let k = 1; k <= sub; k++) {
        const c2: StampCtx = { mode: 'tran', t: this.t + (h * k) / sub, h: h / sub, method: 'be', x: this.x };
        r = this.newton(c2, 300);
        if (!r.ok) return r;
        for (const el of this.elements) el.accept(this.x, c2);
        this.lastCtx = c2;
      }
      this.t += h;
      this.needBE = true;
      return r;
    }
    if (!r.ok) return r;
    for (const el of this.elements) el.accept(this.x, ctx);
    this.lastCtx = ctx;
    this.t += h;
    this.needBE = false;
    return r;
  }

  /** Readings for every component at the current solution. */
  snapshot(extraIssues: Issue[] = []): SimSnapshot {
    const ctx = this.lastCtx;
    const x = this.x;
    const nodeV = [0];
    for (let k = 0; k < this.nn; k++) nodeV.push(x[k] ?? 0);
    const readings: Record<string, Reading> = {};
    const termCurrents: Record<string, number[]> = {};
    const kcl = new Float64Array(this.nn + 1);
    let pSum = 0;
    let pScale = 0;
    for (const el of this.elements) {
      const tc = el.terminalCurrents(x, ctx);
      termCurrents[el.id] = tc;
      el.nodes.forEach((n, k) => (kcl[n] += tc[k]));
      const r = el.reading(x, ctx);
      readings[el.id] = r;
      pSum += r.p;
      pScale += Math.abs(r.p);
    }
    let kclResidual = 0;
    for (let k = 1; k <= this.nn; k++) {
      // account for the gmin shunt to ground
      kclResidual = Math.max(kclResidual, Math.abs(kcl[k] + nodeV[k] * GMIN));
    }
    const issues: Issue[] = [...extraIssues];
    let maxI = 1e-3;
    for (const id in termCurrents) for (const c of termCurrents[id]) maxI = Math.max(maxI, Math.abs(c));
    if (kclResidual > 1e-4 * maxI + 1e-7) {
      issues.push({ level: 'warning', message: `KCL check: node current residual ${kclResidual.toExponential(2)} A is larger than expected — results may be inaccurate.` });
    }
    for (const el of this.elements) {
      const r = readings[el.id];
      const use = r.extra?.ratingUse;
      if (typeof use === 'number' && use > 1) {
        const c = el.comp;
        const what =
          c.type === 'resistor'
            ? `dissipates ${r.p.toFixed(3)} W, above its ${c.props.powerRating} W rating`
            : c.type === 'capacitor'
              ? `voltage exceeds its ${c.props.voltageRating} V rating`
              : c.type === 'inductor'
                ? `current exceeds its ${c.props.currentRating} A rating`
                : `forward current ${(r.i * 1000).toFixed(1)} mA exceeds its ${(Number(c.props.maxCurrent) * 1000).toFixed(0)} mA maximum — add a current-limiting resistor`;
        issues.push({ level: 'warning', compId: c.id, message: `${c.label} ${what}.` });
      }
    }
    return {
      t: this.t,
      nodeV,
      readings,
      termCurrents,
      kclResidual,
      powerBalance: pScale > 0 ? pSum : 0,
      issues,
    };
  }
}
