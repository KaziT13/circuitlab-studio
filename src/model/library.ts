import { CompType, Component, Point, PropValue, rotatePoint } from './types';
import { shortEng } from './units';

export interface ParamDef {
  key: string;
  label: string;
  unit?: string;
  kind: 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  min?: number;
  /** strictly positive */
  positive?: boolean;
  help?: string;
}

export interface EduInfo {
  what: string;
  equation: string;
  unit: string;
  effect: string;
}

export interface CompDef {
  type: CompType;
  name: string;
  category: 'Passive' | 'Sources' | 'Semiconductors' | 'Switches' | 'Output' | 'Instruments';
  prefix: string;
  terminals: Point[];
  terminalNames: string[];
  defaults: Record<string, PropValue>;
  params: ParamDef[];
  edu: EduInfo;
  /** short value text drawn on the canvas */
  valueText: (c: Component) => string;
}

const T2: Point[] = [
  { x: -40, y: 0 },
  { x: 40, y: 0 },
];
const TV: Point[] = [
  { x: 0, y: -40 },
  { x: 0, y: 40 },
];

const num = (v: PropValue | undefined, d = 0) => (typeof v === 'number' ? v : d);

export const LED_COLORS: Record<string, { label: string; color: string; vf: number }> = {
  red: { label: 'Red', color: '#ff4d4d', vf: 1.9 },
  yellow: { label: 'Yellow', color: '#ffd23f', vf: 2.0 },
  green: { label: 'Green', color: '#39e27d', vf: 2.1 },
  blue: { label: 'Blue', color: '#4da3ff', vf: 3.0 },
  white: { label: 'White', color: '#f2f6ff', vf: 3.1 },
};

