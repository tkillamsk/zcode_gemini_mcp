// ── Account & Pool ──

export interface AccountRecord {
  id: string;
  label: string;
  email: string;
  oauthTokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // unix ms
  };
  projectId: string | null;
  createdAt: number;
  lastHealthCheck: number | null;
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'dead';
  cooldownUntil: number | null; // unix ms, after 429/403
  consecutiveErrors: number;
  tags: string[];
}

export interface AccountPool {
  version: 2;
  accounts: AccountRecord[];
  activeId: string | null;
  lastRotation: number;
}

// ── Rotation ──

export interface RotationDecision {
  accountId: string;
  reason: string;
  degraded: boolean;
  fallback: boolean;
}

export interface RotationOptions {
  strategy: 'round-robin' | 'least-recently-used' | 'lowest-error-rate';
  cooldownMs: number;
  maxConsecutiveErrors: number;
  healthCheckIntervalMs: number;
  budgetLimit: number | null;
}

// ── Errors ──

export class PoolEmptyError extends Error {
  constructor() {
    super('Account pool is empty — run `gemini-multi-auth login` to add an account');
    this.name = 'PoolEmptyError';
  }
}

export class AccountExhaustedError extends Error {
  public readonly accountId: string;

  constructor(accountId: string) {
    super(`Account ${accountId} is exhausted — tokens invalid, re-login required`);
    this.name = 'AccountExhaustedError';
    this.accountId = accountId;
  }
}
