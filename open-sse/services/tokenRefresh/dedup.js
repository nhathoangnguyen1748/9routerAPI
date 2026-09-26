const REFRESH_RESULT_TTL_MS = 10_000;
const MAX_DEDUP_CACHE_SIZE = 500;
const refreshDedupCache = new Map();

function sweepExpired(now = Date.now()) {
  for (const [k, v] of refreshDedupCache.entries()) {
    if (v.expiresAt && v.expiresAt <= now) {
      refreshDedupCache.delete(k);
    }
  }
  while (refreshDedupCache.size >= MAX_DEDUP_CACHE_SIZE) {
    const oldestKey = refreshDedupCache.keys().next().value;
    refreshDedupCache.delete(oldestKey);
  }
}

export function getDedupCacheSize() {
  return refreshDedupCache.size;
}

export function clearDedupCache() {
  refreshDedupCache.clear();
}

export async function dedupRefresh(provider, oldToken, fn, log) {
  if (!oldToken) return fn();
  const key = `${provider}:${oldToken}`;

  // Keep cache bounded under high token rotation
  if (refreshDedupCache.size >= MAX_DEDUP_CACHE_SIZE) {
    sweepExpired();
  }

  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise;
    }
    if (hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result;
    }
    refreshDedupCache.delete(key);
  }
  const promise = (async () => {
    try {
      const result = await fn();
      const expiresAt = Date.now() + REFRESH_RESULT_TTL_MS;
      refreshDedupCache.set(key, { result, expiresAt });

      // Automatically evict this entry after TTL expires so it never leaks
      const timer = setTimeout(() => {
        const item = refreshDedupCache.get(key);
        if (item && item.expiresAt && item.expiresAt <= Date.now()) {
          refreshDedupCache.delete(key);
        }
      }, REFRESH_RESULT_TTL_MS + 500);
      timer.unref?.();

      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  return promise;
}
