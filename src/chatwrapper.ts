// src/chatwrapper.ts – Use CodeAssistServer directly (bypasses ContentGenerator tool interception)
import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import { CodeAssistServer } from '@google/gemini-cli-core/dist/src/code_assist/server.js';
import { AccountPool } from './core/account-pool';
import { Rotation } from './core/rotation';
import { PoolEmptyError } from './types';

const modelEnv = process.env.MODEL;
console.log('Auth: CodeAssistServer (direct, no tool interception)');
if (modelEnv) console.log('Model override: ' + modelEnv);

let modelName: string = modelEnv ?? '';

// ── Multi-account setup ──
const pool = new AccountPool();
pool.load();
const rotation = new Rotation(pool);

// Map of accountId → { server, projectId, initPromise }
const servers: Map<string, {
  server: CodeAssistServer;
  projectId: string;
  initPromise: Promise<void> | null;
}> = new Map();

// Legacy single-account fallback
let legacyServer: CodeAssistServer | null = null;
let legacyInitPromise: Promise<void> | null = null;

// ── Initialize server for specific account (OLD API) ──
async function ensureServerForAccount(accountId: string): Promise<CodeAssistServer> {
  const existing = servers.get(accountId);
  if (existing?.server) return existing.server;

  // Start initialization if not already in progress
  if (!existing?.initPromise) {
    servers.set(accountId, { server: null as any, projectId: '', initPromise: null });

    const initPromise = (async () => {
      try {
        const version = process.env.CLI_VERSION || process.version;
        const httpOptions = {
          headers: { 'User-Agent': 'GeminiCLI/' + version + ' (' + process.platform + '; ' + process.arch + ')' },
        };

        // Get account tokens from pool
        const account = pool.get(accountId);
        if (!account) throw new Error(`Account ${accountId} not found`);

        // Use OLD API: getOauthClient() with no arguments
        const authClient = await getOauthClient();

        // Restore tokens if available
        if (account.oauthTokens) {
          authClient.setCredentials({
            access_token: account.oauthTokens.accessToken,
            refresh_token: account.oauthTokens.refreshToken,
            expiry_date: account.oauthTokens.expiresAt,
          });
        }

        // Use OLD API: setupUser(authClient) returns string
        const projectId = await setupUser(authClient);

        // Use OLD API: new CodeAssistServer(authClient, projectId, httpOptions)
        const server = new CodeAssistServer(authClient, projectId, httpOptions);

        // Save updated tokens back to pool
        const creds = authClient.credentials;
        if (creds) {
          pool.save();
        }

        servers.set(accountId, { server, projectId, initPromise: null });

        if (!modelName) modelName = 'gemini-2.5-pro';
        console.log(`Account ${accountId} ready, project=${projectId}, model=${modelName}`);
      } catch (err) {
        servers.delete(accountId);
        throw err;
      }
    })();

    servers.set(accountId, { server: null as any, projectId: '', initPromise });
    await initPromise;
  } else {
    await existing.initPromise;
  }

  return servers.get(accountId)!.server;
}

// ── Legacy single-account init (fallback) ──
async function ensureLegacyInit(): Promise<CodeAssistServer> {
  if (legacyServer) return legacyServer;
  if (legacyInitPromise) { await legacyInitPromise; return legacyServer!; }

  legacyInitPromise = (async () => {
    const version = process.env.CLI_VERSION || process.version;
    const httpOptions = {
      headers: { 'User-Agent': 'GeminiCLI/' + version + ' (' + process.platform + '; ' + process.arch + ')' },
    };
    const authClient = await getOauthClient();
    const projectId = await setupUser(authClient);
    legacyServer = new CodeAssistServer(authClient, projectId, httpOptions);
    if (!modelName) modelName = 'gemini-2.5-pro';
    console.log('Legacy CodeAssistServer ready, project=' + projectId + ', model=' + modelName);
  })();
  await legacyInitPromise;
  return legacyServer!;
}

// ── Get server (with rotation or fallback) ──
async function getServer(): Promise<CodeAssistServer> {
  try {
    // Try to use rotation if pool has accounts
    const accounts = pool.getAll();
    if (accounts.length > 0) {
      const decision = rotation.pickAccount();
      console.log(`Rotation picked account ${decision.accountId} (${decision.reason})`);
      return await ensureServerForAccount(decision.accountId);
    }
  } catch (err) {
    if (err instanceof PoolEmptyError) {
      console.log('Pool empty, falling back to legacy single account');
    } else {
      console.warn('Rotation failed, falling back to legacy:', err);
    }
  }

  // Fallback to legacy single account
  return ensureLegacyInit();
}

