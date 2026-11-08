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
  {
    id: 'rc',
    title: 'RC charging & discharging',
    summary: '5 V, 1 kΩ, 100 µF — flip S1 to discharge (τ = 100 ms).',
    theory:
      'With S1 at A the capacitor charges through R: v_C(t) = V(1 − e^(−t/RC)). Flip S1 to B and it discharges: v_C(t) = V₀·e^(−t/RC). ' +
      'The time constant τ = RC = 100 ms; after 5τ the capacitor is ~99% charged. Click S1 while running to flip it.',
    expected: ['τ = R·C = 1 kΩ × 100 µF = 100 ms', 'v_C(τ) = 3.16 V (63.2%)', 'Initial current = 5 mA', 'Stored energy at 5 V: ½CV² = 1.25 mJ'],
    speed: 0.2,
    probes: [{ label: 'C1', q: 'v' }, { label: 'R1', q: 'i' }],
    build: () => ({
      name: 'RC charge/discharge',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 5 }),
        comp('spdt', 240, 160, 0, 'S1', { position: 'A' }),
        comp('resistor', 340, 160, 0, 'R1', { resistance: 1000 }),
        comp('capacitor', 440, 220, 90, 'C1', { capacitance: 100e-6, voltageRating: 16 }),
        comp('voltmeter', 520, 220, 90, 'VM1'),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 140, 200, 140),
        wire(200, 180, 160, 180, 160, 280),
        wire(100, 240, 100, 280, 440, 280),
        wire(280, 160, 300, 160),
        wire(380, 160, 440, 160, 440, 180),
        wire(440, 260, 440, 280),
        wire(440, 160, 520, 160, 520, 180),
        wire(520, 260, 520, 280, 440, 280),
      ],
    }),
  },
  {
    id: 'rl',
    title: 'RL circuit',
    summary: '10 V, 100 Ω, 100 mH — current rises with τ = L/R = 1 ms.',
    theory:
      'An inductor opposes changes in current (v = L·di/dt). With S1 at A the current rises as i(t) = (V/R)(1 − e^(−tR/L)). ' +
      'Flip S1 to B and the stored magnetic energy keeps the current flowing while it decays through R. τ = L/R.',
    expected: ['τ = L/R = 0.1 / 100 = 1 ms', 'I_final = V/R = 100 mA', 'v_L(0⁺) = 10 V, decaying to 0', 'Stored energy: ½LI² = 0.5 mJ'],
    speed: 0.002,
    probes: [{ label: 'AM1', q: 'i' }, { label: 'VM1', q: 'v' }],
    build: () => ({
      name: 'RL circuit',
      components: [
        comp('dcsource', 100, 200, 0, 'V1', { voltage: 10 }),
        comp('spdt', 240, 160, 0, 'S1', { position: 'A' }),
        comp('resistor', 340, 160, 0, 'R1', { resistance: 100, powerRating: 2 }),
        comp('ammeter', 440, 160, 0, 'AM1'),
        comp('inductor', 520, 220, 90, 'L1', { inductance: 0.1 }),
        comp('voltmeter', 600, 220, 90, 'VM1'),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 140, 200, 140),
        wire(200, 180, 160, 180, 160, 280),
        wire(100, 240, 100, 280, 520, 280),
        wire(280, 160, 300, 160),
        wire(380, 160, 400, 160),
        wire(480, 160, 520, 160, 520, 180),
        wire(520, 260, 520, 280),
        wire(520, 160, 600, 160, 600, 180),
        wire(600, 260, 600, 280, 520, 280),
      ],
    }),
  },
  {
    id: 'rlc',
    title: 'Series RLC resonance',
    summary: '5 V 500 Hz AC into 20 Ω, 10 mH, 10 µF (f₀ ≈ 503 Hz).',
    theory:
      'At resonance the inductive and capacitive reactances cancel (X_L = X_C), leaving only R. Current peaks at V/R and the ' +
      'capacitor voltage is amplified by the quality factor Q = (1/R)·√(L/C) ≈ 1.58. Use the AC Analysis tab to sweep frequency and see the resonance peak.',
    expected: [
      'f₀ = 1/(2π√(LC)) = 503.3 Hz',
      'At 500 Hz: X_L = 31.42 Ω, X_C = 31.83 Ω, |Z| = 20.00 Ω',
      'I_peak = 250 mA, V_C,peak = 7.96 V (> source!)',
      'ζ = (R/2)√(C/L) = 0.316 (underdamped)',
    ],
    speed: 0.005,
    probes: [{ label: 'V1', q: 'v' }, { label: 'VM1', q: 'v' }, { label: 'R1', q: 'i' }],
    build: () => ({
      name: 'Series RLC',
      components: [
        comp('acsource', 100, 200, 0, 'V1', { amplitude: 5, frequency: 500 }),
        comp('resistor', 200, 120, 0, 'R1', { resistance: 20, powerRating: 2 }),
        comp('inductor', 320, 120, 0, 'L1', { inductance: 0.01 }),
        comp('capacitor', 420, 200, 90, 'C1', { capacitance: 10e-6 }),
        comp('voltmeter', 500, 200, 90, 'VM1'),
        comp('ground', 100, 300, 0, 'GND'),
      ],
      wires: [
        wire(100, 160, 100, 120, 160, 120),
        wire(240, 120, 280, 120),
        wire(360, 120, 420, 120, 420, 160),
        wire(420, 240, 420, 280, 100, 280, 100, 240),
        wire(420, 120, 500, 120, 500, 160),
        wire(500, 240, 500, 280, 420, 280),
      ],
    }),
  },
  {
    id: 'bridge',
    title: 'Bridge rectifier',
    summary: '12 V 60 Hz AC → full-wave rectified DC across 1 kΩ with a 22 µF filter capacitor.',
    theory:
      'Four diodes steer both half-cycles of the AC input through the load in the same direction. Two diodes conduct at a time, so ' +
      'the output peak is V_p − 2·V_D. The capacitor holds the voltage up between peaks; ripple ≈ I_load/(2·f·C).',
    expected: ['V_out,peak ≈ 12 − 2×0.7 ≈ 10.6 V', 'Ripple frequency = 120 Hz', 'Ripple ≈ 10.6 mA/(2·60·22 µF) ≈ 4 V p-p (approx.)'],
    speed: 0.02,
    probes: [{ label: 'V1', q: 'v' }, { label: 'VM1', q: 'v' }],
    build: () => ({
      name: 'Bridge rectifier',
      components: [
        comp('acsource', 100, 240, 0, 'V1', { amplitude: 12, frequency: 60 }),
        comp('diode', 260, 100, 0, 'D1'),
        comp('diode', 260, 180, 180, 'D3'),
        comp('diode', 260, 260, 180, 'D4'),
        comp('diode', 260, 340, 0, 'D2'),
        comp('resistor', 420, 220, 0, 'RL', { resistance: 1000 }),
        comp('capacitor', 420, 300, 0, 'C1', { capacitance: 22e-6, voltageRating: 25 }),
        comp('voltmeter', 540, 260, 90, 'VM1'),
        comp('ground', 340, 320, 0, 'GND'),
      ],
      wires: [
        wire(220, 100, 220, 180),
        wire(100, 200, 100, 140, 220, 140),
        wire(220, 260, 220, 340),
        wire(100, 280, 220, 280),
        wire(300, 180, 300, 260),
        wire(300, 220, 380, 220),
        wire(300, 100, 460, 100, 460, 340),
        wire(300, 340, 460, 340),
        wire(380, 220, 380, 300),
        wire(340, 300, 380, 300),
        wire(460, 160, 540, 160, 540, 220),
        wire(540, 300, 540, 380, 380, 380, 380, 300),
      ],
    }),
  },
  {
    id: 'transistor',
    title: 'Transistor switch',
    summary: 'NPN transistor switching an LED; S1 drives the base through 10 kΩ.',
    theory:
      'A small base current (≈0.8 mA) lets a much larger collector current flow. Here β·I_B (≈80 mA) exceeds what the collector ' +
      'circuit can supply, so the transistor saturates (V_CE ≈ 0.1 V) and acts as a closed switch. Open S1 to cut it off.',
    expected: ['I_B ≈ (9 − 0.7)/10 kΩ ≈ 0.83 mA', 'I_C ≈ (9 − 1.9 − V_CE,sat)/330 Ω ≈ 21 mA', 'Region: saturation (I_C < β·I_B)'],
    speed: 0.01,
    probes: [{ label: 'Q1', q: 'i' }, { label: 'Q1', q: 'v' }],
    build: () => ({
      name: 'Transistor switch',
      components: [
        comp('dcsource', 100, 240, 0, 'V1', { voltage: 9 }),
        comp('led', 500, 200, 90, 'D1', { color: 'green', forwardVoltage: 2.1 }),
        comp('resistor', 500, 320, 90, 'RC', { resistance: 330 }),
        comp('npn', 480, 440, 0, 'Q1'),
        comp('switch', 240, 200, 90, 'S1', { closed: true }),
        comp('resistor', 340, 440, 0, 'RB', { resistance: 10000 }),
        comp('ground', 100, 540, 0, 'GND'),
      ],
      wires: [
        wire(100, 200, 100, 120, 500, 120, 500, 160),
        wire(500, 240, 500, 280),
        wire(500, 360, 500, 400),
        wire(100, 280, 100, 520, 500, 520, 500, 480),
        wire(240, 120, 240, 160),
        wire(240, 240, 240, 440, 300, 440),
        wire(380, 440, 440, 440),
      ],
    }),
  },
];
