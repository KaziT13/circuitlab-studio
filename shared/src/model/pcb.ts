// Basic PCB layout: through-hole footprints, auto-placement and a two-layer
// Lee/Dijkstra grid router. Grid cell = 50 mil (1.27 mm).

import { Circuit, CompType, Point, rotatePoint } from './types';
import { buildNetlist } from '../engine/netlist';

export const CELL_MM = 1.27;

export interface Footprint {
  name: string;
  /** pad offsets (cells), indexed like the component's terminals */
  pads: Point[];
  /** courtyard rectangle (cells, relative) [x, y, w, h] */
  box: [number, number, number, number];
  shape: 'axial' | 'radial' | 'header' | 'to92' | 'switch' | 'box';
  refPrefix: string;
}

export const FOOTPRINTS: Partial<Record<CompType, Footprint>> = {
  resistor: { name: 'R_Axial_P10.16mm', pads: [{ x: -4, y: 0 }, { x: 4, y: 0 }], box: [-3, -1, 6, 2], shape: 'axial', refPrefix: 'R' },
  bulb: { name: 'Lamp_P10.16mm', pads: [{ x: -4, y: 0 }, { x: 4, y: 0 }], box: [-3, -2, 6, 4], shape: 'radial', refPrefix: 'LMP' },
  diode: { name: 'D_DO-41_P10.16mm', pads: [{ x: -4, y: 0 }, { x: 4, y: 0 }], box: [-3, -1, 6, 2], shape: 'axial', refPrefix: 'D' },
  inductor: { name: 'L_Axial_P7.62mm', pads: [{ x: -3, y: 0 }, { x: 3, y: 0 }], box: [-2, -1, 4, 2], shape: 'axial', refPrefix: 'L' },
  capacitor: { name: 'CP_Radial_D5mm', pads: [{ x: -1, y: 0 }, { x: 1, y: 0 }], box: [-2, -2, 4, 4], shape: 'radial', refPrefix: 'C' },
  led: { name: 'LED_D5.0mm', pads: [{ x: -1, y: 0 }, { x: 1, y: 0 }], box: [-2, -2, 4, 4], shape: 'radial', refPrefix: 'D' },
  dcsource: { name: 'PinHeader_1x02', pads: [{ x: 0, y: -1 }, { x: 0, y: 1 }], box: [-1, -2, 2, 4], shape: 'header', refPrefix: 'J' },
  acsource: { name: 'PinHeader_1x02', pads: [{ x: 0, y: -1 }, { x: 0, y: 1 }], box: [-1, -2, 2, 4], shape: 'header', refPrefix: 'J' },
  battery: { name: 'BatteryHolder_2pin', pads: [{ x: 0, y: -2 }, { x: 0, y: 2 }], box: [-2, -3, 4, 6], shape: 'box', refPrefix: 'BT' },
  ammeter: { name: 'TestPoint_2pin', pads: [{ x: -1, y: 0 }, { x: 1, y: 0 }], box: [-2, -1, 4, 2], shape: 'header', refPrefix: 'TP' },
  voltmeter: { name: 'TestPoint_2pin', pads: [{ x: -1, y: 0 }, { x: 1, y: 0 }], box: [-2, -1, 4, 2], shape: 'header', refPrefix: 'TP' },
  switch: { name: 'SW_Slide_P5.08mm', pads: [{ x: -2, y: 0 }, { x: 2, y: 0 }], box: [-3, -2, 6, 4], shape: 'switch', refPrefix: 'SW' },
  pushbutton: { name: 'SW_Tactile_6mm', pads: [{ x: -2, y: 0 }, { x: 2, y: 0 }], box: [-3, -2, 6, 4], shape: 'switch', refPrefix: 'SW' },
  spdt: { name: 'SW_SPDT_P2.54mm', pads: [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }], box: [-3, -2, 6, 4], shape: 'switch', refPrefix: 'SW' },
  npn: { name: 'TO-92_Inline', pads: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -2, y: 0 }], box: [-3, -2, 6, 4], shape: 'to92', refPrefix: 'Q' },
};

export interface Placement {
  x: number;
  y: number;
  rot: number;
}

export interface PadInfo {
  compId: string;
  k: number;
  x: number;
  y: number;
  net: number;
}

export interface Trace {
  net: number;
  layer: 0 | 1;
  points: Point[];
}

export interface RouteResult {
  traces: Trace[];
  vias: Point[];
  unrouted: [Point, Point, number][];
}

export function padPositions(circuit: Circuit, place: Map<string, Placement>): PadInfo[] {
  const nl = buildNetlist(circuit);
  const pads: PadInfo[] = [];
  for (const c of circuit.components) {
    const fp = FOOTPRINTS[c.type];
    const p = place.get(c.id);
    if (!fp || !p) continue;
    fp.pads.forEach((o, k) => {
      const r = rotatePoint(o, p.rot);
      pads.push({ compId: c.id, k, x: p.x + r.x, y: p.y + r.y, net: nl.compNodes.get(c.id)![k] });
    });
  }
  return pads;
}

