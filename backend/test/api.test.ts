import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '@ohmlab/shared/model/examples';
import { createApp } from '../src/app';

let server: Server;
let base = '';
let dataDir = '';

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'ohmlab-test-'));
  server = createApp({ dataDir, anthropic: null }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dataDir, { recursive: true, force: true });
});

const post = (p: string, body: unknown) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();

describe('health', () => {
  it('responds', async () => {
    expect(await json(fetch(`${base}/health`))).toEqual({ ok: true });
  });
  it('unknown API routes are JSON 404s', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBeTruthy();
  });
});

describe('circuits', () => {
  it('saves, lists, loads and deletes', async () => {
    const circuit = example('divider');
    const name = 'My divider / v2';
    const put = await fetch(`${base}/circuits/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circuit }),
    });
    expect(put.status).toBe(200);

    const list = await json(fetch(`${base}/circuits`));
    expect(list).toEqual([expect.objectContaining({ name, parts: circuit.components.length })]);

    const got = await json(fetch(`${base}/circuits/${encodeURIComponent(name)}`));
    expect(got.circuit.name).toBe(name);
    expect(got.circuit.components).toHaveLength(circuit.components.length);

    // persisted to disk
    const file = JSON.parse(await readFile(path.join(dataDir, 'circuits.json'), 'utf8'));
    expect(Object.keys(file)).toEqual([name]);

    expect((await fetch(`${base}/circuits/${encodeURIComponent(name)}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/circuits/${encodeURIComponent(name)}`)).status).toBe(404);
  });

  it('rejects invalid circuits', async () => {
    const bad = [
      { components: 'x', wires: [] },
      { components: [{ type: 'constructor', x: 0, y: 0 }], wires: [] },
      { components: [{ type: 'resistor', x: 0, y: 0, props: { resistance: { evil: 1 } } }], wires: [] },
      { components: [], wires: [{ points: [{ x: 'a', y: 0 }] }] },
    ];
    for (const circuit of bad) {
      const res = await fetch(`${base}/circuits/bad`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${base}/circuits/x`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(res.status).toBe(400);
  });
});

describe('simulation', () => {
  it('DC operating point of the voltage divider', async () => {
    const circuit = example('divider');
    const res = await post('/simulate/dc', { circuit });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    // every resistor's reading obeys Ohm's law
    for (const c of circuit.components.filter((k) => k.type === 'resistor')) {
      const r = body.readings[c.id];
      expect(r.v / r.i).toBeCloseTo(Number(c.props.resistance), 3);
    }
  });

  it('transient RC charging approaches the source voltage', async () => {
    const circuit = example('rc');
    const res = await post('/simulate/transient', { circuit, tStop: 0.05, h: 1e-5 });
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.t.length).toBeLessThanOrEqual(2001);
    expect(body.t.at(-1)).toBeCloseTo(0.05, 6);
    expect(body.nodeV[0].length).toBe(body.netNames.length);
  });

  it('caps transient step count', async () => {
    const res = await post('/simulate/transient', { circuit: example('rc'), tStop: 10, h: 1e-6 });
    expect(res.status).toBe(400);
  });

  it('AC sweep returns one value per frequency', async () => {
    const circuit = example('rlc');
    const r = circuit.components.find((k) => k.type === 'resistor')!;
    const body = await json(post('/simulate/ac', { circuit, f0: 10, f1: 1e5, points: 50, probes: [`i:${r.id}`] }));
    expect(body.ok).toBe(true);
    expect(body.f).toHaveLength(50);
    expect(body.data[`i:${r.id}`].mag).toHaveLength(50);
  });

  it('SPICE export then import gives a circuit that still solves', async () => {
    const text = await (await post('/spice/export', { circuit: example('series') })).text();
    expect(text).toContain('.end');
    const back = await json(post('/spice/import', { text }));
    expect(back.circuit.components.length).toBeGreaterThan(0);
    const dc = await json(post('/simulate/dc', { circuit: back.circuit }));
    expect(dc.ok).toBe(true);
  });

  it('rejects an empty SPICE netlist', async () => {
    expect((await post('/spice/import', { text: '   ' })).status).toBe(400);
  });
});

describe('tutor', () => {
  it('reports disabled without credentials', async () => {
    expect(await json(fetch(`${base}/tutor`))).toMatchObject({ enabled: false });
    const res = await post('/tutor', { messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(503);
  });
});

describe('tutor streaming', () => {
  it('streams text events then a done event with the full content', async () => {
    const content = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Hello there' }];
    let sent: { model?: string; messages?: unknown[] } = {};
    const fake = {
      beta: {
        messages: {
          stream(params: typeof sent) {
            sent = params;
            const handlers: ((t: string) => void)[] = [];
            return {
              on: (_e: string, fn: (t: string) => void) => handlers.push(fn),
              abort: () => {},
              finalMessage: async () => {
                for (const t of ['Hello', ' there']) handlers.forEach((h) => h(t));
                return { content, stop_reason: 'end_turn' };
              },
            };
          },
        },
      },
    };
    const srv = createApp({ dataDir, anthropic: fake as never }).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/tutor`;
      const messages = [{ role: 'user', content: 'Why?' }];
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const body = await res.text();
      expect(body).toBe(
        'event: text\ndata: {"text":"Hello"}\n\n' +
          'event: text\ndata: {"text":" there"}\n\n' +
          `event: done\ndata: ${JSON.stringify({ content, stopReason: 'end_turn' })}\n\n`,
      );
      expect(sent.model).toBe('claude-opus-5-5');
      expect(sent.messages).toEqual(messages);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it('rejects malformed conversations', async () => {
    const srv = createApp({ dataDir, anthropic: {} as never }).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/tutor`;
      for (const messages of [[], [{ role: 'assistant', content: 'x' }], [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]]) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
        expect(res.status).toBe(400);
      }
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});
