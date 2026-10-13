// lib/useCachedFetch.js - tiny stale-while-revalidate cache for GET endpoints.
//
// Why: dashboard / renewals / commissions / agreements each refetch the same
// Airtable-backed lists from scratch on every navigation, so every page
// transition eats the full round trip. This hook renders the last known data
// instantly (from an in-memory map that survives client-side navigation, plus
// sessionStorage so a hard refresh within the session is warm too) and then
// revalidates in the background.
//
// Deliberately not a library: no dedupe windows, no focus revalidation, just
// cache-then-network. Data freshness is guaranteed by the background refetch;
// the cache only affects what shows during the wait.
//
// Usage:
//   const { data, loading, refresh } = useCachedFetch('/api/analyses');
//   `loading` is true ONLY when there is nothing cached to show.

import { useState, useEffect, useCallback, useRef } from 'react';

const memoryCache = new Map();
const STORAGE_PREFIX = 'peolens_cache:';
const MAX_AGE_MS = 10 * 60 * 1000; // sessionStorage entries older than this are ignored

function readStorage(key) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const { at, data } = JSON.parse(raw);
    if (!at || Date.now() - at > MAX_AGE_MS) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

function writeStorage(key, data) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Quota or private mode — memory cache still works.
  }
}

// Imperative helpers for pages that manage their own state (dashboard etc.):
// read whatever is cached (memory first, then sessionStorage), or store a
// fresh network result.
export function cacheGet(url) {
  if (memoryCache.has(url)) return memoryCache.get(url);
  const stored = readStorage(url);
  if (stored !== undefined) memoryCache.set(url, stored);
  return stored;
}

export function cacheSet(url, data) {
  memoryCache.set(url, data);
  writeStorage(url, data);
}

export function invalidateCachedFetch(url) {
  memoryCache.delete(url);
  try { sessionStorage.removeItem(STORAGE_PREFIX + url); } catch { /* ignore */ }
}

export function useCachedFetch(url, { enabled = true } = {}) {
  const cached = memoryCache.has(url) ? memoryCache.get(url) : undefined;
  const [data, setData] = useState(cached);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!url || !enabled) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      memoryCache.set(url, json);
      writeStorage(url, json);
      if (mounted.current) {
        setData(json);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err);
        setLoading(false);
      }
    }
  }, [url, enabled]);

  useEffect(() => {
    if (!url || !enabled) return;
    // 1. Serve memory cache (already in initial state) or sessionStorage.
    if (!memoryCache.has(url)) {
      const stored = readStorage(url);
      if (stored !== undefined) {
        memoryCache.set(url, stored);
        setData(stored);
        setLoading(false);
      }
    }
    // 2. Always revalidate in the background.
    load();
  }, [url, enabled, load]);

  return { data, loading, error, refresh: load };
}
