// Saved circuits, persisted as one JSON file. Writes are serialised and atomic
// (write to a temp file, then rename) so a crash never leaves a half-written file.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Circuit } from '@ohmlab/shared/model/types';
import { validateCircuit } from '@ohmlab/shared/model/validate';

export interface SavedCircuit {
  circuit: Circuit;
  savedAt: number;
}

export interface SavedSummary {
  name: string;
  parts: number;
  savedAt: number;
}

export const MAX_NAME_LENGTH = 100;
export const MAX_SAVED = 500;

export class CircuitStore {
  private readonly file: string;
  private cache: Map<string, SavedCircuit> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'circuits.json');
  }

  private async load(): Promise<Map<string, SavedCircuit>> {
    if (this.cache) return this.cache;
    const map = new Map<string, SavedCircuit>();
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, SavedCircuit>;
      for (const [name, v] of Object.entries(raw)) {
        try {
          map.set(name, { circuit: validateCircuit(v.circuit), savedAt: Number(v.savedAt) || 0 });
        } catch {
          console.warn(`Skipping corrupt saved circuit "${name}".`);
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    this.cache = map;
    return map;
  }

  private async persist(map: Map<string, SavedCircuit>) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map), null, 2));
    await rename(tmp, this.file);
  }

  /** Run mutations one at a time so concurrent requests can't lose writes. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<SavedSummary[]> {
    const map = await this.load();
    return [...map]
      .map(([name, v]) => ({ name, parts: v.circuit.components.length, savedAt: v.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async get(name: string): Promise<SavedCircuit | undefined> {
    return (await this.load()).get(name);
  }

  /** Returns null when the store is full and `name` is new. */
  put(name: string, circuit: Circuit): Promise<SavedCircuit | null> {
    return this.exclusive(async () => {
      const map = await this.load();
      if (!map.has(name) && map.size >= MAX_SAVED) return null;
      const entry = { circuit: { ...circuit, name }, savedAt: Date.now() };
      const next = new Map(map).set(name, entry);
      await this.persist(next);
      this.cache = next;
      return entry;
    });
  }

  delete(name: string): Promise<boolean> {
    return this.exclusive(async () => {
      const map = await this.load();
      if (!map.has(name)) return false;
      const next = new Map(map);
      next.delete(name);
      await this.persist(next);
      this.cache = next;
      return true;
    });
  }
}
