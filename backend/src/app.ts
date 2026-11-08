import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { errorHandler } from './http';
import { CircuitStore } from './storage';
import { circuitsRouter } from './routes/circuits';
import { simulateRouter } from './routes/simulate';
import { tutorRouter } from './routes/tutor';

export interface AppOptions {
  /** Directory for saved circuits. */
  dataDir: string;
  /** Anthropic client for the tutor; null disables it. */
  anthropic: Anthropic | null;
  /** Built frontend (frontend/dist) to serve at /, if present. */
  staticDir?: string;
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/circuits', circuitsRouter(new CircuitStore(opts.dataDir)));
  api.use(simulateRouter());
  api.use(tutorRouter(opts.anthropic));
  api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  if (opts.staticDir && existsSync(path.join(opts.staticDir, 'index.html'))) {
    const index = path.join(opts.staticDir, 'index.html');
    app.use(express.static(opts.staticDir));
    app.get('*', (_req, res) => res.sendFile(index));
  }

  app.use(errorHandler);
  return app;
}