type GenConfig = Record<string, unknown>;

export async function sendChat({ contents, generationConfig = {}, tools }: {
  contents: any[]; generationConfig?: GenConfig; tools?: unknown;
}) {
  let server: CodeAssistServer;
  let accountId: string | null = null;

  try {
    const accounts = pool.getAll();
    if (accounts.length > 0) {
      const decision = rotation.pickAccount();
      accountId = decision.accountId;
      server = await ensureServerForAccount(accountId);
    } else {
      server = await ensureLegacyInit();
    }
  } catch (err) {
    if (err instanceof PoolEmptyError) {
      server = await ensureLegacyInit();
    } else {
      throw err;
    }
  }

  const config: Record<string, unknown> = { ...generationConfig };
  if (tools) config.tools = tools;

  try {
    const result = await server!.generateContent({
      model: modelName, contents, config,
    });

    // Record success if using rotation
    if (accountId) {
      rotation.recordSuccess(accountId);
    }

    return result as any;
  } catch (err: any) {
    // Record error and try retry with different account
    if (accountId && isRetryableError(err)) {
      console.log(`Error on account ${accountId}, retrying with different account...`);
      rotation.recordError(accountId, {
        httpStatus: err.httpStatus ?? err.status ?? 0,
        message: err.message,
      });

      try {
        const decision = rotation.pickAccount();
        const retryServer = await ensureServerForAccount(decision.accountId);
        const retryResult = await retryServer.generateContent({
          model: modelName, contents, config,
        });
        rotation.recordSuccess(decision.accountId);
        return retryResult as any;
      } catch (retryErr) {
        throw err; // Return original error
      }
    }

    throw err;
  }
}

export async function* sendChatStream({ contents, generationConfig = {}, tools }: {
  contents: any[]; generationConfig?: GenConfig; tools?: unknown;
}) {
  let server: CodeAssistServer;
  let accountId: string | null = null;

  try {
    const accounts = pool.getAll();
    if (accounts.length > 0) {
      const decision = rotation.pickAccount();
      accountId = decision.accountId;
      server = await ensureServerForAccount(accountId);
    } else {
      server = await ensureLegacyInit();
    }
  } catch (err) {
    if (err instanceof PoolEmptyError) {
      server = await ensureLegacyInit();
    } else {
      throw err;
    }
  }

  const config: Record<string, unknown> = { ...generationConfig };
  if (tools) config.tools = tools;

  try {
    const stream = await server!.generateContentStream({
      model: modelName, contents, config,
    });

    // Record success if using rotation
    if (accountId) {
      rotation.recordSuccess(accountId);
    }

    for await (const chunk of stream) {
      yield chunk as any;
    }
  } catch (err: any) {
    // Record error and try retry with different account
    if (accountId && isRetryableError(err)) {
      console.log(`Stream error on account ${accountId}, retrying with different account...`);
      rotation.recordError(accountId, {
        httpStatus: err.httpStatus ?? err.status ?? 0,
        message: err.message,
      });

      try {
        const decision = rotation.pickAccount();
        const retryServer = await ensureServerForAccount(decision.accountId);
        const retryStream = await retryServer.generateContentStream({
          model: modelName, contents, config,
        });
        rotation.recordSuccess(decision.accountId);
        for await (const chunk of retryStream) {
          yield chunk as any;
        }
        return;
      } catch (retryErr) {
        throw err; // Return original error
      }
    }

    throw err;
  }
}

// ── Helper: check if error is retryable ──
function isRetryableError(err: any): boolean {
  const status = err.httpStatus ?? err.status ?? 0;
  return status === 429 || status === 401 || status === 403;
}

// ── Exports for CLI and pool access ──
export function getPool(): AccountPool {
  return pool;
}

export function getRotation(): Rotation {
  return rotation;
}

export function listModels() {
  return [{ id: modelName || 'gemini-2.5-pro', object: 'model', owned_by: 'google' }];
}

export function getModel() { return modelName; }
