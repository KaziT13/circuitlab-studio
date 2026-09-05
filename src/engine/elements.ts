// Element models and their MNA stamps.
//
// Unknown vector x = [v1 … v(N-1), i_b0 … i_b(M-1)]: node voltages (node 0 is
// the reference and not an unknown) followed by branch currents for elements
// that are defined by a voltage relation (ideal sources, ammeters, inductors).
//
// KCL rows: Σ currents leaving node k through elements = 0.

import { Component } from '../model/types';
import { LED_COLORS } from '../model/library';

export const VT = 0.025852; // thermal voltage at 300 K
export const GMIN = 1e-12;
const G_OFF = 1e-12;

export interface StampCtx {
  mode: 'dc' | 'tran';
  t: number;
  h: number;
  method: 'be' | 'trap';
  /** previous Newton iterate */
  x: Float64Array;
  /** zero every independent source (Thevenin resistance estimation) */
  zeroSources?: boolean;
  /** element whose own model is removed for a Thevenin test */
  testId?: string;
  /** source stepping factor for DC convergence */
  srcScale?: number;
}

export class Sys {
  size: number;
  A: Float64Array;
  b: Float64Array;
  constructor(public nn: number, public nb: number) {
    this.size = nn + nb;
    this.A = new Float64Array(this.size * this.size);
    this.b = new Float64Array(this.size);
  }
  clear() {
    this.A.fill(0);
    this.b.fill(0);
  }
  /** row/col index of node k (k=0 → ground → -1) */
  n(k: number) {
    return k - 1;
  }
  br(j: number) {
    return this.nn + j;
  }
  add(r: number, c: number, v: number) {
    if (r >= 0 && c >= 0) this.A[r * this.size + c] += v;
  }
  rhs(r: number, v: number) {
    if (r >= 0) this.b[r] += v;
  }
  /** conductance g between nodes a and b */
  G(a: number, b: number, g: number) {
    const ia = this.n(a);
    const ib = this.n(b);
    this.add(ia, ia, g);
    this.add(ib, ib, g);
    this.add(ia, ib, -g);
    this.add(ib, ia, -g);
  }
  /** constant current i flowing from node a, through the element, into node b */
  I(a: number, b: number, i: number) {
    this.rhs(this.n(a), -i);
    this.rhs(this.n(b), i);
  }
  /** voltage-defined branch: v(a) − v(b) − rSeries·i = V, i flows a→b through the element */
  V(a: number, b: number, j: number, V: number, rSeries = 0) {
    const ia = this.n(a);
    const ib = this.n(b);
    const k = this.br(j);
    this.add(ia, k, 1);
    this.add(ib, k, -1);
    this.add(k, ia, 1);
    this.add(k, ib, -1);
    if (rSeries) this.add(k, k, -rSeries);
    this.rhs(k, V);
  }
}

export class CSys {
  size: number;
  Ar: Float64Array;
  Ai: Float64Array;
  br_: Float64Array;
  bi: Float64Array;
  constructor(public nn: number, public nb: number) {
    this.size = nn + nb;
    this.Ar = new Float64Array(this.size * this.size);
    this.Ai = new Float64Array(this.size * this.size);
    this.br_ = new Float64Array(this.size);
    this.bi = new Float64Array(this.size);
  }
  n(k: number) {
    return k - 1;
  }
  brIdx(j: number) {
    return this.nn + j;
  }
  add(r: number, c: number, re: number, im: number) {
    if (r >= 0 && c >= 0) {
      this.Ar[r * this.size + c] += re;
      this.Ai[r * this.size + c] += im;
    }
  }
  rhs(r: number, re: number, im: number) {
    if (r >= 0) {
      this.br_[r] += re;
      this.bi[r] += im;
    }
  }
  Y(a: number, b: number, re: number, im: number) {
    const ia = this.n(a);
    const ib = this.n(b);
    this.add(ia, ia, re, im);
    this.add(ib, ib, re, im);
    this.add(ia, ib, -re, -im);
    this.add(ib, ia, -re, -im);
  }
  I(a: number, b: number, re: number, im: number) {
    this.rhs(this.n(a), -re, -im);
    this.rhs(this.n(b), re, im);
  }
  V(a: number, b: number, j: number, re: number, im: number, zr = 0, zi = 0) {
    const ia = this.n(a);
    const ib = this.n(b);
    const k = this.brIdx(j);
    this.add(ia, k, 1, 0);
    this.add(ib, k, -1, 0);
    this.add(k, ia, 1, 0);
    this.add(k, ib, -1, 0);
    if (zr || zi) this.add(k, k, -zr, -zi);
    this.rhs(k, re, im);
  }
}

