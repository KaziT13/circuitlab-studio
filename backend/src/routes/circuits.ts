import { Router } from 'express';
import { validateCircuit } from '@ohmlab/shared/model/validate';
import { handle, HttpError } from '../http';
import { CircuitStore, MAX_NAME_LENGTH, MAX_SAVED } from '../storage';

function circuitName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new HttpError(400, 'Circuit name must not be empty.');
  if (name.length > MAX_NAME_LENGTH) throw new HttpError(400, `Circuit name must be at most ${MAX_NAME_LENGTH} characters.`);
  return name;
}

export function circuitsRouter(store: CircuitStore): Router {
  const r = Router();

  r.get('/', handle(async (_req, res) => res.json(await store.list())));

  r.get(
    '/:name',
    handle(async (req, res) => {
      const saved = await store.get(circuitName(req.params.name));
      if (!saved) throw new HttpError(404, 'No saved circuit with that name.');
      res.json(saved);
    }),
  );

  r.put(
    '/:name',
    handle(async (req, res) => {
      const name = circuitName(req.params.name);
      let circuit;
      try {
        circuit = validateCircuit(req.body?.circuit);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const saved = await store.put(name, circuit);
      if (!saved) throw new HttpError(409, `Storage is full (${MAX_SAVED} circuits). Delete one first.`);
      res.json(saved);
    }),
  );

  r.delete(
    '/:name',
    handle(async (req, res) => {
      if (!(await store.delete(circuitName(req.params.name)))) throw new HttpError(404, 'No saved circuit with that name.');
      res.status(204).end();
    }),
  );

  return r;
}
