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
  ground: {
    type: 'ground',
    name: 'Ground',
    category: 'Sources',
    prefix: 'GND',
    terminals: [{ x: 0, y: -20 }],
    terminalNames: ['GND'],
    defaults: {},
    params: [],
    edu: {
      what: 'Ground is the reference node for all voltage measurements. It is defined as 0 V.',
      equation: 'V_ground ≡ 0 V',
      unit: 'Reference potential (0 V).',
      effect: 'Every node voltage is measured relative to ground. A circuit needs one reference for nodal analysis to have a unique solution.',
    },
    valueText: () => '',
  },
  diode: {
    type: 'diode',
    name: 'Diode',
    category: 'Semiconductors',
    prefix: 'D',
    terminals: T2,
    terminalNames: ['A', 'K'],
    defaults: { saturationCurrent: 1e-14, emission: 1, maxCurrent: 1 },
    params: [
      { key: 'saturationCurrent', label: 'Saturation current Is', unit: 'A', kind: 'number', positive: true },
      { key: 'emission', label: 'Emission coeff. n', kind: 'number', positive: true },
      { key: 'maxCurrent', label: 'Max forward current', unit: 'A', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A diode lets current flow from anode to cathode and blocks it in reverse. Silicon diodes drop about 0.6–0.7 V when conducting.',
      equation: 'I = Is·(e^(V/(n·Vt)) − 1),   Vt ≈ 25.85 mV',
      unit: 'Current in Amperes (A); forward voltage in Volts (V).',
      effect: 'A nonlinear element — the simulator solves it with Newton–Raphson iteration. Used for rectification and protection.',
    },
    valueText: () => '',
  },
  led: {
    type: 'led',
    name: 'LED',
    category: 'Output',
    prefix: 'D',
    terminals: T2,
    terminalNames: ['A', 'K'],
    defaults: { color: 'red', forwardVoltage: 1.9, maxCurrent: 0.03 },
    params: [
      {
        key: 'color',
        label: 'Color',
        kind: 'select',
        options: Object.entries(LED_COLORS).map(([value, v]) => ({ value, label: v.label })),
      },
      { key: 'forwardVoltage', label: 'Forward voltage @20 mA', unit: 'V', kind: 'number', positive: true },
      { key: 'maxCurrent', label: 'Max current', unit: 'A', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A light-emitting diode emits light when forward current flows. It needs a series resistor to limit current.',
      equation: 'R_limit = (V_supply − V_f) / I_f',
      unit: 'Forward current in Amperes (A), typically 5–20 mA.',
      effect: 'Brightness rises with current. Without a current-limiting resistor the exponential I–V curve lets current rise destructively.',
    },
    valueText: (c) => LED_COLORS[String(c.props.color)]?.label ?? '',
  },
  switch: {
    type: 'switch',
    name: 'Switch (SPST)',
    category: 'Switches',
    prefix: 'S',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { closed: false, onResistance: 0.01 },
    params: [
      { key: 'closed', label: 'Closed', kind: 'boolean' },
      { key: 'onResistance', label: 'On resistance', unit: 'Ω', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A switch opens or closes a circuit path. Click it while the simulation runs to toggle it.',
      equation: 'Closed: R ≈ R_on      Open: R → ∞ (I = 0)',
      unit: 'Contact resistance in Ohms (Ω).',
      effect: 'Opening a switch breaks the loop so no current flows. Switching events trigger transients in RC/RL circuits.',
    },
    valueText: (c) => (c.props.closed ? 'ON' : 'OFF'),
  },
  spdt: {
    type: 'spdt',
    name: 'Switch (SPDT)',
    category: 'Switches',
    prefix: 'S',
    terminals: [
      { x: -40, y: -20 },
      { x: -40, y: 20 },
      { x: 40, y: 0 },
    ],
    terminalNames: ['A', 'B', 'COM'],
    defaults: { position: 'A', onResistance: 0.01 },
    params: [
      {
        key: 'position',
        label: 'Position',
        kind: 'select',
        options: [
          { value: 'A', label: 'A (upper)' },
          { value: 'B', label: 'B (lower)' },
        ],
      },
      { key: 'onResistance', label: 'On resistance', unit: 'Ω', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A single-pole double-throw switch connects its common terminal to one of two throws. Click it while running to flip.',
      equation: 'COM↔A  or  COM↔B',
      unit: 'Contact resistance in Ohms (Ω).',
      effect: 'Ideal for charge/discharge experiments: flip between a source and ground to watch capacitor or inductor transients.',
    },
    valueText: (c) => String(c.props.position),
  },
  pushbutton: {
    type: 'pushbutton',
    name: 'Push Button',
    category: 'Switches',
    prefix: 'PB',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { onResistance: 0.01 },
    params: [{ key: 'onResistance', label: 'On resistance', unit: 'Ω', kind: 'number', positive: true }],
    edu: {
      what: 'A momentary, normally-open push button. It conducts only while held down — press and hold it on the canvas while the simulation runs.',
      equation: 'Pressed: R ≈ R_on      Released: open',
      unit: 'Contact resistance in Ohms (Ω).',
      effect: 'Useful for momentary inputs: briefly charging a capacitor, triggering a transistor, etc.',
    },
    valueText: () => '',
  },
  bulb: {
    type: 'bulb',
    name: 'Light Bulb',
    category: 'Output',
    prefix: 'LMP',
    terminals: T2,
    terminalNames: ['1', '2'],
    defaults: { ratedVoltage: 12, ratedPower: 5 },
    params: [
      { key: 'ratedVoltage', label: 'Rated voltage', unit: 'V', kind: 'number', positive: true },
      { key: 'ratedPower', label: 'Rated power', unit: 'W', kind: 'number', positive: true },
    ],
    edu: {
      what: 'An incandescent bulb is a resistive filament that glows when heated by current. Modeled here as R = V_rated² / P_rated.',
      equation: 'R = V²/P      Brightness ∝ P / P_rated',
      unit: 'Power in Watts (W).',
      effect: 'Brightness shows how much power the bulb dissipates. Bulbs in series share the voltage and glow dimmer than bulbs in parallel.',
    },
    valueText: (c) => `${shortEng(num(c.props.ratedVoltage), 'V')}/${shortEng(num(c.props.ratedPower), 'W')}`,
  },
  ammeter: {
    type: 'ammeter',
    name: 'Ammeter',
    category: 'Instruments',
    prefix: 'AM',
    terminals: T2,
    terminalNames: ['+', '−'],
    defaults: {},
    params: [],
    edu: {
      what: 'An ideal ammeter measures the current flowing through it. It must be placed in series with the branch being measured.',
      equation: 'I measured (R_ammeter = 0, V_drop = 0)',
      unit: 'Ampere (A) — 1 A is 1 coulomb per second.',
      effect: 'Zero-resistance meter: does not disturb the circuit. Positive reading means current enters the + terminal.',
    },
    valueText: () => '',
  },
  voltmeter: {
    type: 'voltmeter',
    name: 'Voltmeter',
    category: 'Instruments',
    prefix: 'VM',
    terminals: T2,
    terminalNames: ['+', '−'],
    defaults: {},
    params: [],
    edu: {
      what: 'An ideal voltmeter measures the potential difference between its two probes. Place it in parallel with the element.',
      equation: 'V = V(+) − V(−)   (R_voltmeter → ∞)',
      unit: 'Volt (V).',
      effect: 'Infinite-resistance meter: draws no current and does not load the circuit.',
    },
    valueText: () => '',
  },
  npn: {
    type: 'npn',
    name: 'NPN Transistor',
    category: 'Semiconductors',
    prefix: 'Q',
    terminals: [
      { x: -40, y: 0 },
      { x: 20, y: -40 },
      { x: 20, y: 40 },
    ],
    terminalNames: ['B', 'C', 'E'],
    defaults: { beta: 100, betaR: 1, saturationCurrent: 1e-14 },
    params: [
      { key: 'beta', label: 'Forward gain βF (hFE)', kind: 'number', positive: true },
      { key: 'betaR', label: 'Reverse gain βR', kind: 'number', positive: true },
      { key: 'saturationCurrent', label: 'Saturation current Is', unit: 'A', kind: 'number', positive: true },
    ],
    edu: {
      what: 'A bipolar junction transistor uses a small base current to control a larger collector current. Modeled with the Ebers–Moll equations.',
      equation: 'Ic ≈ β·Ib (active)      Ie = Ic + Ib      Vbe ≈ 0.65 V',
      unit: 'Currents in Amperes (A); β is dimensionless.',
      effect: 'Acts as an amplifier in the active region or as a switch when driven into saturation (Vce ≈ 0.1–0.2 V).',
    },
    valueText: (c) => `β=${num(c.props.beta)}`,
  },
};

export const LIBRARY_ORDER: CompType[] = [
  'resistor',
  'capacitor',
  'inductor',
  'dcsource',
  'acsource',
  'battery',
  'ground',
  'diode',
  'led',
  'npn',
  'switch',
  'spdt',
  'pushbutton',
  'bulb',
  'ammeter',
  'voltmeter',
];

export function terminalPositions(c: Component): Point[] {
  return DEFS[c.type].terminals.map((t) => {
    const r = rotatePoint(t, c.rot);
    return { x: c.x + r.x, y: c.y + r.y };
  });
}

export function nextLabel(type: CompType, existing: Component[]): string {
  const prefix = DEFS[type].prefix;
  if (type === 'ground') return 'GND';
  let n = 1;
  const used = new Set(existing.map((c) => c.label));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
