import { useCallback, useEffect, useRef, useState } from 'react';
import { api, onDataChanged } from './api';

/** Fetch a GET endpoint; refetches whenever any mutation completes anywhere in the app. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the most recent request may update state. Fixes a race where a slower response for a
  // previous path (e.g. superseded plan v2) overwrote the newer one (plan v3) after a replan.
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++latest.current;
    setLoading(true);
    try { const d = await api.get<T>(path); if (id === latest.current) { setData(d); setError(null); } }
    catch (e) { if (id === latest.current) setError((e as Error).message); }
    finally { if (id === latest.current) setLoading(false); }
  }, [path]);
  useEffect(() => { load(); return onDataChanged(() => { load(); }); }, [load]);
  return { data, error, loading, reload: load };
}

/** Wrap an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key); setError(null);
    try { return await fn(); }
    catch (e: any) { setError(e?.body?.error ? `${e.body.error.code}: ${e.body.error.message}` : e?.body?.message ?? e.message); return undefined; }
    finally { setBusy(null); }
  }, []);
  return { busy, error, run, setError };
}
