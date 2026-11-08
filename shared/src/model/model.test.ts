import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import { exportSpice, importSpice } from './spice';
import { Simulator } from '../engine/simulator';
import { autoPlace, padPositions, routeBoard } from './pcb';
import { parseEng } from './units';
import { segmentCurrents } from '../engine/currents';

describe('units', () => {
  it('parses engineering notation', () => {
    expect(parseEng('4.7k')).toBeCloseTo(4700);
    expect(parseEng('10u')).toBeCloseTo(1e-5);
    expect(parseEng('2.2 mH')).toBeCloseTo(2.2e-3);
    expect(parseEng('1meg')).toBeCloseTo(1e6);
    expect(parseEng('100nF')).toBeCloseTo(1e-7);
    expect(parseEng('abc')).toBeNaN();
  });
});

describe('SPICE round trip', () => {
  for (const id of ['series', 'parallel', 'divider', 'led', 'transistor']) {
    it(id, () => {
      const ex = EXAMPLES.find((e) => e.id === id)!;
      const c = ex.build();
      const a = new Simulator(c);
      expect(a.solveDC().ok).toBe(true);
      const { circuit: c2 } = importSpice(exportSpice(c));
      const b = new Simulator(c2);
      expect(b.netlist.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(b.solveDC().ok).toBe(true);
      // compare total source power
      const pa = c.components.filter((k) => k.type === 'dcsource').reduce((s, k) => s + a.snapshot().readings[k.id].p, 0);
      const pb = c2.components.filter((k) => k.type === 'dcsource').reduce((s, k) => s + b.snapshot().readings[k.id].p, 0);
      expect(pb).toBeCloseTo(pa, 6);
    });
  }
});

describe('PCB', () => {
  for (const ex of EXAMPLES) {
    it(`places and routes ${ex.id}`, () => {
      const c = ex.build();
      const place = autoPlace(c);
      const pads = padPositions(c, place);
      const keys = pads.map((p) => `${p.x},${p.y}`);
      expect(new Set(keys).size).toBe(keys.length); // no overlapping pads
      const r = routeBoard(c, place);
      expect(r.unrouted.length).toBe(0);
    });
  }
});

describe('wire current flow', () => {
  it('series circuit wires carry the loop current', () => {
    const c = EXAMPLES.find((e) => e.id === 'series')!.build();
    const sim = new Simulator(c);
    sim.solveDC();
    const snap = sim.snapshot();
    const cur = segmentCurrents(sim.netlist, c, snap.termCurrents);
    const I = 9 / 6500;
    // every segment in the main loop carries ±I (voltmeter branches carry 0)
    const mags = [...cur].map(Math.abs).filter((v) => v > 1e-9);
    for (const m of mags) expect(m).toBeCloseTo(I, 9);
    expect(mags.length).toBeGreaterThan(4);
  });
});

import { collectObstacles, smartRoute } from './router';
import { DEFS, terminalPositions } from './library';
import { Circuit, CompType } from './types';
import { buildNetlist } from '../engine/netlist';

describe('interactive wire routing', () => {
  it('never shorts components when wiring a source, resistor and ground', () => {
    const mk = (id: string, type: CompType, x: number, y: number) => ({ id, type, x, y, rot: 0, label: id, props: { ...DEFS[type].defaults } });
    const c: Circuit = { name: 't', components: [mk('V1', 'dcsource', 260, 300), mk('R1', 'resistor', 460, 180), mk('GND', 'ground', 260, 460)], wires: [] };
    const T = (id: string, k: number) => terminalPositions(c.components.find((x) => x.id === id)!)[k];
    const connect = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const pts = [a, ...smartRoute(a, b, collectObstacles(c))];
      c.wires.push({ id: `w${c.wires.length}`, points: pts });
    };
    connect(T('V1', 0), T('R1', 0));
    connect(T('R1', 1), T('GND', 0));
    connect(T('V1', 1), T('GND', 0));
    const nl = buildNetlist(c);
    expect(nl.issues.filter((i) => i.level !== 'info')).toEqual([]);
    const sim = new Simulator(c);
    expect(sim.solveDC().ok).toBe(true);
    expect(sim.snapshot().readings.R1.i).toBeCloseTo(5 / 1000, 9);
  });
});
