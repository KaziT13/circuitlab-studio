// Obstacle-aware orthogonal routing for interactive wire drawing.
// A wire that passes over a terminal or runs along another wire connects to it,
// so candidate routes are scored to avoid touching anything but their endpoints.

import { Circuit, GRID, Point, rotatePoint, snap } from './types';
import { terminalPositions } from './library';
import { hitBoxOf } from './hitbox';

interface Obstacles {
  points: Point[];
  segs: [Point, Point][];
  boxes: [number, number, number, number][];
}

export function collectObstacles(c: Circuit): Obstacles {
  const points: Point[] = [];
  const segs: [Point, Point][] = [];
  const boxes: [number, number, number, number][] = [];
  for (const comp of c.components) {
    points.push(...terminalPositions(comp));
    const [hx, hy, hw, hh] = hitBoxOf(comp.type);
    const p1 = rotatePoint({ x: hx, y: hy }, comp.rot);
    const p2 = rotatePoint({ x: hx + hw, y: hy + hh }, comp.rot);
    boxes.push([comp.x + Math.min(p1.x, p2.x), comp.y + Math.min(p1.y, p2.y), Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y)]);
  }
  for (const w of c.wires) {
    points.push(...w.points);
    for (let i = 0; i + 1 < w.points.length; i++) segs.push([w.points[i], w.points[i + 1]]);
  }
  return { points, segs, boxes };
}

const onSeg = (p: Point, a: Point, b: Point) =>
  p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y) && (a.x === b.x ? p.x === a.x : p.y === a.y);

function overlapLen(a: Point, b: Point, c: Point, d: Point): number {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
  }
  return 0;
}

function segHitsBox(a: Point, b: Point, [x, y, w, h]: [number, number, number, number]): boolean {
  // strict interior intersection of an axis-aligned segment with a rectangle
  const x0 = x + 1;
  const x1 = x + w - 1;
  const y0 = y + 1;
  const y1 = y + h - 1;
  if (a.y === b.y) return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  if (a.x === b.x) return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  return false;
}

function cost(path: Point[], obs: Obstacles, start: Point, end: Point): number {
  let c = 0;
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    c += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const p of obs.points) {
      if (same(p, start) || same(p, end)) continue;
      if (onSeg(p, a, b)) c += 10000; // would create an unintended connection
    }
    for (const [s, t] of obs.segs) if (overlapLen(a, b, s, t) > 0) c += 10000;
    for (const box of obs.boxes) if (segHitsBox(a, b, box)) c += 400;
  }
  c += (path.length - 2) * 15;
  return c;
}

/** Points to append after `a` to reach `b` (excludes `a`). */
export function smartRoute(a: Point, b: Point, obs: Obstacles): Point[] {
  if (a.x === b.x && a.y === b.y) return [b];
  const candidates: Point[][] = [];
  const push = (...pts: Point[]) => {
    const full = [a, ...pts];
    // drop zero-length legs
    const clean: Point[] = [full[0]];
    for (const p of full.slice(1)) if (p.x !== clean[clean.length - 1].x || p.y !== clean[clean.length - 1].y) clean.push(p);
    candidates.push(clean);
  };
  push({ x: b.x, y: a.y }, b);
  push({ x: a.x, y: b.y }, b);
  const midX = snap((a.x + b.x) / 2);
  const midY = snap((a.y + b.y) / 2);
  for (let k = -12; k <= 12; k++) {
    const mx = midX + k * GRID;
    const my = midY + k * GRID;
    push({ x: mx, y: a.y }, { x: mx, y: b.y }, b);
    push({ x: a.x, y: my }, { x: b.x, y: my }, b);
  }
  let best = candidates[0];
  let bestCost = Infinity;
  for (const p of candidates) {
    const cc = cost(p, obs, a, b);
    if (cc < bestCost) {
      bestCost = cc;
      best = p;
    }
  }
  return best.slice(1);
}
