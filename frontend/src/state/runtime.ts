// Real-time transient simulation driver. Lives outside React: it steps the
// solver inside requestAnimationFrame, records waveform history and publishes
// a snapshot to the store for the UI to render.

import { Circuit, Point } from '@ohmlab/shared/model/types';
import { terminalPositions } from '@ohmlab/shared/model/library';
import { Simulator, SimSnapshot } from '@ohmlab/shared/engine/simulator';
import { Netlist, pointOnSegment } from '@ohmlab/shared/engine/netlist';
import { segmentCurrents } from '@ohmlab/shared/engine/currents';
import { useStore } from './store';

// ------------------------------------------------------------------ history

export class History {
  t: number[] = [];
  data = new Map<string, number[]>();
  version = 0;
  maxLen = 40000;
  clear() {
    this.t = [];
    this.data = new Map();
    this.version++;
  }
  push(t: number, sample: Map<string, number>) {
    const n = this.t.length;
    this.t.push(t);
    for (const [k, v] of sample) {
      let arr = this.data.get(k);
      if (!arr) {
        arr = new Array(n).fill(NaN);
        this.data.set(k, arr);
      }
      arr.push(v);
    }
    for (const [k, arr] of this.data) if (!sample.has(k)) arr.push(NaN);
    if (this.t.length > this.maxLen * 1.25) {
      const cut = this.t.length - this.maxLen;
      this.t = this.t.slice(cut);
      for (const [k, arr] of this.data) this.data.set(k, arr.slice(cut));
    }
    this.version++;
  }
}

export const history = new History();

// ------------------------------------------------------------------ signals

export interface SignalInfo {
  key: string;
  name: string;
  unit: 'V' | 'A' | 'W';
  group: string;
}

export function listSignals(circuit: Circuit, netlist: Netlist): SignalInfo[] {
  const out: SignalInfo[] = [];
  for (const p of useStore.getState().probes) {
    out.push({ key: `probe:${p.id}`, name: `${p.name} (probe)`, unit: 'V', group: 'Probes' });
  }
  for (let i = 1; i < netlist.nodeCount; i++) out.push({ key: `n:${i}`, name: `V(${netlist.netNames[i]})`, unit: 'V', group: 'Node voltages' });
  for (const c of circuit.components) {
    if (c.type === 'ground') continue;
    if (c.type !== 'ammeter') out.push({ key: `v:${c.id}`, name: `V(${c.label})`, unit: 'V', group: 'Component voltage' });
    if (c.type !== 'voltmeter') out.push({ key: `i:${c.id}`, name: `I(${c.label})`, unit: 'A', group: 'Component current' });
    if (c.type !== 'voltmeter' && c.type !== 'ammeter') out.push({ key: `p:${c.id}`, name: `P(${c.label})`, unit: 'W', group: 'Component power' });
  }
  return out;
}

/** net index under a canvas point (terminal or anywhere along a wire), or -1 */
export function netAtPoint(circuit: Circuit, netlist: Netlist, p: Point): number {
  for (const c of circuit.components) {
    const tp = terminalPositions(c);
    for (let k = 0; k < tp.length; k++) if (tp[k].x === p.x && tp[k].y === p.y) return netlist.compNodes.get(c.id)![k];
  }
  for (const s of netlist.segments) if (pointOnSegment(p, s.a, s.b, true)) return s.net;
  return -1;
}

function sampleOf(snap: SimSnapshot, circuit: Circuit, netlist: Netlist, probeNets: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, net] of probeNets) m.set(`probe:${id}`, net >= 0 ? snap.nodeV[net] ?? NaN : NaN);
  for (let i = 1; i < netlist.nodeCount; i++) m.set(`n:${i}`, snap.nodeV[i]);
  for (const c of circuit.components) {
    const r = snap.readings[c.id];
    if (!r || c.type === 'ground') continue;
    if (c.type !== 'ammeter') m.set(`v:${c.id}`, r.v);
    if (c.type !== 'voltmeter') m.set(`i:${c.id}`, r.i);
    if (c.type !== 'voltmeter' && c.type !== 'ammeter') m.set(`p:${c.id}`, r.p);
  }
  return m;
}

// ------------------------------------------------------------------ simulator driver

