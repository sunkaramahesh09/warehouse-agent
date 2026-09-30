export type Role = 'operator' | 'reviewer';

let role: Role = (() => {
  try { return (localStorage.getItem('role') as Role) || 'operator'; } catch { return 'operator'; }
})();
export const getRole = () => role;
export const setRole = (r: Role) => { role = r; try { localStorage.setItem('role', r); } catch { /* ignore */ } };

const listeners = new Set<() => void>();
export const onDataChanged = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const notifyChanged = () => listeners.forEach((f) => f());

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.error?.message ?? body?.message ?? `HTTP ${status}`); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-role': role, 'x-actor': role === 'operator' ? 'operator (demo)' : 'reviewer (demo)' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: async <T = any>(p: string, body: unknown = {}) => {
    try { return await req<T>('POST', p, body); } finally { notifyChanged(); }
  },
};
