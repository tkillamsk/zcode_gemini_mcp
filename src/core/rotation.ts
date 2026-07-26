import type { AccountRecord, RotationDecision, RotationOptions } from '../types';
import { PoolEmptyError } from '../types';
import {
  BACKOFF_BASE_MS,
  MAX_COOLDOWN_MS,
  MAX_CONSECUTIVE_ERRORS,
} from '../constants';
import type { AccountPool } from './account-pool';

export class Rotation {
  constructor(
    private pool: AccountPool,
    private options: RotationOptions = {
      strategy: 'least-recently-used',
      cooldownMs: 60_000,
      maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
      healthCheckIntervalMs: 300_000,
      budgetLimit: null,
    },
  ) {}

  // ── Pick account ──

  pickAccount(): RotationDecision {
    const accounts = this.pool.getAll();
    if (accounts.length === 0) throw new PoolEmptyError();

    const activeId = this.pool.getActive();
    if (activeId) {
      const acc = this.pool.get(activeId);
      if (acc && acc.healthStatus !== 'dead') {
        return { accountId: activeId, reason: 'pinned', degraded: false, fallback: false };
      }
    }

    const available = this.getAvailable();
    if (available.length === 0) {
      // All accounts in cooldown or dead — pick closest-to-ready
      return this.pickClosestToReady(accounts);
    }

    // Score and select
    let best = available[0];
    let bestScore = -Infinity;

    for (const acc of available) {
      const score = this.scoreAccount(acc);
      if (score > bestScore) {
        bestScore = score;
        best = acc;
      }
    }

    this.pool.setLastRotation(Date.now());

    return {
      accountId: best.id,
      reason: 'rotation',
      degraded: best.healthStatus === 'degraded',
      fallback: false,
    };
  }

  // ── Get available accounts ──

  getAvailable(): AccountRecord[] {
    const now = Date.now();
    return this.pool.getAll().filter((acc) => {
      if (acc.healthStatus === 'dead') return false;
      if (acc.cooldownUntil !== null && acc.cooldownUntil > now) return false;
      if (!acc.oauthTokens.refreshToken) return false;
      return true;
    });
  }

  // ── Record error ──

  recordError(accountId: string, error: { httpStatus?: number; message?: string }): void {
    const acc = this.pool.get(accountId);
    if (!acc) return;

    acc.consecutiveErrors++;
    const now = Date.now();

    const httpStatus = error.httpStatus ?? 0;

    if (httpStatus === 429) {
      // Rate limit — exponential backoff
      const cooldown = this.exponentialBackoff(acc.consecutiveErrors);
      acc.cooldownUntil = now + cooldown;
    } else if (httpStatus === 403) {
      // Quota exceeded — long cooldown
      acc.cooldownUntil = now + MAX_COOLDOWN_MS;
      acc.healthStatus = 'degraded';
    } else if (httpStatus === 401) {
      // Auth invalid — dead
      acc.healthStatus = 'dead';
    } else if (httpStatus >= 500) {
      // Server error — don't penalize, just skip next rotation
    }

    if (acc.consecutiveErrors >= this.options.maxConsecutiveErrors) {
      acc.healthStatus = 'dead';
    }

    this.pool.save();
  }

  // ── Record success ──

  recordSuccess(accountId: string): void {
    const acc = this.pool.get(accountId);
    if (!acc) return;
    acc.consecutiveErrors = 0;
    acc.cooldownUntil = null;
    if (acc.healthStatus === 'degraded') {
      acc.healthStatus = 'healthy';
    }
    this.pool.save();
  }

  // ── Scoring ──

  private scoreAccount(acc: AccountRecord): number {
    let score = 0;
    const now = Date.now();

    // Cooldown inverse: less cooldown remaining = better
    if (acc.cooldownUntil === null || acc.cooldownUntil <= now) {
      score += 100;
    } else {
      const remaining = acc.cooldownUntil - now;
      score += Math.max(0, 100 - (remaining / MAX_COOLDOWN_MS) * 100);
    }

    // Error rate inverse: fewer errors = better
    score += 1 / (1 + acc.consecutiveErrors);

    // LRU: less recently used = better
    const lastUsed = this.getLastUsed(acc.id);
    const timeSinceUse = now - lastUsed;
    score += Math.min(timeSinceUse / 60_000, 100); // cap at 100 points for > 100 min

    // Health penalty
    if (acc.healthStatus === 'degraded') score *= 0.5;

    return score;
  }

  private getLastUsed(accountId: string): number {
    const acc = this.pool.get(accountId);
    if (!acc) return 0;
    return acc.lastHealthCheck ?? acc.createdAt;
  }

  // ── Helpers ──

  private pickClosestToReady(accounts: AccountRecord[]): RotationDecision {
    const now = Date.now();
    let closest: AccountRecord | null = null;
    let earliest = Infinity;

    for (const acc of accounts) {
      if (acc.healthStatus === 'dead') continue;
      const readyAt = acc.cooldownUntil ?? now;
      if (readyAt < earliest) {
        earliest = readyAt;
        closest = acc;
      }
    }

    if (!closest) {
      // All dead — pick the one with fewest errors
      closest = accounts.reduce((a, b) =>
        a.consecutiveErrors <= b.consecutiveErrors ? a : b,
      );
    }

    return {
      accountId: closest.id,
      reason: closest.cooldownUntil && closest.cooldownUntil > now
        ? `cooldown until ${new Date(closest.cooldownUntil).toISOString()}`
        : 'fallback',
      degraded: closest.healthStatus === 'degraded',
      fallback: true,
    };
  }

  exponentialBackoff(consecutiveErrors: number): number {
    const exponent = Math.max(0, consecutiveErrors - 1);
    const base = BACKOFF_BASE_MS * Math.pow(2, exponent);
    const capped = Math.min(base, MAX_COOLDOWN_MS);
    // ±10% jitter
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }
}
