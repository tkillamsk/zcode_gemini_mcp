import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { POOL_FILE, TOKENS_DIR, CONFIG_DIR, SECURE_MODE } from '../constants';
import type { AccountRecord, AccountPool as PoolData } from '../types';

const DEFAULT_POOL: PoolData = {
  version: 2,
  accounts: [],
  activeId: null,
  lastRotation: 0,
};

export class AccountPool {
  private data: PoolData = { ...DEFAULT_POOL };

  // ── Persistence ──

  load(): void {
    try {
      const raw = fs.readFileSync(POOL_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PoolData;
      if (parsed.version === 2 && Array.isArray(parsed.accounts)) {
        this.data = parsed;
      }
    } catch {
      this.data = { ...DEFAULT_POOL };
    }
  }

  save(): void {
    this.ensureDir(CONFIG_DIR);
    this.ensureDir(TOKENS_DIR);
    const tmp = POOL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', { mode: SECURE_MODE });
    fs.fsyncSync(fs.openSync(tmp, 'r'));
    fs.renameSync(tmp, POOL_FILE);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  // ── CRUD ──

  add(record: Omit<AccountRecord, 'id' | 'createdAt' | 'lastHealthCheck' | 'healthStatus' | 'cooldownUntil' | 'consecutiveErrors'>): AccountRecord {
    const account: AccountRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      lastHealthCheck: null,
      healthStatus: 'unknown',
      cooldownUntil: null,
      consecutiveErrors: 0,
    };
    this.data.accounts.push(account);
    this.save();
    this.saveTokenFile(account);
    return account;
  }

  get(id: string): AccountRecord | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  getAll(): AccountRecord[] {
    return [...this.data.accounts];
  }

  remove(id: string): boolean {
    const idx = this.data.accounts.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.data.accounts.splice(idx, 1);
    if (this.data.activeId === id) this.data.activeId = null;
    this.removeTokenFile(id);
    this.save();
    return true;
  }

  // ── Health & cooldown ──

  updateHealth(id: string, status: AccountRecord['healthStatus']): void {
    const acc = this.get(id);
    if (!acc) return;
    acc.healthStatus = status;
    acc.lastHealthCheck = Date.now();
    this.save();
  }

  setCooldown(id: string, until: number | null): void {
    const acc = this.get(id);
    if (!acc) return;
    acc.cooldownUntil = until;
    this.save();
  }

  markDead(id: string): void {
    this.updateHealth(id, 'dead');
  }

  // ── Active / pin ──

  setActive(id: string | null): void {
    this.data.activeId = id;
    this.save();
  }

  getActive(): string | null {
    return this.data.activeId;
  }

  clearActive(): void {
    this.data.activeId = null;
    this.save();
  }

  // ── Error tracking ──

  incrementErrors(id: string): number {
    const acc = this.get(id);
    if (!acc) return 0;
    acc.consecutiveErrors++;
    this.save();
    return acc.consecutiveErrors;
  }

  resetErrors(id: string): void {
    const acc = this.get(id);
    if (!acc) return;
    acc.consecutiveErrors = 0;
    this.save();
  }

  // ── Token files ──

  private saveTokenFile(account: AccountRecord): void {
    this.ensureDir(TOKENS_DIR);
    const tokenPath = path.join(TOKENS_DIR, `${account.id}.json`);
    fs.writeFileSync(tokenPath, JSON.stringify(account.oauthTokens, null, 2) + '\n', { mode: SECURE_MODE });
  }

  private removeTokenFile(id: string): void {
    const tokenPath = path.join(TOKENS_DIR, `${id}.json`);
    try {
      fs.unlinkSync(tokenPath);
    } catch { /* ignore */ }
  }

  // ── Last rotation ──

  setLastRotation(ts: number): void {
    this.data.lastRotation = ts;
    this.save();
  }

  getLastRotation(): number {
    return this.data.lastRotation;
  }
}
