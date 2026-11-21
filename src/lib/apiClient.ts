import { getAuthToken } from './firebase';

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  forceTokenRefresh?: boolean;
}

export async function apiFetch<T = any>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs, signal: externalSignal, forceTokenRefresh: initialForceRefresh, ...fetchOpts } = options;
  const effectiveTimeoutMs =
    typeof timeoutMs === 'number'
      ? timeoutMs
      : url.includes('/api/render/')
      ? 300000
      : 65000;

  const isBinaryBody =
    fetchOpts.body instanceof FormData ||
    fetchOpts.body instanceof Blob ||
    fetchOpts.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(fetchOpts.body);

  const execute = async (forceTokenRefresh = false): Promise<Response> => {
    const token = await getAuthToken(forceTokenRefresh || Boolean(initialForceRefresh));
    const headers = new Headers(fetchOpts.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Firebase-Auth', token);
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    if (!isBinaryBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, effectiveTimeoutMs);

    try {
      return await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        ...fetchOpts,
        headers,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (controller.signal.aborted) {
        if (timedOut) {
          throw new Error(
            `Request timed out after ${Math.round(effectiveTimeoutMs / 1000)}s. Please try again.`
          );
        }
        const cancelErr = new Error('Request cancelled.');
        cancelErr.name = 'AbortError';
        throw cancelErr;
      }
      if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message || '')) {
        throw new Error('Network connection to the CineForge server was interrupted. Please retry.');
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  };

  let resp = await execute(false);
  let contentType = resp.headers.get('content-type') || '';
  let rawText = await resp.text();
  const trimmed = rawText.trimStart();
  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  // Retry once if the preview proxy or dev server returned a transient HTML reload/cookie-check page
  if (looksLikeHtml && !(fetchOpts.body instanceof ReadableStream)) {
    await new Promise((r) => setTimeout(r, 700));
    resp = await execute(true);
    contentType = resp.headers.get('content-type') || '';
    rawText = await resp.text();
  }

  const finalTrimmed = rawText.trimStart();
  const stillHtml =
    contentType.includes('text/html') ||
    finalTrimmed.startsWith('<!doctype') ||
    finalTrimmed.startsWith('<!DOCTYPE') ||
    finalTrimmed.startsWith('<html');

  if (!resp.ok) {
    let msg = `Request failed (${resp.status})`;
    if (!stillHtml && finalTrimmed) {
      try {
        const data = JSON.parse(rawText);
        if (data?.error) msg = String(data.error);
        else if (data?.message) msg = String(data.message);
      } catch {
        // fall back to generic status message
      }
    } else if (stillHtml) {
      msg = `Server returned an unexpected HTML error page (${resp.status}). Please retry in a moment.`;
    }
    throw new Error(msg);
  }

  if (stillHtml || !finalTrimmed) {
    throw new Error(
      'The studio session refreshed or the API server restarted and returned an HTML page instead of JSON. Please reload the preview tab and try again.'
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Received an invalid JSON response from the CineForge server. Please retry.');
  }
}

export async function authedMediaUrl(rawUrl: string | undefined, download = false): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('/src/assets/')) {
    return rawUrl;
  }
  const token = await getAuthToken();
  if (rawUrl.startsWith('/api/')) {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}token=${encodeURIComponent(token)}${download ? '&download=1' : ''}`;
  }
  if (rawUrl.startsWith('https://')) {
    return `/api/proxy/image?url=${encodeURIComponent(rawUrl)}&token=${encodeURIComponent(token)}`;
  }
  return rawUrl;
}

export async function authedVideoProxyUrl(rawUrl: string | undefined): Promise<string> {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }
  const token = await getAuthToken();
  if (rawUrl.startsWith('/api/')) {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}token=${encodeURIComponent(token)}`;
  }
  if (rawUrl.startsWith('https://')) {
    return `/api/media/proxy?url=${encodeURIComponent(rawUrl)}&token=${encodeURIComponent(token)}`;
  }
  return rawUrl;
}

