import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../model/examples';
import { Simulator } from './simulator';

const ex = (id: string) => {
  const c = EXAMPLES.find((e) => e.id === id)!.build();
  const sim = new Simulator(c);
  const byLabel = (l: string) => c.components.find((x) => x.label === l)!.id;
  return { c, sim, byLabel };
};

describe('examples have clean topology', () => {
  for (const e of EXAMPLES) {
    it(e.id, () => {
      const sim = new Simulator(e.build());
      const bad = sim.netlist.issues.filter((i) => i.level !== 'info');
      expect(bad).toEqual([]);
    });
  }
});

describe('DC analysis', () => {
  it('series resistors', () => {
    const { sim, byLabel } = ex('series');
    expect(sim.solveDC().ok).toBe(true);
    const s = sim.snapshot();
    expect(s.readings[byLabel('R1')].i).toBeCloseTo(9 / 6500, 9);
    expect(s.readings[byLabel('VM1')].v).toBeCloseTo((9 * 2200) / 6500, 6);
    expect(s.kclResidual).toBeLessThan(1e-9);
    expect(Math.abs(s.powerBalance)).toBeLessThan(1e-9);
  });
  it('parallel resistors', () => {
    const { sim, byLabel } = ex('parallel');
    sim.solveDC();
    const s = sim.snapshot();
    expect(s.readings[byLabel('AM1')].i).toBeCloseTo(12 / 100 + 12 / 220 + 12 / 470, 6);
  });
  it('voltage divider', () => {
    const { sim, byLabel } = ex('divider');
    sim.solveDC();
    expect(sim.snapshot().readings[byLabel('VM1')].v).toBeCloseTo(10 * 3.3 / 10.1, 6);
  });
  it('LED', () => {
    const { sim, byLabel } = ex('led');
    const r = sim.solveDC();
    expect(r.ok).toBe(true);
    const d = sim.snapshot().readings[byLabel('D1')];
    expect(d.v).toBeGreaterThan(1.85);
    expect(d.v).toBeLessThan(1.95);
    expect(d.i).toBeCloseTo((9 - d.v) / 360, 6);
  });
  it('transistor saturates', () => {
    const { sim, byLabel } = ex('transistor');
    const r = sim.solveDC();
    expect(r.ok).toBe(true);
    const q = sim.snapshot().readings[byLabel('Q1')];
    expect(q.extra!.region).toBe('Saturation');
    expect(q.i).toBeGreaterThan(0.018);
    expect(q.i).toBeLessThan(0.023);
  });
});

describe('transient', () => {
  it('RC charges with tau = RC', () => {
    const { sim, byLabel } = ex('rc');
    const h = 1e-4;
    for (let k = 0; k < 1000; k++) expect(sim.step(h).ok).toBe(true); // 0.1 s = 1 tau
    const snap = sim.snapshot();
    const v = snap.readings[byLabel('C1')].v;
    expect(v).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
    // capacitor current equals resistor current; KCL and power balance hold in transient
    expect(snap.readings[byLabel('C1')].i).toBeCloseTo(snap.readings[byLabel('R1')].i, 6);
    expect(snap.kclResidual).toBeLessThan(1e-9);
    expect(Math.abs(snap.powerBalance)).toBeLessThan(1e-7);
  });
  it('RL current rises with tau = L/R', () => {
    const { sim, byLabel } = ex('rl');
    const h = 1e-6;
    for (let k = 0; k < 1000; k++) sim.step(h);
    const i = sim.snapshot().readings[byLabel('AM1')].i;
    const R = 100.01; // + switch on-resistance
    expect(i).toBeCloseTo((10 / R) * (1 - Math.exp((-1e-3 * R) / 0.1)), 4);
  });
  it('RLC driven at resonance reaches steady-state amplitude', () => {
    const { sim, byLabel } = ex('rlc');
    const h = 2e-6;
    let max = 0;
    for (let k = 0; k < 20000; k++) {
      sim.step(h);
      if (sim.t > 0.03) max = Math.max(max, Math.abs(sim.snapshot().readings[byLabel('VM1')].v));
    }
    expect(max).toBeGreaterThan(7.8);
    expect(max).toBeLessThan(8.1);
    expect(sim.snapshot().kclResidual).toBeLessThan(1e-9);
  });
  it('bridge rectifier output', () => {
    const { sim, byLabel } = ex('bridge');
    const h = 2e-5;
    let max = 0;
    let min = 1e9;
    for (let k = 0; k < 5000; k++) {
      expect(sim.step(h).ok).toBe(true);
      if (sim.t > 0.05) {
        const v = sim.snapshot().readings[byLabel('VM1')].v;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
    expect(max).toBeGreaterThan(10);
    expect(max).toBeLessThan(11.2);
    expect(min).toBeGreaterThan(5);
  });
});

describe('AC analysis', () => {
  it('series RLC phasor', () => {
    const { sim, byLabel } = ex('rlc');
    const r = sim.solveAC(500);
    expect(r.ok).toBe(true);
    const [ir, ii] = r.comps[byLabel('R1')].i;
    const XL = 2 * Math.PI * 500 * 0.01;
    const XC = 1 / (2 * Math.PI * 500 * 1e-5);
    expect(Math.hypot(ir, ii)).toBeCloseTo(5 / Math.hypot(20, XL - XC), 6);
  });
  it('thevenin resistance for RC', () => {
    const { sim, byLabel } = ex('rc');
    expect(sim.theveninResistance(byLabel('C1'))).toBeCloseTo(1000.01, 3);
  });
});
