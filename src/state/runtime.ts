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
