// Real-time transient simulation driver. Lives outside React: it steps the
// solver inside requestAnimationFrame, records waveform history and publishes
// a snapshot to the store for the UI to render.

import { Circuit, pkey, Point } from '../model/types';
import { terminalPositions } from '../model/library';
import { Simulator, SimSnapshot } from '../engine/simulator';
import { Netlist, pointOnSegment } from '../engine/netlist';
import { useStore } from './store';

// ------------------------------------------------------------------ history

export class History {
  t: number[] = [];
  data = new Map<string, number[]>();
  version = 0;
  maxLen = 40000;
  clear() {
    this.t = [];
    this.data = new Map();
    this.version++;
  }
  push(t: number, sample: Map<string, number>) {
    const n = this.t.length;
    this.t.push(t);
    for (const [k, v] of sample) {
      let arr = this.data.get(k);
      if (!arr) {
        arr = new Array(n).fill(NaN);
        this.data.set(k, arr);
      }
      arr.push(v);
    }
    for (const [k, arr] of this.data) if (!sample.has(k)) arr.push(NaN);
    if (this.t.length > this.maxLen * 1.25) {
      const cut = this.t.length - this.maxLen;
      this.t = this.t.slice(cut);
      for (const [k, arr] of this.data) this.data.set(k, arr.slice(cut));
    }
    this.version++;
  }
}

export const history = new History();

// ------------------------------------------------------------------ signals

export interface SignalInfo {
  key: string;
  name: string;
  unit: 'V' | 'A' | 'W';
  group: string;
}

export function listSignals(circuit: Circuit, netlist: Netlist): SignalInfo[] {
  const out: SignalInfo[] = [];
  for (const p of useStore.getState().probes) {
    out.push({ key: `probe:${p.id}`, name: `${p.name} (probe)`, unit: 'V', group: 'Probes' });
  }
  for (let i = 1; i < netlist.nodeCount; i++) out.push({ key: `n:${i}`, name: `V(${netlist.netNames[i]})`, unit: 'V', group: 'Node voltages' });
  for (const c of circuit.components) {
    if (c.type === 'ground') continue;
    if (c.type !== 'ammeter') out.push({ key: `v:${c.id}`, name: `V(${c.label})`, unit: 'V', group: 'Component voltage' });
    if (c.type !== 'voltmeter') out.push({ key: `i:${c.id}`, name: `I(${c.label})`, unit: 'A', group: 'Component current' });
    if (c.type !== 'voltmeter' && c.type !== 'ammeter') out.push({ key: `p:${c.id}`, name: `P(${c.label})`, unit: 'W', group: 'Component power' });
  }
  return out;
}

/** net index under a canvas point (terminal or anywhere along a wire), or -1 */
export function netAtPoint(circuit: Circuit, netlist: Netlist, p: Point): number {
  for (const c of circuit.components) {
    const tp = terminalPositions(c);
    for (let k = 0; k < tp.length; k++) if (tp[k].x === p.x && tp[k].y === p.y) return netlist.compNodes.get(c.id)![k];
  }
  for (const s of netlist.segments) if (pointOnSegment(p, s.a, s.b, true)) return s.net;
  return -1;
}

function sampleOf(snap: SimSnapshot, circuit: Circuit, netlist: Netlist, probeNets: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, net] of probeNets) m.set(`probe:${id}`, net >= 0 ? snap.nodeV[net] ?? NaN : NaN);
  for (let i = 1; i < netlist.nodeCount; i++) m.set(`n:${i}`, snap.nodeV[i]);
  for (const c of circuit.components) {
    const r = snap.readings[c.id];
    if (!r || c.type === 'ground') continue;
    if (c.type !== 'ammeter') m.set(`v:${c.id}`, r.v);
    if (c.type !== 'voltmeter') m.set(`i:${c.id}`, r.i);
    if (c.type !== 'voltmeter' && c.type !== 'ammeter') m.set(`p:${c.id}`, r.p);
  }
  return m;
}

// ------------------------------------------------------------------ wire currents

/** Current along each elementary wire segment (a→b positive), from terminal currents.
 *  Each net's wiring is a graph; on a spanning tree the edge currents follow uniquely from KCL. */
export function segmentCurrents(netlist: Netlist, circuit: Circuit, termCurrents: Record<string, number[]>): Float64Array {
  const segs = netlist.segments;
  const cur = new Float64Array(segs.length);
  const inj = new Map<string, number>();
  for (const c of circuit.components) {
    const tc = termCurrents[c.id];
    if (!tc) continue;
    terminalPositions(c).forEach((p, k) => {
      const key = pkey(p);
      inj.set(key, (inj.get(key) ?? 0) - tc[k]); // current leaving the component into the wire
    });
  }
  const adj = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = pkey(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push(i);
    }
  });
  const visited = new Set<string>();
  const usedEdge = new Uint8Array(segs.length);
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    // iterative DFS producing parent edges and an order
    const order: string[] = [];
    const parentEdge = new Map<string, number>();
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      order.push(u);
      for (const e of adj.get(u)!) {
        if (usedEdge[e]) continue;
        const s = segs[e];
        const v = pkey(s.a) === u ? pkey(s.b) : pkey(s.a);
        if (visited.has(v)) continue;
        usedEdge[e] = 1;
        visited.add(v);
        parentEdge.set(v, e);
        stack.push(v);
      }
    }
    const sub = new Map<string, number>();
    for (const k of order) sub.set(k, inj.get(k) ?? 0);
    for (let i = order.length - 1; i > 0; i--) {
      const v = order[i];
      const e = parentEdge.get(v)!;
      const s = segs[e];
      const flow = sub.get(v)!; // flows from v toward its parent
      const parent = pkey(s.a) === v ? pkey(s.b) : pkey(s.a);
      cur[e] = pkey(s.a) === v ? flow : -flow;
      sub.set(parent, (sub.get(parent) ?? 0) + flow);
    }
  }
  return cur;
}
