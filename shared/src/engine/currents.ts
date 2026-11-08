// Wire-segment currents for the animated current-flow dots.

import { Circuit, pkey } from '../model/types';
import { terminalPositions } from '../model/library';
import { Netlist } from './netlist';

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
