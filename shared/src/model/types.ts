// Pure circuit data model — no rendering or simulation concerns live here.

export type CompType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'dcsource'
  | 'acsource'
  | 'battery'
  | 'ground'
  | 'diode'
  | 'led'
  | 'switch'
  | 'spdt'
  | 'pushbutton'
  | 'bulb'
  | 'ammeter'
  | 'voltmeter'
  | 'npn';

export type PropValue = number | string | boolean;

export interface Point {
  x: number;
  y: number;
}

export interface Component {
  id: string;
  type: CompType;
  x: number;
  y: number;
  /** rotation in degrees, clockwise, multiple of 90 */
  rot: number;
  label: string;
  props: Record<string, PropValue>;
}

export interface Wire {
  id: string;
  points: Point[];
}

export interface Circuit {
  name: string;
  components: Component[];
  wires: Wire[];
}

export const GRID = 20;

export const emptyCircuit = (): Circuit => ({ name: 'Untitled circuit', components: [], wires: [] });

let idCounter = 0;
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

export const pkey = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

export function rotatePoint(p: Point, rot: number): Point {
  const r = ((rot % 360) + 360) % 360;
  switch (r) {
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}