export interface Reading {
  /** primary voltage (e.g. V(t1) − V(t2), Vce for BJTs) */
  v: number;
  /** primary current (enters terminal 1, leaves terminal 2) */
  i: number;
  /** power absorbed (negative = delivering) */
  p: number;
  extra?: Record<string, number | string>;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** exp with linear continuation above 80 to avoid overflow */
function sexp(x: number) {
  if (x > 80) return Math.exp(80) * (1 + x - 80);
  return Math.exp(x);
}

export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): [number, boolean] {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    } else {
      vnew = vt * Math.log(vnew / vt);
    }
    return [vnew, true];
  }
  return [vnew, false];
}

export abstract class Element {
  branches = 0;
  /** first branch index (assigned by the simulator) */
  b0 = 0;
  nonlinear = false;
  /** set during stamping if junction voltage limiting was applied */
  limited = false;
  /** number of non-ground nodes (offset of the branch-current block in x) */
  nn = 0;
  constructor(
    public comp: Component,
    public nodes: number[],
  ) {}
  get id() {
    return this.comp.id;
  }
  v(x: Float64Array, k: number) {
    const n = this.nodes[k];
    return n === 0 ? 0 : x[n - 1];
  }
  abstract stamp(s: Sys, ctx: StampCtx): void;
  stampAC(_s: CSys, _w: number): void {}
  /** called once a time step has converged */
  accept(_x: Float64Array, _ctx: StampCtx): void {}
  /** reset dynamic state to initial conditions */
  reset(): void {}
  getState(): unknown {
    return null;
  }
  setState(_s: unknown): void {}
  /** currents flowing INTO the element at each terminal */
  abstract terminalCurrents(x: Float64Array, ctx: StampCtx): number[];
  reading(x: Float64Array, ctx: StampCtx): Reading {
    const ic = this.terminalCurrents(x, ctx);
    let p = 0;
    for (let k = 0; k < this.nodes.length; k++) p += this.v(x, k) * ic[k];
    return { v: this.v(x, 0) - this.v(x, 1), i: ic[0], p };
  }
  /** AC: returns [v, i] phasors as [vr, vi, ir, ii] */
  readingAC(xr: Float64Array, xi: Float64Array, w: number): [number, number, number, number] {
    const vr = this.cv(xr, 0) - this.cv(xr, 1);
    const vi = this.cv(xi, 0) - this.cv(xi, 1);
    const [ir, ii] = this.currentAC(xr, xi, w);
    return [vr, vi, ir, ii];
  }
  currentAC(_xr: Float64Array, _xi: Float64Array, _w: number): [number, number] {
    return [0, 0];
  }
  cv(x: Float64Array, k: number) {
    const n = this.nodes[k];
    return n === 0 ? 0 : x[n - 1];
  }
}

// ---------------------------------------------------------------- resistive

