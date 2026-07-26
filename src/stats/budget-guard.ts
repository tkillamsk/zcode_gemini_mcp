import { HOURLY_BUDGET_WINDOW_MS } from '../constants';

interface HourlyBucket {
  count: number;
  resetAt: number;
}

export class BudgetGuard {
  private buckets = new Map<string, HourlyBucket>();

  // ── Check ──

  check(accountId: string, limit: number | null): boolean {
    if (limit === null) return true;
    const bucket = this.buckets.get(accountId);
    if (!bucket || Date.now() >= bucket.resetAt) {
      return true; // window expired or first request
    }
    return bucket.count < limit;
  }

  // ── Increment ──

  increment(accountId: string): void {
    const now = Date.now();
    const existing = this.buckets.get(accountId);

    if (!existing || now >= existing.resetAt) {
      this.buckets.set(accountId, {
        count: 1,
        resetAt: now + HOURLY_BUDGET_WINDOW_MS,
      });
    } else {
      existing.count++;
    }
  }

  // ── Query ──

  getCount(accountId: string): number {
    const bucket = this.buckets.get(accountId);
    if (!bucket || Date.now() >= bucket.resetAt) return 0;
    return bucket.count;
  }

  getResetTime(accountId: string): number | null {
    const bucket = this.buckets.get(accountId);
    if (!bucket || Date.now() >= bucket.resetAt) return null;
    return bucket.resetAt;
  }
}