export const DEFS: Record<CompType, CompDef> = {
  resistor: {
    type: 'resistor',
    name: 'Resistor',
    category: 'Passive',
    prefix: 'R',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { resistance: 1000, tolerance: 5, powerRating: 0.25 },
    params: [
      { key: 'resistance', label: 'Resistance', unit: 'Ω', kind: 'number', positive: true },
      { key: 'tolerance', label: 'Tolerance', unit: '%', kind: 'number', min: 0 },
      { key: 'powerRating', label: 'Power rating', unit: 'W', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A resistor opposes the flow of current, converting electrical energy into heat. It sets current levels, divides voltages and biases active devices.',
      equation: 'V = I·R      P = I²R = V²/R',
      unit: 'Ohm (Ω) — 1 Ω passes 1 A when 1 V is applied.',
      effect: 'Higher resistance means less current for the same voltage. In series, resistances add (R = R₁+R₂); in parallel, conductances add (1/R = 1/R₁+1/R₂).',
    },
    valueText: (c) => shortEng(num(c.props.resistance), 'Ω'),
  },
  capacitor: {
    type: 'capacitor',
    name: 'Capacitor',
    category: 'Passive',
    prefix: 'C',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { capacitance: 10e-6, initialVoltage: 0, voltageRating: 50 },
    params: [
      { key: 'capacitance', label: 'Capacitance', unit: 'F', kind: 'number', positive: true },
      { key: 'initialVoltage', label: 'Initial voltage', unit: 'V', kind: 'number' },
      { key: 'voltageRating', label: 'Voltage rating', unit: 'V', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A capacitor stores energy in an electric field between two plates. It blocks steady DC once charged and passes changing (AC) signals.',
      equation: 'i = C·dv/dt      Q = C·V      E = ½CV²      Z = 1/(jωC)',
      unit: 'Farad (F) — 1 F stores 1 coulomb per volt.',
      effect: 'Voltage across a capacitor cannot change instantly. With a resistor it charges exponentially with time constant τ = RC (63% after 1τ, ~99% after 5τ).',
    },
    valueText: (c) => shortEng(num(c.props.capacitance), 'F'),
  },
  inductor: {
    type: 'inductor',
    name: 'Inductor',
    category: 'Passive',
    prefix: 'L',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { inductance: 10e-3, initialCurrent: 0, currentRating: 1 },
    params: [
      { key: 'inductance', label: 'Inductance', unit: 'H', kind: 'number', positive: true },
      { key: 'initialCurrent', label: 'Initial current', unit: 'A', kind: 'number' },
      { key: 'currentRating', label: 'Current rating', unit: 'A', kind: 'number', positive: true },
    ],
    edu: {
      what: 'An inductor stores energy in a magnetic field created by current in a coil. It resists changes in current.',
      equation: 'v = L·di/dt      E = ½LI²      Z = jωL',
      unit: 'Henry (H) — 1 H develops 1 V when current changes at 1 A/s.',
      effect: 'Current through an inductor cannot change instantly. With a resistor, current rises exponentially with τ = L/R. At DC steady state it behaves like a wire.',
    },
    valueText: (c) => shortEng(num(c.props.inductance), 'H'),
  },
  dcsource: {
    type: 'dcsource',
    name: 'DC Voltage Source',
    category: 'Sources',
    prefix: 'V',
    terminals: TV,
    terminalNames: ['+', '−'],
    defaults: { voltage: 5, internalResistance: 0 },
    params: [
      { key: 'voltage', label: 'Voltage', unit: 'V', kind: 'number' },
      { key: 'internalResistance', label: 'Internal resistance', unit: 'Ω', kind: 'number', min: 0 },
    ],
    edu: {
      what: 'An ideal DC source maintains a constant voltage between its terminals regardless of the current drawn (minus any internal resistance drop).',
      equation: 'V_terminal = V − I·R_int',
      unit: 'Volt (V) — 1 V = 1 joule per coulomb.',
      effect: 'Sets the potential difference that drives current around the circuit. Power delivered P = V·I.',
    },
    valueText: (c) => shortEng(num(c.props.voltage), 'V'),
  },
  acsource: {
    type: 'acsource',
    name: 'AC Voltage Source',
    category: 'Sources',
    prefix: 'V',
    terminals: TV,
    terminalNames: ['+', '−'],
    defaults: { amplitude: 10, frequency: 60, phase: 0, offset: 0, internalResistance: 0 },
    params: [
      { key: 'amplitude', label: 'Peak voltage', unit: 'V', kind: 'number', min: 0 },
      { key: 'frequency', label: 'Frequency', unit: 'Hz', kind: 'number', positive: true },
      { key: 'phase', label: 'Phase', unit: '°', kind: 'number' },
      { key: 'offset', label: 'DC offset', unit: 'V', kind: 'number' },
      { key: 'internalResistance', label: 'Internal resistance', unit: 'Ω', kind: 'number', min: 0 },
    ],
    edu: {
      what: 'An AC source produces a sinusoidal voltage that periodically reverses polarity, like mains electricity.',
      equation: 'v(t) = Vp·sin(2πft + φ) + V_dc      V_rms = Vp/√2',
      unit: 'Volt (V) peak; frequency in Hertz (Hz = cycles per second).',
      effect: 'Drives reactive components: capacitors and inductors have frequency-dependent impedance, so currents shift in phase relative to voltage.',
    },
    valueText: (c) => `${shortEng(num(c.props.amplitude), 'V')} ${shortEng(num(c.props.frequency), 'Hz')}`,
  },
  battery: {
    type: 'battery',
    name: 'Battery',
    category: 'Sources',
    prefix: 'B',
    terminals: TV,
    terminalNames: ['+', '−'],
    defaults: { voltage: 9, internalResistance: 0.5 },
    params: [
      { key: 'voltage', label: 'EMF', unit: 'V', kind: 'number' },
      { key: 'internalResistance', label: 'Internal resistance', unit: 'Ω', kind: 'number', min: 0 },
    ],
    edu: {
      what: 'A battery is an electrochemical DC source. Real batteries have internal resistance, so terminal voltage sags under load.',
      equation: 'V_terminal = EMF − I·R_int      I_short = EMF / R_int',
      unit: 'Volt (V); internal resistance in Ohms (Ω).',
      effect: 'Behaves like an ideal source in series with a small resistor. Heavy loads waste power inside the battery as I²R_int.',
    },
    valueText: (c) => shortEng(num(c.props.voltage), 'V'),
  },
};
