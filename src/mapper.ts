/* ------------------------------------------------------------------ */
/*  mapper.ts – OpenAI ⇆ Gemini (with reasoning, 1M ctx, tool call)  */
/* ------------------------------------------------------------------ */
import { fetchAndEncode } from './remoteimage';
import { getModel } from './chatwrapper';

/* ------------------------------------------------------------------ */
type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: string; parts: GeminiPart[] };

type GeminiTool = Array<{
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
let callIdCounter = 0;
function newCallId(): string {
  return `call_${Date.now()}_${++callIdCounter}`;
}

/* ------------------------------------------------------------------ */
/*  Convert OpenAI JSON Schema → Gemini JSON Schema                    */
/*  Gemini uses https://json-schema.org/draft/2020-12 but accepts     */
/*  the subset that OpenAI sends (type, properties, required, etc.)    */
/* ------------------------------------------------------------------ */
function convertParameters(params: any): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = { type: params.type ?? 'object' };
  if (params.properties) out.properties = params.properties;
  if (params.required) out.required = params.required;
  if (params.items) out.items = params.items;
  if (params.description) out.description = params.description;
  if (params.enum) out.enum = params.enum;
  return out;
}

/* ================================================================== */
/*  Request mapper: OpenAI ➞ Gemini                                    */
/* ================================================================== */
export async function mapRequest(body: any) {
  const contents: GeminiContent[] = [];
  let geminiTools: GeminiTool | undefined;

  /* ---- build contents from messages ----------------------------- */
  let currentUserParts: GeminiPart[] = [];
  let lastRole: string | null = null;

  const flushUser = () => {
    if (currentUserParts.length > 0) {
      contents.push({ role: 'user', parts: currentUserParts });
      currentUserParts = [];
    }
  };

  for (const m of body.messages) {
    /* ---- tool result (OpenAI role=tool) → Gemini functionResponse */
    if (m.role === 'tool' && m.tool_call_id) {
      // The functionResponse must be in a 'user' turn (Gemini requires it).
      // If the previous content was 'model', we can append to user parts.
      // If not, we need a new user turn.
      const respContent = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);

      // Find the matching functionCall name from the last model turn
      const funcName = extractToolNameFromLastModel(contents, m.tool_call_id);

      currentUserParts.push({
        functionResponse: {
          name: funcName ?? 'unknown',
          response: { result: respContent },
        },
      });
      lastRole = 'user';
      continue;
    }

    /* ---- assistant with tool_calls → Gemini functionCall parts --- */
    if (m.role === 'assistant' && m.tool_calls?.length) {
      flushUser();
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments,
          },
        });
      }
      contents.push({ role: 'model', parts });
      lastRole = 'model';
      continue;
    }

    /* ---- normal user / system / assistant ------------------------ */
    const geminiRole = m.role === 'system' ? 'user' : m.role;

    // Gemini needs alternating user/model. If same role twice, flush.
    if (geminiRole === lastRole) flushUser();

    if (Array.isArray(m.content)) {
      for (const item of m.content) {
        if (item.type === 'image_url') {
          currentUserParts.push({ inlineData: await fetchAndEncode(item.image_url.url) });
        } else if (item.type === 'text') {
          currentUserParts.push({ text: item.text });
        }
      }
    } else if (m.content) {
      currentUserParts.push({ text: String(m.content) });
    }

    lastRole = geminiRole;
  }
  flushUser();

  /* ---- convert OpenAI tools → Gemini functionDeclarations ------- */
  const openaiTools = body.tools ?? body.functions ?? [];
  if (openaiTools.length > 0) {
    const decls = openaiTools.map((t: any) => {
      const fn = t.function ?? t; // tools[].function or bare functions[]
      return {
        name: fn.name,
        description: fn.description ?? '',
        parameters: convertParameters(fn.parameters),
      };
    });
    geminiTools = [{ functionDeclarations: decls }];
  }

  /* ---- generationConfig ----------------------------------------- */
  const generationConfig: Record<string, unknown> = {
    temperature: body.temperature,
    maxOutputTokens: body.max_tokens,
    topP: body.top_p,
    ...(body.generationConfig ?? {}),
  };
  if (body.include_reasoning === true) {
    generationConfig.enable_thoughts = true;
    generationConfig.thinking_budget ??= 2048;
  }
  if (body.include_reasoning === true && generationConfig.thinking !== true) {
    generationConfig.thinking = true;
    generationConfig.thinking_budget ??= 2048;
  }
  generationConfig.maxInputTokens ??= 1_000_000;

  const geminiReq: Record<string, unknown> = {
    contents,
    generationConfig,
    stream: body.stream,
  };
  if (geminiTools) geminiReq.tools = geminiTools;

  console.log('Gemini request (with tools):', JSON.stringify(geminiReq, null, 2).slice(0, 2000));

  return { geminiReq, tools: geminiTools };
}

/* ------------------------------------------------------------------ */
/*  Helper: find function name for a tool_call_id from last model turn*/
/* ------------------------------------------------------------------ */
function extractToolNameFromLastModel(
  contents: GeminiContent[],
  toolCallId: string,
): string | null {
  // Walk backwards to find the model turn that produced this tool_call
  // Since we don't store the mapping, return the first functionCall name
  // from the last model turn (good enough for single-tool-call scenarios)
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === 'model') {
      for (const p of contents[i].parts) {
        if ('functionCall' in p) return p.functionCall.name;
      }
    }
  }
  return null;
}

