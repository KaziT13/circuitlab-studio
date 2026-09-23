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
