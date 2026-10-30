import type { Clock } from "#/packages/time/clock.ts";

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  /** Counts one tool call against the window and says whether it may be answered. */
  take(): RateLimitDecision;
};

export type RateLimiterOptions = {
  /** Most calls answered in one window. */
  limit: number;
  windowSeconds: number;
  clock: Clock;
};

/**
 * A fixed window: it opens with the first call after the previous window ended and closes
 * `windowSeconds` later, and `limit` calls are answered inside it. One limiter serves every caller
 * of the process, because the stateless handler has no client identity and behind the Cloudflare
 * tunnel every connection comes from the same address. Fixed windows allow up to twice the limit
 * across a boundary, which is acceptable for a ceiling that protects the box, not a quota.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windowMilliseconds = options.windowSeconds * 1000;
  let windowOpenedAt: number | undefined;
  let answered = 0;
  return {
    take() {
      const now = options.clock.now().getTime();
      if (windowOpenedAt === undefined || now - windowOpenedAt >= windowMilliseconds) {
        windowOpenedAt = now;
        answered = 0;
      }
      if (answered >= options.limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((windowOpenedAt + windowMilliseconds - now) / 1000) };
      }
      answered += 1;
      return { allowed: true };
    },
  };
}

/** What an agent is told when a call is refused, so it can wait and try again. */
export function rateLimitMessage(limit: number, windowSeconds: number, retryAfterSeconds: number): string {
  return `Rate limit reached: this server answers at most ${limit} tool calls every ${windowSeconds} seconds. Try again in ${retryAfterSeconds} seconds.`;
}
