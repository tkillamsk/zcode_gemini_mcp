import fs from 'node:fs';
import path from 'node:path';
import { LEDGER_FILE, CONFIG_DIR, SECURE_MODE } from '../constants';
import type { LedgerEntry } from '../types';

export class Ledger {
  // ── Record ──

  record(entry: LedgerEntry): void {
    this.ensureFile();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LEDGER_FILE, line, { mode: SECURE_MODE });
  }

  // ── Read since ──

  readSince(windowMs: number, accountId?: string): LedgerEntry[] {
    const cutoff = Date.now() - windowMs;
    const entries: LedgerEntry[] = [];

    try {
      const content = fs.readFileSync(LEDGER_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LedgerEntry;
          if (entry.ts < cutoff) continue;
          if (accountId && entry.aid !== accountId) continue;
          entries.push(entry);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file doesn't exist yet
    }

    return entries;
  }

  // ── Get totals ──

  getTotals(windowMs: number): {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    errors: number;
    errorRate: number;
  } {
    const entries = this.readSince(windowMs);
    const total = entries.length;
    const errors = entries.filter((e) => e.err !== null).length;

    return {
      requests: total,
      tokensIn: entries.reduce((sum, e) => sum + e.tokIn, 0),
      tokensOut: entries.reduce((sum, e) => sum + e.tokOut, 0),
      errors,
      errorRate: total > 0 ? errors / total : 0,
    };
  }

  // ── Helpers ──

  private ensureFile(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(LEDGER_FILE)) {
      fs.writeFileSync(LEDGER_FILE, '', { mode: SECURE_MODE });
    }
  }
}
