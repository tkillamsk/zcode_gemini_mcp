import os from 'node:os';
import path from 'node:path';

// ── Paths ──

export const CONFIG_DIR = path.join(os.homedir(), '.gemini-multi-auth');
export const POOL_FILE = path.join(CONFIG_DIR, 'pool.json');
export const TOKENS_DIR = path.join(CONFIG_DIR, 'tokens');

// ── File permissions ──

export const SECURE_MODE = 0o600;

// ── Defaults ──

export const COOLDOWN_MS = 60_000; // 1 minute
export const MAX_COOLDOWN_MS = 30 * 60_000; // 30 minutes
export const MAX_CONSECUTIVE_ERRORS = 5;
export const BACKOFF_BASE_MS = 60_000;