/** Place footprints following the schematic arrangement (scaled), resolving overlaps. */
export function autoPlace(circuit: Circuit): Map<string, Placement> {
  const comps = circuit.components.filter((c) => FOOTPRINTS[c.type]);
  const place = new Map<string, Placement>();
  if (!comps.length) return place;
  const minX = Math.min(...comps.map((c) => c.x));
  const minY = Math.min(...comps.map((c) => c.y));
  const occupied: [number, number, number, number][] = [];
  const overlaps = (b: [number, number, number, number]) =>
    occupied.some((o) => b[0] < o[0] + o[2] + 1 && o[0] < b[0] + b[2] + 1 && b[1] < o[1] + o[3] + 1 && o[1] < b[1] + b[3] + 1);
  for (const c of comps) {
    const fp = FOOTPRINTS[c.type]!;
    let x = Math.round(((c.x - minX) / 20) * 1.6) + 6;
    let y = Math.round(((c.y - minY) / 20) * 1.6) + 6;
    const rot = c.rot % 180 === 0 ? 0 : 90;
    const boxAt = (px: number, py: number): [number, number, number, number] => {
      const corners = [
        rotatePoint({ x: fp.box[0], y: fp.box[1] }, rot),
        rotatePoint({ x: fp.box[0] + fp.box[2], y: fp.box[1] + fp.box[3] }, rot),
      ];
      const x0 = Math.min(corners[0].x, corners[1].x);
      const y0 = Math.min(corners[0].y, corners[1].y);
      return [px + x0, py + y0, Math.abs(corners[0].x - corners[1].x), Math.abs(corners[0].y - corners[1].y)];
    };
    // search outward in square rings for the nearest free spot
    const x0 = x;
    const y0 = y;
    search: for (let r = 0; r < 60; r++) {
      for (let ddx = -r; ddx <= r; ddx++) {
        for (let ddy = -r; ddy <= r; ddy++) {
          if (Math.max(Math.abs(ddx), Math.abs(ddy)) !== r) continue;
          if (!overlaps(boxAt(x0 + ddx, y0 + ddy))) {
            x = x0 + ddx;
            y = y0 + ddy;
            break search;
          }
        }
      }
    }
    occupied.push(boxAt(x, y));
    place.set(c.id, { x, y, rot });
  }
  // normalise to a margin of 4 cells
  const pads = padPositions(circuit, place);
  const bx = Math.min(...[...place.values()].map((p) => p.x), ...pads.map((p) => p.x)) - 5;
  const by = Math.min(...[...place.values()].map((p) => p.y), ...pads.map((p) => p.y)) - 5;
  for (const [id, p] of place) place.set(id, { ...p, x: p.x - bx, y: p.y - by });
  return place;
}

export function boardSize(circuit: Circuit, place: Map<string, Placement>): { w: number; h: number } {
  let w = 20;
  let h = 14;
  for (const c of circuit.components) {
    const fp = FOOTPRINTS[c.type];
    const p = place.get(c.id);
    if (!fp || !p) continue;
    const ext = Math.max(Math.abs(fp.box[0]), Math.abs(fp.box[0] + fp.box[2]), Math.abs(fp.box[1]), Math.abs(fp.box[1] + fp.box[3]));
    w = Math.max(w, p.x + ext + 5);
    h = Math.max(h, p.y + ext + 5);
  }
  return { w, h };
}

