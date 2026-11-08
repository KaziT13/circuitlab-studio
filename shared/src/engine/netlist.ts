// Converts the geometric circuit (components + wires on a grid) into an
// electrical netlist: which terminals share a node, node numbering, and
// topology checks that produce human-readable warnings/errors.

import { Circuit, Component, Point, pkey } from '../model/types';
import { DEFS, terminalPositions } from '../model/library';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  message: string;
  compId?: string;
}

export interface WireSeg {
  wireId: string;
  a: Point;
  b: Point;
  /** net index, or -1 if the wire touches no component terminal */
  net: number;
}

export interface Netlist {
  /** number of nets including the reference node 0 */
  nodeCount: number;
  compNodes: Map<string, number[]>;
  netNames: string[];
  /** a point on each net where the voltage label is drawn */
  netAnchor: (Point | null)[];
  wireNet: Map<string, number>;
  /** elementary segments (wires split at every attachment point) */
  segments: WireSeg[];
  /** grid points with ≥3 connections — drawn as junction dots */
  junctions: Point[];
  /** terminal keys that are connected to something other than themselves */
  connectedTerminals: Set<string>;
  hasGround: boolean;
  issues: Issue[];
}

class UnionFind {
  parent = new Map<string, string>();
  find(k: string): string {
    let p = this.parent.get(k);
    if (p === undefined) {
      this.parent.set(k, k);
      return k;
    }
    if (p === k) return k;
    const root = this.find(p);
    this.parent.set(k, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function pointOnSegment(p: Point, a: Point, b: Point, includeEnds = true): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return includeEnds && p.x === a.x && p.y === a.y;
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  if (Math.abs(cross) > 0.5 * Math.sqrt(len2)) return false;
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy;
  if (includeEnds) return dot >= -1e-9 && dot <= len2 + 1e-9;
  return dot > 1e-9 && dot < len2 - 1e-9;
}

const SOURCE_TYPES = new Set(['dcsource', 'acsource', 'battery']);

export function buildNetlist(circuit: Circuit): Netlist {
  const uf = new UnionFind();
  const issues: Issue[] = [];
  const comps = circuit.components;

  // raw segments
  const rawSegs: { wireId: string; a: Point; b: Point }[] = [];
  for (const w of circuit.wires) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      rawSegs.push({ wireId: w.id, a, b });
    }
    if (w.points.length) uf.find(pkey(w.points[0]));
  }

  // attachment points: terminals + every wire vertex
  const termPos = new Map<string, Point[]>();
  const attach = new Map<string, Point>();
  const degree = new Map<string, number>(); // number of things meeting at a point
  const bump = (p: Point, n = 1) => degree.set(pkey(p), (degree.get(pkey(p)) ?? 0) + n);

  for (const c of comps) {
    const tp = terminalPositions(c);
    termPos.set(c.id, tp);
    for (const p of tp) {
      attach.set(pkey(p), p);
      uf.find(pkey(p));
      bump(p);
    }
  }
  for (const w of circuit.wires) {
    w.points.forEach((p, i) => {
      attach.set(pkey(p), p);
      const isEnd = i === 0 || i === w.points.length - 1;
      bump(p, isEnd ? 1 : 2);
    });
  }

  // connect along segments and split them at attachment points
  const segments: WireSeg[] = [];
  for (const s of rawSegs) {
    uf.union(pkey(s.a), pkey(s.b));
    const inner: Point[] = [];
    for (const p of attach.values()) {
      if (pointOnSegment(p, s.a, s.b, false)) {
        uf.union(pkey(p), pkey(s.a));
        inner.push(p);
        bump(p, 2); // a T-junction: the through-wire counts as two connections
      }
    }
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    inner.sort((p, q) => (p.x - s.a.x) * dx + (p.y - s.a.y) * dy - ((q.x - s.a.x) * dx + (q.y - s.a.y) * dy));
    const pts = [s.a, ...inner, s.b];
    for (let i = 0; i + 1 < pts.length; i++) segments.push({ wireId: s.wireId, a: pts[i], b: pts[i + 1], net: -1 });
  }

  // ground
  const groundRoots = new Set<string>();
  for (const c of comps) if (c.type === 'ground') groundRoots.add(uf.find(pkey(termPos.get(c.id)![0])));
  const groundList = [...groundRoots];
  for (let i = 1; i < groundList.length; i++) uf.union(groundList[i], groundList[0]);
  const hasGround = groundList.length > 0;

  // count terminals per root
  const termCount = new Map<string, number>();
  for (const c of comps) {
    if (c.type === 'ground') continue;
    for (const p of termPos.get(c.id)!) {
      const r = uf.find(pkey(p));
      termCount.set(r, (termCount.get(r) ?? 0) + 1);
    }
  }

  // reference node
  let refRoot: string | null = hasGround ? uf.find(groundList[0]) : null;
  if (!refRoot) {
    const src = comps.find((c) => SOURCE_TYPES.has(c.type));
    const firstNonGround = comps.find((c) => c.type !== 'ground');
    if (src) refRoot = uf.find(pkey(termPos.get(src.id)![1]));
    else if (firstNonGround) refRoot = uf.find(pkey(termPos.get(firstNonGround.id)![0]));
    if (refRoot && comps.length > 0) {
      issues.push({
        level: 'warning',
        message: src
          ? `No ground symbol — the negative terminal of ${src.label} is used as the 0 V reference.`
          : 'No ground symbol — an arbitrary node is used as the 0 V reference.',
      });
    }
  }

