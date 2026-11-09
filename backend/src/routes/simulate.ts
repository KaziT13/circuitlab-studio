// Headless analysis endpoints. The browser runs its own real-time simulation;
// these let scripts, tests and other clients run the same engine over HTTP.

import { Router } from 'express';
import type { Circuit } from '@ohmlab/shared/model/types';
import { validateCircuit } from '@ohmlab/shared/model/validate';
import { exportSpice, importSpice } from '@ohmlab/shared/model/spice';
import { Simulator } from '@ohmlab/shared/engine/simulator';
import { handle, HttpError, num, strings } from '../http';

/** Server-side ceilings so one request can't monopolise the CPU. */
export const LIMITS = { tranSteps: 100_000, tranPoints: 2_000, acPoints: 1_000, spiceChars: 200_000 };

function circuitFrom(body: unknown): Circuit {
  try {
    return validateCircuit((body as { circuit?: unknown } | undefined)?.circuit);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

function simulator(body: unknown, circuit: Circuit): Simulator {
  const pressed = strings((body as { pressed?: unknown }).pressed, 'pressed', 1000);
  return new Simulator(circuit, new Set(pressed));
}

export function simulateRouter(): Router {
  const r = Router();

  /** DC operating point. */
  r.post(
    '/simulate/dc',
    handle((req, res) => {
      const circuit = circuitFrom(req.body);
      const sim = simulator(req.body, circuit);
      const result = sim.solveDC();
      if (!result.ok) return res.status(422).json({ ok: false, error: result.error });
      const snap = sim.snapshot();
      res.json({
        ok: true,
        iterations: result.iterations,
        netNames: sim.netlist.netNames,
        nodeV: snap.nodeV,
        readings: snap.readings,
        issues: snap.issues,
      });
    }),
  );

  /** Logarithmic AC sweep. Probes: "n:<netIndex>", "v:<componentId>" or "i:<componentId>". */
  r.post(
    '/simulate/ac',
    handle((req, res) => {
      const circuit = circuitFrom(req.body);
      const f0 = num(req.body.f0, 'f0', { min: 1e-6, max: 1e12 });
      const f1 = num(req.body.f1, 'f1', { min: f0, max: 1e12 });
      const points = num(req.body.points ?? 100, 'points', { min: 1, max: LIMITS.acPoints, integer: true });
      const probes = strings(req.body.probes, 'probes');
      if (!probes.length) throw new HttpError(400, '"probes" must name at least one signal.');
      for (const p of probes) if (!/^[nvi]:./.test(p)) throw new HttpError(400, `Invalid probe "${p}".`);
      const sweep = simulator(req.body, circuit).acSweep(f0, f1, points, probes);
      res.status(sweep.ok ? 200 : 422).json(sweep);
    }),
  );

  /** Transient analysis from t=0 to tStop with step h; node voltages are downsampled. */
  r.post(
    '/simulate/transient',
    handle((req, res) => {
      const circuit = circuitFrom(req.body);
      const tStop = num(req.body.tStop, 'tStop', { min: 0 });
      const h = num(req.body.h, 'h', { min: 1e-12 });
      if (tStop <= 0) throw new HttpError(400, '"tStop" must be positive.');
      const steps = Math.ceil(tStop / h);
      if (steps > LIMITS.tranSteps) throw new HttpError(400, `tStop / h is ${steps} steps; the limit is ${LIMITS.tranSteps}.`);
      const sim = simulator(req.body, circuit);
      const blocking = sim.blockingError();
      if (blocking) return res.status(422).json({ ok: false, error: blocking });

      const every = Math.max(1, Math.ceil(steps / LIMITS.tranPoints));
      const t: number[] = [];
      const nodeV: number[][] = [];
      const record = () => {
        t.push(sim.t);
        nodeV.push(Array.from(sim.snapshot().nodeV));
      };
      record();
      for (let k = 1; k <= steps; k++) {
        const r = sim.step(h);
        if (!r.ok) return res.status(422).json({ ok: false, error: r.error, failedAt: sim.t });
        if (k % every === 0 || k === steps) record();
      }
      res.json({ ok: true, steps, netNames: sim.netlist.netNames, t, nodeV });
    }),
  );

  r.post(
    '/spice/export',
    handle((req, res) => {
      const circuit = circuitFrom(req.body);
      const opts: { tstop?: number; tstep?: number } = {};
      if (req.body.tstop !== undefined) opts.tstop = num(req.body.tstop, 'tstop', { min: 0 });
      if (req.body.tstep !== undefined) opts.tstep = num(req.body.tstep, 'tstep', { min: 0 });
      res.type('text/plain').send(exportSpice(circuit, opts));
    }),
  );

  r.post(
    '/spice/import',
    handle((req, res) => {
      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, '"text" must be a non-empty SPICE netlist.');
      if (text.length > LIMITS.spiceChars) throw new HttpError(400, `Netlist is longer than ${LIMITS.spiceChars} characters.`);
      try {
        res.json(importSpice(text));
      } catch (e) {
        throw new HttpError(400, `Could not parse netlist: ${(e as Error).message}`);
      }
    }),
  );

  return r;
}