export const runtime = {
  sim: null as Simulator | null,
  circuit: null as Circuit | null,
  pressedKey: '',
  segCurrents: new Float64Array(0) as Float64Array,
  segPhase: new Float64Array(0),
  probeNets: new Map<string, number>(),
  probesRef: null as unknown,
  lastRecord: -Infinity,
  raf: 0,
  lastFrame: 0,
  timeScales: [] as number[],
};

function pressedSet(): Set<string> {
  return new Set(Object.keys(useStore.getState().pressed));
}

function computeTimeScales(sim: Simulator): number[] {
  const scales: number[] = [];
  let minL = Infinity;
  let minC = Infinity;
  for (const el of sim.elements) {
    const c = el.comp;
    if (c.type === 'capacitor') {
      const C = Number(c.props.capacitance);
      minC = Math.min(minC, C);
      const R = sim.theveninResistance(c.id);
      if (Number.isFinite(R) && R < 1e9 && R > 0) scales.push(R * C);
    } else if (c.type === 'inductor') {
      const L = Number(c.props.inductance);
      minL = Math.min(minL, L);
      const R = sim.theveninResistance(c.id);
      if (Number.isFinite(R) && R > 1e-6 && R < 1e9) scales.push(L / R);
    } else if (c.type === 'acsource') {
      const f = Number(c.props.frequency);
      if (f > 0) scales.push(1 / f);
    }
  }
  if (Number.isFinite(minL) && Number.isFinite(minC)) scales.push(2 * Math.PI * Math.sqrt(minL * minC));
  return scales;
}

export function stepSize(): number {
  const s = useStore.getState();
  if (s.timestep) return s.timestep;
  const perFrame = s.speed / 60;
  let h = perFrame / 15;
  const minScale = runtime.timeScales.length ? Math.min(...runtime.timeScales) : Infinity;
  if (Number.isFinite(minScale)) h = Math.min(h, minScale / 60);
  h = Math.max(h, perFrame / 2500); // cap work per frame
  return Math.min(Math.max(h, 1e-9), 0.01);
}

function ensureSim(): Simulator {
  const s = useStore.getState();
  const key = Object.keys(s.pressed).sort().join(',');
  if (!runtime.sim) {
    runtime.sim = new Simulator(s.circuit, pressedSet());
    runtime.circuit = s.circuit;
    runtime.pressedKey = key;
    onCompiled();
  } else if (runtime.circuit !== s.circuit || runtime.pressedKey !== key) {
    runtime.sim.compile(s.circuit, pressedSet(), true);
    runtime.circuit = s.circuit;
    runtime.pressedKey = key;
    onCompiled();
  }
  if (runtime.probesRef !== s.probes) resolveProbes();
  return runtime.sim;
}

function resolveProbes() {
  const s = useStore.getState();
  runtime.probesRef = s.probes;
  runtime.probeNets = new Map();
  if (!runtime.sim) return;
  for (const p of s.probes) runtime.probeNets.set(p.id, netAtPoint(s.circuit, runtime.sim.netlist, p));
}

function onCompiled() {
  const sim = runtime.sim!;
  runtime.timeScales = computeTimeScales(sim);
  runtime.segCurrents = new Float64Array(sim.netlist.segments.length);
  runtime.segPhase = new Float64Array(sim.netlist.segments.length);
  resolveProbes();
  useStore.getState().set({ autoH: stepSize() });
}

function publish(sim: Simulator, error: string | null, lagging: boolean) {
  const snap = sim.snapshot();
  runtime.segCurrents = segmentCurrents(sim.netlist, sim.circuit, snap.termCurrents);
  useStore.getState().set({ snapshot: snap, simError: error, lagging });
  return snap;
}

function record(sim: Simulator) {
  const snap = sim.snapshot();
  history.push(sim.t, sampleOf(snap, sim.circuit, sim.netlist, runtime.probeNets));
}

