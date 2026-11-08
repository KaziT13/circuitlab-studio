import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error with an HTTP status whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Express 4 does not catch rejected promises; forward them to the error handler. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // body-parser errors (malformed JSON, payload too large) carry a status
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500)
    return res.status(status).json({ error: (err as Error).message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
}

export function num(v: unknown, name: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `"${name}" must be a finite number.`);
  if (opts.integer && !Number.isInteger(v)) throw new HttpError(400, `"${name}" must be an integer.`);
  if (opts.min !== undefined && v < opts.min) throw new HttpError(400, `"${name}" must be at least ${opts.min}.`);
  if (opts.max !== undefined && v > opts.max) throw new HttpError(400, `"${name}" must be at most ${opts.max}.`);
  return v;
}

export function strings(v: unknown, name: string, max = 100): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new HttpError(400, `"${name}" must be an array of strings.`);
  if (v.length > max) throw new HttpError(400, `"${name}" may hold at most ${max} entries.`);
  return v;
}

/** Fixed-window in-memory rate limiter keyed by client IP. */
export function rateLimit(limit: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }
    if (++h.count > limit) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    }
    next();
  };
}