  // number nets: reference = 0, then in component order
  const rootIndex = new Map<string, number>();
  if (refRoot) rootIndex.set(refRoot, 0);
  const compNodes = new Map<string, number[]>();
  let next = 1;
  for (const c of comps) {
    const nodes = termPos.get(c.id)!.map((p) => {
      const r = uf.find(pkey(p));
      let idx = rootIndex.get(r);
      if (idx === undefined) {
        idx = next++;
        rootIndex.set(r, idx);
      }
      return idx;
    });
    compNodes.set(c.id, nodes);
  }
  const nodeCount = Math.max(next, 1);
  const netNames = Array.from({ length: nodeCount }, (_, i) => (i === 0 ? (hasGround ? 'GND' : 'REF') : `N${i}`));

  // anchors for voltage labels
  const netAnchor: (Point | null)[] = Array(nodeCount).fill(null);
  for (const s of segments) {
    const idx = rootIndex.get(uf.find(pkey(s.a)));
    s.net = idx ?? -1;
    if (idx !== undefined && !netAnchor[idx]) {
      netAnchor[idx] = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    }
  }
  for (const c of comps) {
    termPos.get(c.id)!.forEach((p, k) => {
      const idx = compNodes.get(c.id)![k];
      if (!netAnchor[idx]) netAnchor[idx] = p;
    });
  }

  const wireNet = new Map<string, number>();
  for (const w of circuit.wires) {
    if (!w.points.length) continue;
    wireNet.set(w.id, rootIndex.get(uf.find(pkey(w.points[0]))) ?? -1);
  }

  const junctions: Point[] = [];
  for (const [k, d] of degree) if (d >= 3) junctions.push(attach.get(k)!);

  const connectedTerminals = new Set<string>();
  for (const c of comps) {
    for (const p of termPos.get(c.id)!) {
      const k = pkey(p);
      if ((degree.get(k) ?? 0) >= 2) connectedTerminals.add(k);
    }
  }

  // ---------- validation ----------
  const nonGround = comps.filter((c) => c.type !== 'ground');
  if (nonGround.length === 0) {
    issues.push({ level: 'info', message: 'Workspace is empty — drag components from the library to begin.' });
  } else if (!nonGround.some((c) => SOURCE_TYPES.has(c.type))) {
    issues.push({ level: 'warning', message: 'No voltage source in the circuit — every voltage and current will be zero.' });
  }

  for (const c of nonGround) {
    const nodes = compNodes.get(c.id)!;
    const tp = termPos.get(c.id)!;
    tp.forEach((p, k) => {
      const r = uf.find(pkey(p));
      const isRef = rootIndex.get(r) === 0 && hasGround;
      if ((termCount.get(r) ?? 0) < 2 && !isRef) {
        issues.push({
          level: 'warning',
          compId: c.id,
          message: `${c.label}: terminal ${DEFS[c.type].terminalNames[k]} is not connected to anything.`,
        });
      }
    });
    if (nodes.length === 2 && nodes[0] === nodes[1]) {
      const ideal = SOURCE_TYPES.has(c.type) && !((c.props.internalResistance as number) > 0);
      issues.push({
        level: ideal ? 'error' : 'warning',
        compId: c.id,
        message: ideal
          ? `${c.label} is short-circuited: both terminals are on the same node.`
          : `${c.label} is shorted out (both terminals on node ${netNames[nodes[0]]}) — it carries no current.`,
      });
    }
  }

  // loops of ideal voltage-defined branches (ideal sources and ammeters)
  const vuf = new UnionFind();
  for (const c of nonGround) {
    const isV =
      (SOURCE_TYPES.has(c.type) && !((c.props.internalResistance as number) > 0)) || c.type === 'ammeter';
    if (!isV) continue;
    const [a, b] = compNodes.get(c.id)!;
    if (a === b) continue;
    if (vuf.find(String(a)) === vuf.find(String(b))) {
      issues.push({
        level: 'error',
        compId: c.id,
        message: `${c.label} forms a loop with other ideal voltage sources/ammeters (KVL conflict). Add series resistance or remove the loop.`,
      });
    } else vuf.union(String(a), String(b));
  }

  // floating sub-circuits (not conductively connected to the reference)
  if (nonGround.length) {
    const cuf = new UnionFind();
    for (const c of nonGround) {
      if (c.type === 'voltmeter') continue;
      const ns = compNodes.get(c.id)!;
      for (let i = 1; i < ns.length; i++) cuf.union(String(ns[0]), String(ns[i]));
    }
    const floating = nonGround.filter(
      (c) => c.type !== 'voltmeter' && cuf.find(String(compNodes.get(c.id)![0])) !== cuf.find('0'),
    );
    if (floating.length) {
      issues.push({
        level: 'warning',
        message: `Floating section not connected to ground: ${floating
          .slice(0, 5)
          .map((c) => c.label)
          .join(', ')}${floating.length > 5 ? '…' : ''}. Its voltages are undefined (shown relative to 0 V).`,
      });
    }
  }

  return {
    nodeCount,
    compNodes,
    netNames,
    netAnchor,
    wireNet,
    segments,
    junctions,
    connectedTerminals,
    hasGround,
    issues,
  };
}

export function compByIdMap(c: Circuit): Map<string, Component> {
  return new Map(c.components.map((x) => [x.id, x]));
}