function frame(now: number) {
  const s = useStore.getState();
  if (s.simStatus !== 'running') {
    runtime.raf = 0;
    return;
  }
  const sim = ensureSim();
  const dt = Math.min((now - runtime.lastFrame) / 1000, 0.1);
  runtime.lastFrame = now;
  const h = stepSize();
  const target = sim.t + s.speed * dt;
  const t0 = performance.now();
  let err: string | null = null;
  let lag = false;
  const recEvery = Math.max(h, s.speed / 600);
  while (sim.t + h * 0.5 < target) {
    const r = sim.step(h);
    if (!r.ok) {
      err = r.error ?? 'Simulation failed';
      break;
    }
    if (sim.t - runtime.lastRecord >= recEvery * 0.999) {
      record(sim);
      runtime.lastRecord = sim.t;
    }
    if (performance.now() - t0 > 14) {
      lag = true;
      break;
    }
  }
  // animate current dots
  const cur = runtime.segCurrents;
  for (let i = 0; i < cur.length; i++) {
    const a = Math.abs(cur[i]);
    if (a < 1e-7) continue;
    const vis = Math.min(Math.max(Math.log10(a / 1e-7) / 5, 0.15), 1.3);
    runtime.segPhase[i] = (runtime.segPhase[i] + Math.sign(cur[i]) * vis * 70 * dt) % 1e6;
  }
  publish(sim, err, lag);
  if (err) {
    useStore.getState().set({ simStatus: 'paused' });
    useStore.getState().notify(err, 'error');
    runtime.raf = 0;
    return;
  }
  runtime.raf = requestAnimationFrame(frame);
}

export function runSim() {
  const s = useStore.getState();
  if (s.simStatus === 'running') return;
  if (s.simStatus === 'stopped') {
    runtime.sim = null;
    history.clear();
    runtime.lastRecord = -Infinity;
  }
  const sim = ensureSim();
  const blocking = sim.blockingError();
  if (blocking) {
    s.set({ simError: blocking });
    s.notify(blocking, 'error');
    return;
  }
  if (sim.t === 0 && history.t.length === 0) {
    record(sim);
    runtime.lastRecord = 0;
  }
  s.set({ simStatus: 'running', simError: null });
  runtime.lastFrame = performance.now();
  if (!runtime.raf) runtime.raf = requestAnimationFrame(frame);
}

export function pauseSim() {
  const s = useStore.getState();
  if (s.simStatus === 'running') s.set({ simStatus: 'paused' });
}

export function stopSim() {
  const s = useStore.getState();
  s.set({ simStatus: 'stopped', snapshot: null, simError: null, lagging: false });
  runtime.sim = null;
  runtime.segCurrents = new Float64Array(0);
}

export function resetSim() {
  const s = useStore.getState();
  history.clear();
  runtime.lastRecord = -Infinity;
  if (runtime.sim) {
    runtime.sim.reset();
    record(runtime.sim);
    runtime.lastRecord = 0;
    publish(runtime.sim, null, false);
  }
  if (s.simStatus === 'stopped') s.set({ snapshot: null });
}

/** Single-step for debugging/education: advance exactly one time step while paused. */
export function stepOnce() {
  const s = useStore.getState();
  if (s.simStatus === 'running') return;
  const sim = ensureSim();
  const r = sim.step(stepSize());
  record(sim);
  publish(sim, r.ok ? null : r.error ?? 'failed', false);
  s.set({ simStatus: 'paused' });
}

/** Batch transient analysis (.tran) from t=0 to tStop, replacing the recorded history. */
export function runTransient(tStop: number, h: number): { ok: boolean; error?: string; steps: number } {
  const s = useStore.getState();
  if (s.simStatus === 'running') s.set({ simStatus: 'paused' });
  const sim = new Simulator(s.circuit, pressedSet());
  const blocking = sim.blockingError();
  if (blocking) return { ok: false, error: blocking, steps: 0 };
  runtime.sim = sim;
  runtime.circuit = s.circuit;
  runtime.pressedKey = Object.keys(s.pressed).sort().join(',');
  onCompiled();
  history.clear();
  const n = Math.min(Math.ceil(tStop / h), 400000);
  const recEvery = Math.max(h, tStop / 20000);
  record(sim);
  let last = 0;
  for (let k = 0; k < n; k++) {
    const r = sim.step(h);
    if (!r.ok) {
      publish(sim, r.error ?? 'failed', false);
      return { ok: false, error: r.error, steps: k };
    }
    if (sim.t - last >= recEvery * 0.999) {
      record(sim);
      last = sim.t;
    }
  }
  runtime.lastRecord = sim.t;
  publish(sim, null, false);
  s.set({ simStatus: 'paused' });
  return { ok: true, steps: n };
}

export function currentSignals(): SignalInfo[] {
  const s = useStore.getState();
  const sim = runtime.sim ?? new Simulator(s.circuit);
  return listSignals(s.circuit, sim.netlist);
}