export class ResistiveElement extends Element {
  conductance(): number {
    const c = this.comp;
    switch (c.type) {
      case 'resistor':
        return 1 / Math.max(num(c.props.resistance, 1000), 1e-9);
      case 'bulb': {
        const v = num(c.props.ratedVoltage, 12);
        const p = Math.max(num(c.props.ratedPower, 5), 1e-9);
        return p / (v * v);
      }
      case 'switch':
        return c.props.closed ? 1 / Math.max(num(c.props.onResistance, 0.01), 1e-6) : G_OFF;
      case 'pushbutton':
        return c.props.__pressed ? 1 / Math.max(num(c.props.onResistance, 0.01), 1e-6) : G_OFF;
      default:
        return G_OFF;
    }
  }
  stamp(s: Sys) {
    s.G(this.nodes[0], this.nodes[1], this.conductance());
  }
  stampAC(s: CSys) {
    s.Y(this.nodes[0], this.nodes[1], this.conductance(), 0);
  }
  terminalCurrents(x: Float64Array) {
    const i = (this.v(x, 0) - this.v(x, 1)) * this.conductance();
    return [i, -i];
  }
  currentAC(xr: Float64Array, xi: Float64Array): [number, number] {
    const g = this.conductance();
    return [(this.cv(xr, 0) - this.cv(xr, 1)) * g, (this.cv(xi, 0) - this.cv(xi, 1)) * g];
  }
  reading(x: Float64Array, ctx: StampCtx): Reading {
    const r = super.reading(x, ctx);
    if (this.comp.type === 'bulb') {
      const rated = Math.max(num(this.comp.props.ratedPower, 5), 1e-9);
      r.extra = { brightness: Math.min(r.p / rated, 2), resistance: 1 / this.conductance() };
    }
    if (this.comp.type === 'resistor') {
      const rating = num(this.comp.props.powerRating, 0.25);
      r.extra = { ratingUse: r.p / rating };
    }
    return r;
  }
}

export class SpdtElement extends Element {
  gs(): [number, number] {
    const on = 1 / Math.max(num(this.comp.props.onResistance, 0.01), 1e-6);
    return this.comp.props.position === 'B' ? [G_OFF, on] : [on, G_OFF];
  }
  stamp(s: Sys) {
    const [ga, gb] = this.gs();
    s.G(this.nodes[0], this.nodes[2], ga);
    s.G(this.nodes[1], this.nodes[2], gb);
  }
  stampAC(s: CSys) {
    const [ga, gb] = this.gs();
    s.Y(this.nodes[0], this.nodes[2], ga, 0);
    s.Y(this.nodes[1], this.nodes[2], gb, 0);
  }
  terminalCurrents(x: Float64Array) {
    const [ga, gb] = this.gs();
    const ia = (this.v(x, 0) - this.v(x, 2)) * ga;
    const ib = (this.v(x, 1) - this.v(x, 2)) * gb;
    return [ia, ib, -(ia + ib)];
  }
  reading(x: Float64Array, ctx: StampCtx): Reading {
    const ic = this.terminalCurrents(x);
    const k = this.comp.props.position === 'B' ? 1 : 0;
    let p = 0;
    for (let j = 0; j < 3; j++) p += this.v(x, j) * ic[j];
    void ctx;
    return { v: this.v(x, k) - this.v(x, 2), i: ic[k], p, extra: { position: String(this.comp.props.position) } };
  }
  readingAC(xr: Float64Array, xi: Float64Array): [number, number, number, number] {
    const [ga, gb] = this.gs();
    const k = this.comp.props.position === 'B' ? 1 : 0;
    const g = k ? gb : ga;
    const vr = this.cv(xr, k) - this.cv(xr, 2);
    const vi = this.cv(xi, k) - this.cv(xi, 2);
    return [vr, vi, vr * g, vi * g];
  }
}

// ---------------------------------------------------------------- reactive

