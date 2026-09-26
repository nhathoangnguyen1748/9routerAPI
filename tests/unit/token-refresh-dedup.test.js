import { describe, it, expect, beforeEach, vi } from "vitest";
import { dedupRefresh, getDedupCacheSize, clearDedupCache } from "../../open-sse/services/tokenRefresh/dedup.js";

describe("tokenRefresh dedup", () => {
  beforeEach(() => {
    clearDedupCache();
    vi.useRealTimers();
  });

  it("reuses in-flight promise for concurrent requests with same token", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return { token: "new-token" };
    };

    const [r1, r2] = await Promise.all([
      dedupRefresh("test", "tok-1", fn),
      dedupRefresh("test", "tok-1", fn)
    ]);

    expect(callCount).toBe(1);
    expect(r1).toEqual({ token: "new-token" });
    expect(r2).toEqual({ token: "new-token" });
  });

  it("reuses recent result within TTL window", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return { token: `refreshed-${callCount}` };
    };

    const r1 = await dedupRefresh("test", "tok-2", fn);
    const r2 = await dedupRefresh("test", "tok-2", fn);

    expect(callCount).toBe(1);
    expect(r1).toBe(r2);
  });

  it("evicts expired entries after TTL and doesn't leak memory", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return { token: `val-${callCount}` };
    };

    await dedupRefresh("test", "tok-3", fn);
    expect(getDedupCacheSize()).toBe(1);

    // Fast-forward past TTL (10s + 500ms timer)
    vi.advanceTimersByTime(11_000);

    expect(getDedupCacheSize()).toBe(0);
  });

  it("caps cache size under heavy token rotation", async () => {
    const fn = async () => ({ token: "ok" });
    for (let i = 0; i < 550; i++) {
      await dedupRefresh("test", `tok-loop-${i}`, fn);
    }
    // Should be capped at MAX_DEDUP_CACHE_SIZE (500)
    expect(getDedupCacheSize()).toBeLessThanOrEqual(500);
  });
});