/** Two-layer grid router (through-hole pads exist on both layers). */
export function routeBoard(circuit: Circuit, place: Map<string, Placement>): RouteResult {
  const { w, h } = boardSize(circuit, place);
  const W = w + 1;
  const H = h + 1;
  const N = W * H;
  const owner = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)]; // net occupying cell per layer
  const pads = padPositions(circuit, place);
  const idx = (x: number, y: number) => y * W + x;
  for (const p of pads) {
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    owner[0][idx(p.x, p.y)] = p.net;
    owner[1][idx(p.x, p.y)] = p.net;
  }
  // clearance: block cells adjacent to pads of other nets diagonally? keep only the pad cells themselves
  const nets = new Map<number, PadInfo[]>();
  for (const p of pads) {
    if (!nets.has(p.net)) nets.set(p.net, []);
    nets.get(p.net)!.push(p);
  }
  const traces: Trace[] = [];
  const vias: Point[] = [];
  const unrouted: [Point, Point, number][] = [];
  // route nets with fewer pads / shorter spans first
  const order = [...nets.entries()].filter(([, ps]) => ps.length > 1).sort((a, b) => span(a[1]) - span(b[1]));

  for (const [net, ps] of order) {
    const inTree = new Uint8Array(N * 2);
    const first = ps[0];
    inTree[idx(first.x, first.y)] = 1;
    inTree[N + idx(first.x, first.y)] = 1;
    const remaining = ps.slice(1).filter((p) => !(p.x === first.x && p.y === first.y));
    // nearest-first
    remaining.sort((a, b) => Math.abs(a.x - first.x) + Math.abs(a.y - first.y) - (Math.abs(b.x - first.x) + Math.abs(b.y - first.y)));
    for (const target of remaining) {
      const path = dijkstra(target, net, inTree, owner, W, H);
      if (!path) {
        // record a ratsnest line to the closest tree pad
        unrouted.push([{ x: target.x, y: target.y }, { x: first.x, y: first.y }, net]);
        continue;
      }
      // commit path: split into per-layer polylines and vias
      let seg: Point[] = [];
      let layer = path[0].l;
      for (let i = 0; i < path.length; i++) {
        const c = path[i];
        owner[c.l][idx(c.x, c.y)] = net;
        inTree[c.l * N + idx(c.x, c.y)] = 1;
        if (c.l !== layer) {
          if (seg.length > 1) traces.push({ net, layer: layer as 0 | 1, points: simplifyPath(seg) });
          const isPad = pads.some((p) => p.x === c.x && p.y === c.y);
          if (!isPad) vias.push({ x: c.x, y: c.y });
          owner[0][idx(c.x, c.y)] = net;
          owner[1][idx(c.x, c.y)] = net;
          inTree[idx(c.x, c.y)] = 1;
          inTree[N + idx(c.x, c.y)] = 1;
          seg = [];
          layer = c.l;
        }
        seg.push({ x: c.x, y: c.y });
      }
      if (seg.length > 1) traces.push({ net, layer: layer as 0 | 1, points: simplifyPath(seg) });
      // pads are on both layers
      inTree[idx(target.x, target.y)] = 1;
      inTree[N + idx(target.x, target.y)] = 1;
    }
  }
  return { traces, vias, unrouted };
}

function span(ps: PadInfo[]) {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
}

function simplifyPath(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((b.x - a.x) * (p.y - b.y) === (b.y - a.y) * (p.x - b.x)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

interface Cell {
  x: number;
  y: number;
  l: number;
}

/** Dijkstra from a pad (both layers) to any cell of the net's routed tree. Bucket queue. */
function dijkstra(src: PadInfo, net: number, inTree: Uint8Array, owner: Int32Array[], W: number, H: number): Cell[] | null {
  const N = W * H;
  const dist = new Int32Array(2 * N).fill(1 << 30);
  const prev = new Int32Array(2 * N).fill(-1);
  const VIA = 8;
  const BEND = 1;
  const STEP = 2;
  const buckets: number[][] = [];
  const push = (s: number, d: number) => {
    (buckets[d] ??= []).push(s);
  };
  const s0 = src.y * W + src.x;
  for (const l of [0, 1]) {
    dist[l * N + s0] = 0;
    push(l * N + s0, 0);
  }
  const dirOf = new Int8Array(2 * N).fill(-1);
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let bi = 0; bi < b.length; bi++) {
      const s = b[bi];
      if (dist[s] !== d) continue;
      const l = s >= N ? 1 : 0;
      const c = s - l * N;
      if (inTree[s] && c !== s0) {
        // reconstruct
        const path: Cell[] = [];
        let k = s;
        while (k !== -1) {
          const kl = k >= N ? 1 : 0;
          const kc = k - kl * N;
          path.push({ x: kc % W, y: Math.floor(kc / W), l: kl });
          k = prev[k];
        }
        return path.reverse();
      }
      const x = c % W;
      const y = Math.floor(c / W);
      for (let dd = 0; dd < 4; dd++) {
        const nx = x + dx[dd];
        const ny = y + dy[dd];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        const o = owner[l][nc];
        if (o !== -1 && o !== net) continue;
        const ns = l * N + nc;
        const nd = d + STEP + (dirOf[s] !== -1 && dirOf[s] !== dd ? BEND : 0);
        if (nd < dist[ns]) {
          dist[ns] = nd;
          prev[ns] = s;
          dirOf[ns] = dd;
          push(ns, nd);
        }
      }
      // via to the other layer
      const ol = 1 - l;
      const os = ol * N + c;
      const oo = owner[ol][c];
      if ((oo === -1 || oo === net) && d + VIA < dist[os]) {
        dist[os] = d + VIA;
        prev[os] = s;
        dirOf[os] = -1;
        push(os, d + VIA);
      }
    }
    buckets[d] = [];
  }
  return null;
}
