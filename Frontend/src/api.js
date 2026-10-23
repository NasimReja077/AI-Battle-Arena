// All calls to the backend live here so components never build URLs or parse streams themselves.

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message ?? `Request failed (${status})`);
    this.status = status;
    // Validation messages from the server (one per problem), if any
    this.details = Array.isArray(data?.errors) ? data.errors : [];
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const getHealth = () => request('/health');
export const getModels = () => request('/models');

export const listBattles = ({ before, limit = 20 } = {}) =>
  request(`/battles?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
export const getBattle = (id) => request(`/battles/${encodeURIComponent(id)}`);
export const deleteBattle = (id) => request(`/battles/${encodeURIComponent(id)}`, json('DELETE'));

export const shareBattle = (id) => request(`/battles/${encodeURIComponent(id)}/share`, json('POST'));
export const unshareBattle = (id) => request(`/battles/${encodeURIComponent(id)}/share`, json('DELETE'));
export const getShared = (shareId) => request(`/shared/${encodeURIComponent(shareId)}`);

// A plain link: the server sends it as a file download
export const exportUrl = (id) => `${API_BASE}/battles/${encodeURIComponent(id)}/export.md`;

// Run a battle and receive Server-Sent Events as they happen.
// onEvents gets an array of parsed events each time a chunk of the stream arrives.
export async function streamBattle({ body, signal, onEvents }) {
  const res = await fetch(`${API_BASE}/battle/stream`, { ...json('POST', body), signal });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    const events = [];
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      try {
        events.push(JSON.parse(part.slice(6)));
      } catch {
        // Ignore a malformed event rather than losing the whole battle
      }
    }
    if (events.length > 0) {
      if (events.some((e) => e.type === 'result' || e.type === 'error')) finished = true;
      onEvents(events);
    }
  }

  if (!finished) {
    throw new Error('The connection closed before the battle finished.');
  }
}
