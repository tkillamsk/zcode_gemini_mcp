// src/chatwrapper.ts – Use CodeAssistServer directly (bypasses ContentGenerator tool interception)
import { getOauthClient } from '@google/gemini-cli-core/dist/src/code_assist/oauth2.js';
import { setupUser } from '@google/gemini-cli-core/dist/src/code_assist/setup.js';
import { CodeAssistServer } from '@google/gemini-cli-core/dist/src/code_assist/server.js';

const modelEnv = process.env.MODEL;
console.log('Auth: CodeAssistServer (direct, no tool interception)');
if (modelEnv) console.log('Model override: ' + modelEnv);

let modelName: string = modelEnv ?? '';
let serverInstance: CodeAssistServer | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInit() {
  if (serverInstance) return;
  if (initPromise) { await initPromise; return; }
  initPromise = (async () => {
    const version = process.env.CLI_VERSION || process.version;
    const httpOptions = {
      headers: { 'User-Agent': 'GeminiCLI/' + version + ' (' + process.platform + '; ' + process.arch + ')' },
    };
    const authClient = await getOauthClient();
    const projectId = await setupUser(authClient);
    serverInstance = new CodeAssistServer(authClient, projectId, httpOptions);
    if (!modelName) modelName = 'gemini-2.5-pro';
    console.log('CodeAssistServer ready, project=' + projectId + ', model=' + modelName);
  })();
  await initPromise;
}

type GenConfig = Record<string, unknown>;

export async function sendChat({ contents, generationConfig = {}, tools }: {
  contents: any[]; generationConfig?: GenConfig; tools?: unknown;
}) {
  await ensureInit();
  const config: Record<string, unknown> = { ...generationConfig };
  if (tools) config.tools = tools;
  return (await serverInstance!.generateContent({
    model: modelName, contents, config,
  })) as any;
}

export async function* sendChatStream({ contents, generationConfig = {}, tools }: {
  contents: any[]; generationConfig?: GenConfig; tools?: unknown;
}) {
  await ensureInit();
  const config: Record<string, unknown> = { ...generationConfig };
  if (tools) config.tools = tools;
  const stream = await serverInstance!.generateContentStream({
    model: modelName, contents, config,
  });
  for await (const chunk of stream) {
    yield chunk as any;
  }
}

export function listModels() {
  return [{ id: modelName || 'gemini-2.5-pro', object: 'model', owned_by: 'google' }];
}

export function getModel() { return modelName; }