/* ================================================================== */
/*  Non-stream response: Gemini ➞ OpenAI                                */
/* ================================================================== */
export function mapResponse(gResp: any) {
  const usage = gResp.usageMetadata ?? {};
  const hasError = typeof gResp.candidates === 'undefined';

  console.log('Received response:', JSON.stringify(gResp, null, 2).slice(0, 2000));

  if (hasError) {
    console.error('No candidates returned.');
    return {
      error: {
        message: gResp?.promptFeedback?.blockReason ?? 'No candidates returned.',
      },
    };
  }

  const candidate = gResp.candidates?.[0];
  const parts: GeminiPart[] = candidate?.content?.parts ?? [];

  /* ---- check for functionCall parts ------------------------------ */
  const functionCalls: Array<{
    name: string;
    args: Record<string, unknown>;
  }> = [];
  const textParts: string[] = [];

  for (const p of parts) {
    if ('functionCall' in p && p.functionCall) {
      functionCalls.push(p.functionCall);
    } else if ('text' in p && p.text) {
      textParts.push(p.text);
    }
  }

  /* ---- build OpenAI message -------------------------------------- */
  const message: any = { role: 'assistant' };
  const finishReason = candidate?.finishReason;

  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map((fc) => ({
      id: newCallId(),
      type: 'function',
      function: {
        name: fc.name,
        arguments: JSON.stringify(fc.args),
      },
    }));
    // Include any text alongside tool_calls
    if (textParts.length > 0) message.content = textParts.join('');
  } else {
    message.content = textParts.join('') || null;
  }

  // Map Gemini finishReason to OpenAI
  const oaiFinishReason =
    finishReason === 'STOP' ? 'stop' :
    finishReason === 'SAFETY' ? 'content_filter' :
    'stop';

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: getModel(),
    choices: [
      {
        index: 0,
        message,
        finish_reason: oaiFinishReason,
      },
    ],
    usage: {
      prompt_tokens: usage.promptTokens ?? 0,
      completion_tokens: usage.candidatesTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
    },
  };
}

/* ================================================================== */
/*  Stream chunk mapper: Gemini ➞ OpenAI                               */
/* ================================================================== */

/* We need stateful streaming to accumulate functionCall parts */
export function createStreamMapper() {
  let textBuf = '';
  let fcName = '';
  let fcArgsBuf = '';
  let fcSent = false;
  let toolCallId = '';
  let textFlushed = false;

  function reset() {
    textBuf = '';
    fcName = '';
    fcArgsBuf = '';
    fcSent = false;
    toolCallId = '';
    textFlushed = false;
  }

  function mapChunk(chunk: any): any {
    const part = chunk?.candidates?.[0]?.content?.parts?.[0] ?? {};
    const delta: any = { role: 'assistant' };
    const finishReason = chunk?.candidates?.[0]?.finishReason;

    /* ---- thinking / thought --------------------------------------- */
    if (part.thought === true) {
      delta.content = `\u{1f4ad}${part.text ?? ''}`;
      return { choices: [{ delta, index: 0 }] };
    }

    /* ---- text ---------------------------------------------------- */
    if (typeof part.text === 'string') {
      if (fcSent) {
        // text after function call — new chunk
        reset();
      }
      textBuf += part.text;
      delta.content = part.text;
      return { choices: [{ delta, index: 0 }] };
    }

    /* ---- functionCall (may come in multiple chunks) --------------- */
    if (part.functionCall) {
      if (!fcSent) {
        // Flush any pending text first
        if (textBuf && !textFlushed) {
          textFlushed = true;
          // Text was already sent as individual chunks, no need to re-send
        }
        toolCallId = newCallId();
        fcSent = true;
      }

      if (part.functionCall.name) fcName = part.functionCall.name;
      if (part.functionCall.args) {
        // args can come as partial JSON string or object
        const argsStr = typeof part.functionCall.args === 'string'
          ? part.functionCall.args
          : JSON.stringify(part.functionCall.args);
        fcArgsBuf += argsStr;
      }

      // Send tool_calls delta
      delta.tool_calls = [{
        index: 0,
        id: toolCallId,
        type: 'function',
        function: {
          name: fcName || null,
          arguments: fcArgsBuf,
        },
      }];

      return { choices: [{ delta, index: 0 }] };
    }

    /* ---- finish -------------------------------------------------- */
    if (finishReason) {
      const oaiReason =
        finishReason === 'STOP' ? 'stop' :
        finishReason === 'SAFETY' ? 'content_filter' :
        'stop';
      return { choices: [{ delta: {}, index: 0, finish_reason: oaiReason }] };
    }

    /* ---- empty/unknown -------------------------------------------- */
    return { choices: [{ delta: {}, index: 0 }] };
  }

  return { mapChunk, reset };
}

/* Keep old single-chunk mapper for backwards compat (used by server.ts non-stream) */
export function mapStreamChunk(chunk: any) {
  const mapper = createStreamMapper();
  return mapper.mapChunk(chunk);
}
