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
