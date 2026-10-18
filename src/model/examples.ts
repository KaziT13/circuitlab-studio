import { Circuit, Component, CompType, PropValue, Wire } from './types';
import { DEFS } from './library';

export interface Example {
  id: string;
  title: string;
  summary: string;
  theory: string;
  expected: string[];
  /** simulated seconds per real second */
  speed: number;
  /** default scope signals: component labels with a quantity */
  probes: { label: string; q: 'v' | 'i' | 'p' }[];
  build: () => Circuit;
}

let n = 0;
function comp(type: CompType, x: number, y: number, rot: number, label: string, props: Record<string, PropValue> = {}): Component {
  return { id: `ex${n++}_${label}`, type, x, y, rot, label, props: { ...DEFS[type].defaults, ...props } };
}
function wire(...c: number[]): Wire {
  const points = [];
  for (let i = 0; i < c.length; i += 2) points.push({ x: c[i], y: c[i + 1] });
  return { id: `exw${n++}`, points };
}

export const EXAMPLES: Example[] = [
  {
    id: 'series',
    title: 'Series resistors',
    summary: '9 V across 1 kΩ + 2.2 kΩ + 3.3 kΩ in series.',
    theory:
      'In a series circuit the same current flows through every element. Resistances add: R_total = R1 + R2 + R3 = 6.5 kΩ. ' +
      'Ohm’s law gives I = V/R_total, and each resistor drops V = I·R. By KVL the drops sum to the source voltage.',
    expected: ['R_total = 6.5 kΩ', 'I = 9 / 6500 = 1.385 mA', 'V_R1 = 1.385 V, V_R2 = 3.046 V, V_R3 = 4.569 V', 'P_total = V·I = 12.46 mW'],
    speed: 0.01,
    probes: [{ label: 'R2', q: 'v' }, { label: 'R1', q: 'i' }],
    build: () => ({
      name: 'Series resistors',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 9 }),
        comp('resistor', 200, 120, 0, 'R1', { resistance: 1000 }),
        comp('resistor', 320, 200, 90, 'R2', { resistance: 2200 }),
        comp('resistor', 200, 280, 0, 'R3', { resistance: 3300 }),
        comp('voltmeter', 400, 200, 90, 'VM1'),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 120, 160, 120),
        wire(240, 120, 320, 120, 320, 160),
        wire(320, 240, 320, 280, 240, 280),
        wire(160, 280, 100, 280, 100, 240),
        wire(320, 120, 400, 120, 400, 160),
        wire(400, 240, 400, 280, 320, 280),
      ],
    }),
  },
  {
    id: 'parallel',
    title: 'Parallel resistors',
    summary: '12 V driving 100 Ω ∥ 220 Ω ∥ 470 Ω, total current on an ammeter.',
    theory:
      'Parallel branches share the same voltage. Each branch current is I = V/R and by KCL the source current is their sum. ' +
      'Equivalently 1/R_eq = 1/R1 + 1/R2 + 1/R3, so R_eq is smaller than the smallest branch resistor.',
    expected: ['I_R1 = 120 mA, I_R2 = 54.5 mA, I_R3 = 25.5 mA', 'I_total = 200.1 mA (ammeter AM1)', 'R_eq = 59.98 Ω', 'P_total = 2.40 W'],
    speed: 0.01,
    probes: [{ label: 'AM1', q: 'i' }, { label: 'R1', q: 'i' }, { label: 'R3', q: 'i' }],
    build: () => ({
      name: 'Parallel resistors',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 12 }),
        comp('ammeter', 160, 120, 0, 'AM1'),
        comp('resistor', 220, 200, 90, 'R1', { resistance: 100, powerRating: 2 }),
        comp('resistor', 320, 200, 90, 'R2', { resistance: 220, powerRating: 1 }),
        comp('resistor', 420, 200, 90, 'R3', { resistance: 470, powerRating: 0.5 }),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 120, 120, 120),
        wire(200, 120, 420, 120, 420, 160),
        wire(220, 120, 220, 160),
        wire(320, 120, 320, 160),
        wire(100, 240, 100, 280, 420, 280, 420, 240),
        wire(220, 240, 220, 280),
        wire(320, 240, 320, 280),
      ],
    }),
  },
  {
    id: 'divider',
    title: 'Voltage divider',
    summary: '10 V divided by 6.8 kΩ / 3.3 kΩ, output measured with a voltmeter.',
    theory:
      'Two series resistors split the input voltage in proportion to their resistance: V_out = V_in · R2/(R1+R2). ' +
      'An ideal voltmeter draws no current so it does not disturb the divider.',
    expected: ['V_out = 10 · 3.3k / 10.1k = 3.267 V', 'I = 10 / 10.1 kΩ = 0.990 mA', 'V_R1 = 6.733 V'],
    speed: 0.01,
    probes: [{ label: 'VM1', q: 'v' }],
    build: () => ({
      name: 'Voltage divider',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 10 }),
        comp('resistor', 260, 160, 90, 'R1', { resistance: 6800 }),
        comp('resistor', 260, 280, 90, 'R2', { resistance: 3300 }),
        comp('voltmeter', 380, 280, 90, 'VM1'),
        comp('ground', 100, 380, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 120, 260, 120),
        wire(260, 200, 260, 240),
        wire(260, 320, 260, 360, 100, 360, 100, 240),
        wire(260, 220, 380, 220, 380, 240),
        wire(380, 320, 380, 360, 260, 360),
      ],
    }),
  },
  {
    id: 'led',
    title: 'LED with current-limiting resistor',
    summary: '9 V, 360 Ω and a red LED (V_f ≈ 1.9 V).',
    theory:
      'An LED has an exponential I–V curve, so it must not be connected directly across a voltage source. ' +
      'The series resistor sets the current: I ≈ (V_s − V_f)/R. The simulator solves the diode equation with Newton–Raphson iteration.',
    expected: ['I ≈ (9 − 1.9)/360 ≈ 19.7 mA', 'V_LED ≈ 1.90 V', 'P_R = I²R ≈ 140 mW, P_LED ≈ 37 mW'],
    speed: 0.01,
    probes: [{ label: 'D1', q: 'i' }, { label: 'D1', q: 'v' }],
    build: () => ({
      name: 'LED circuit',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 9 }),
        comp('resistor', 200, 120, 0, 'R1', { resistance: 360 }),
        comp('led', 320, 200, 90, 'D1', { color: 'red', forwardVoltage: 1.9 }),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [wire(100, 160, 100, 120, 160, 120), wire(240, 120, 320, 120, 320, 160), wire(320, 240, 320, 280, 100, 280, 100, 240)],
    }),
  },
];
