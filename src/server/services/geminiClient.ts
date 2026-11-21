import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';

const cachedClients = new Map<string, GoogleGenAI>();

export function getGeminiClient(apiVersion?: 'v1' | 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in server secrets. Please configure it in Settings > Secrets.'
    );
  }
  const cacheKey = `${apiVersion || 'default'}:${apiKey}`;
  const existing = cachedClients.get(cacheKey);
  if (existing) {
    return existing;
  }
  const client = new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedClients.set(cacheKey, client);
  return client;
}

export function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const status = (err as any)?.status ?? (err as any)?.code;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit')
  );
}

export function isTransientServerError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const status = (err as any)?.status ?? (err as any)?.code;
  return (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('overloaded')
  );
}

function extractReadableErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.error?.message) return String(parsed.error.message);
      if (parsed?.message) return String(parsed.message);
    } catch {
      // fall through
    }
  }
  const jsonStart = trimmed.indexOf('{"error"');
  if (jsonStart > 0) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart));
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch {
      // fall through
    }
  }
  return trimmed;
}

export function getGeminiErrorStatus(
  err: unknown,
  fallbackMessage: string
): { statusCode: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || '');
  const readable = extractReadableErrorMessage(raw);
  const status = (err as any)?.status ?? (err as any)?.code;

  if (isQuotaOrRateLimitError(err)) {
    return {
      statusCode: 429,
      message:
        'Gemini API quota or rate limit exceeded. Wait a few seconds and retry, or select a billing-enabled API key in Settings > Secrets for higher quota.',
    };
  }
  if (
    status === 403 ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID')
  ) {
    return {
      statusCode: 403,
      message:
        'Gemini API key was rejected or lacks permission. Please verify your API key in Settings > Secrets.',
    };
  }
  if (isTransientServerError(err)) {
    return {
      statusCode: 503,
      message: 'Gemini API is temporarily overloaded. Please retry in a few moments.',
    };
  }
  if (status === 400 || raw.includes('INVALID_ARGUMENT')) {
    return {
      statusCode: 400,
      message: readable ? readable.slice(0, 360) : fallbackMessage,
    };
  }
  return {
    statusCode: 500,
    message: readable ? readable.slice(0, 360) : fallbackMessage,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
        (err as any).status = 504;
        reject(err);
      }, ms);
    }),
  ]);
}

export async function generateContentWithResilience(params: {
  models: string[];
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  apiVersion?: 'v1' | 'v1beta';
  maxRetriesPerModel?: number;
  attemptTimeoutMs?: number;
}): Promise<GenerateContentResponse> {
  const needsBeta =
    params.apiVersion === 'v1beta' ||
    Boolean((params.config as any)?.speechConfig) ||
    Boolean((params.config as any)?.responseModalities) ||
    params.models.some(
      (m) => m.includes('tts') || m.includes('transcribe') || m.includes('preview')
    );
  const ai = getGeminiClient(params.apiVersion ?? (needsBeta ? 'v1beta' : undefined));
  const maxRetries = params.maxRetriesPerModel ?? 1;
  const attemptTimeoutMs = params.attemptTimeoutMs ?? 28000;
  let lastError: unknown;

  for (let mIdx = 0; mIdx < params.models.length; mIdx++) {
    const model = params.models[mIdx];
    const hasNextModel = mIdx < params.models.length - 1;
    // Strip Gemini-4-specific thinkingConfig when falling back to non-Gemini-4 models
    const config =
      params.config && !model.startsWith('gemini-4-') && 'thinkingConfig' in params.config
        ? { ...params.config, thinkingConfig: undefined }
        : params.config;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await withTimeout(
          ai.models.generateContent({
            model,
            contents: params.contents,
            ...(config ? { config } : {}),
          }),
          attemptTimeoutMs,
          `Gemini ${model}`
        );
      } catch (err) {
        lastError = err;
        const isQuota = isQuotaOrRateLimitError(err);
        const isTransient = isTransientServerError(err);
        const isTimeout = (err as any)?.status === 504;

        // If this model hit 429 quota or timed out and we have a fallback model, switch immediately
        if ((isQuota || isTimeout) && hasNextModel) {
          console.warn(
            `Gemini ${model} ${isTimeout ? 'timed out' : 'hit quota/rate limit'}; switching immediately to fallback model ${params.models[mIdx + 1]}.`
          );
          break;
        }

        if (!isQuota && !isTransient && !isTimeout) {
          if (hasNextModel) {
            console.warn(
              `Model ${model} failed, trying fallback model:`,
              (err as Error)?.message?.slice(0, 180)
            );
            break;
          }
          throw err;
        }

        if (attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
          console.warn(
            `Gemini ${model} rate-limited/unavailable (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`
          );
          await sleep(delayMs);
        } else if (hasNextModel) {
          console.warn(
            `Gemini ${model} exhausted retries; switching to fallback model ${params.models[mIdx + 1]}.`
          );
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Gemini request failed'));
}

export function extractJsonFromText<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        // continue
      }
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // continue
      }
    }
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // continue
      }
    }
    return fallback;
  }
}