export class CapacitorElement extends Element {
  vPrev = 0;
  iPrev = 0;
  get C() {
    return Math.max(num(this.comp.props.capacitance, 1e-6), 1e-18);
  }
  reset() {
    this.vPrev = num(this.comp.props.initialVoltage, 0);
    this.iPrev = 0;
  }
  getState() {
    return { vPrev: this.vPrev, iPrev: this.iPrev };
  }
  setState(s: { vPrev: number; iPrev: number }) {
    this.vPrev = s.vPrev;
    this.iPrev = s.iPrev;
  }
  companion(ctx: StampCtx): [number, number] {
    // i = geq·v − ieq
    if (ctx.method === 'be') {
      const g = this.C / ctx.h;
      return [g, g * this.vPrev];
    }
    const g = (2 * this.C) / ctx.h;
    return [g, g * this.vPrev + this.iPrev];
  }
  stamp(s: Sys, ctx: StampCtx) {
    const [a, b] = this.nodes;
    if (ctx.mode === 'dc' || ctx.testId === this.id) {
      s.G(a, b, GMIN);
      return;
    }
    const [g, ieq] = this.companion(ctx);
    s.G(a, b, g);
    s.I(a, b, -ieq);
  }
  stampAC(s: CSys, w: number) {
    s.Y(this.nodes[0], this.nodes[1], GMIN, w * this.C);
  }
  /** current reported for the last accepted time point (state already advanced by accept) */
  terminalCurrents(x: Float64Array, ctx: StampCtx) {
    if (ctx.mode === 'dc') {
      const v = this.v(x, 0) - this.v(x, 1);
      return [v * GMIN, -v * GMIN];
    }
    return [this.iPrev, -this.iPrev];
  }
  accept(x: Float64Array, ctx: StampCtx) {
    const v = this.v(x, 0) - this.v(x, 1);
    const [g, ieq] = this.companion(ctx); // uses the previous state
    this.iPrev = g * v - ieq;
    this.vPrev = v;
  }
  currentAC(xr: Float64Array, xi: Float64Array, w: number): [number, number] {
    const vr = this.cv(xr, 0) - this.cv(xr, 1);
    const vi = this.cv(xi, 0) - this.cv(xi, 1);
    const B = w * this.C;
    return [-B * vi, B * vr];
  }
  reading(x: Float64Array, ctx: StampCtx): Reading {
    const r = super.reading(x, ctx);
    const rating = num(this.comp.props.voltageRating, 50);
    r.extra = { energy: 0.5 * this.C * r.v * r.v, charge: this.C * r.v, ratingUse: Math.abs(r.v) / rating };
    return r;
  }
}

export class InductorElement extends Element {
  branches = 1;
  iPrev = 0;
  vPrev = 0;
  get L() {
    return Math.max(num(this.comp.props.inductance, 1e-3), 1e-15);
  }
  reset() {
    this.iPrev = num(this.comp.props.initialCurrent, 0);
    this.vPrev = 0;
  }
  getState() {
    return { iPrev: this.iPrev, vPrev: this.vPrev };
  }
  setState(s: { iPrev: number; vPrev: number }) {
    this.iPrev = s.iPrev;
    this.vPrev = s.vPrev;
  }
  stamp(s: Sys, ctx: StampCtx) {
    const [a, b] = this.nodes;
    if (ctx.testId === this.id) {
      // removed: force branch current to zero
      const k = s.br(this.b0);
      s.add(s.n(a), k, 1);
      s.add(s.n(b), k, -1);
      s.add(k, k, 1);
      return;
    }
    if (ctx.mode === 'dc') {
      s.V(a, b, this.b0, 0);
      return;
    }
    if (ctx.method === 'be') {
      const req = this.L / ctx.h;
      s.V(a, b, this.b0, -req * this.iPrev, req);
    } else {
      const req = (2 * this.L) / ctx.h;
      s.V(a, b, this.b0, -req * this.iPrev - this.vPrev, req);
    }
  }
  stampAC(s: CSys, w: number) {
    s.V(this.nodes[0], this.nodes[1], this.b0, 0, 0, 0, w * this.L);
  }
  terminalCurrents(x: Float64Array) {
    const i = x[this.nodesLen() + this.b0];
    return [i, -i];
  }
  /** offset of the branch block — injected by the simulator */
  nn = 0;
  nodesLen() {
    return this.nn;
  }
  accept(x: Float64Array) {
    this.iPrev = x[this.nn + this.b0];
    this.vPrev = this.v(x, 0) - this.v(x, 1);
  }
  currentAC(xr: Float64Array, xi: Float64Array): [number, number] {
    return [xr[this.nn + this.b0], xi[this.nn + this.b0]];
  }
  reading(x: Float64Array, ctx: StampCtx): Reading {
    const r = super.reading(x, ctx);
    const rating = num(this.comp.props.currentRating, 1);
    r.extra = { energy: 0.5 * this.L * r.i * r.i, ratingUse: Math.abs(r.i) / rating };
    return r;
  }
}
