// Client for the Ohmlab backend (/api). In dev, Vite proxies /api to the backend.

import type { Circuit } from '@ohmlab/shared/model/types';

export interface SavedSummary {
  name: string;
  parts: number;
  savedAt: number;
}

export interface SavedCircuit {
  circuit: Circuit;
  savedAt: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
    throw new Error('Cannot reach the Ohmlab server. Is the backend running?');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Server error ${res.status}.`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  listCircuits: () => request<SavedSummary[]>('/circuits'),
  getCircuit: (name: string) => request<SavedCircuit>(`/circuits/${enc(name)}`),
  saveCircuit: (name: string, circuit: Circuit) =>
    request<SavedCircuit>(`/circuits/${enc(name)}`, { method: 'PUT', body: JSON.stringify({ circuit }) }),
  deleteCircuit: (name: string) => request<void>(`/circuits/${enc(name)}`, { method: 'DELETE' }),
  tutorStatus: () => request<{ enabled: boolean; model: string }>('/tutor'),
};

// ------------------------------------------------------------------ tutor stream

/** A conversation turn as the API sees it; assistant content is echoed back unchanged. */
export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface TutorHandlers {
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

/** Stream one tutor reply. Resolves with the assistant's full content blocks to append to the history. */
export async function streamTutor(messages: TutorMessage[], h: TutorHandlers): Promise<{ content: unknown[]; stopReason: string | null }> {
  let res: Response;
  try {
    res = await fetch('/api/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: h.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Cannot reach the Ohmlab server. Is the backend running?');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Server error ${res.status}.`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || data === undefined) continue;
      const payload = JSON.parse(data);
      if (event === 'text') h.onText(payload.text);
      else if (event === 'done') return payload;
      else if (event === 'error') throw new Error(payload.message);
    }
  }
  throw new Error('The tutor stream ended unexpectedly.');
}
