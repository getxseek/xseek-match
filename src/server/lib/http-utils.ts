import type { IncomingMessage, ServerResponse } from 'node:http';

export function setJsonNoStoreHeaders(res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setJsonNoStoreHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function isSameOriginRequest(
  req: IncomingMessage,
  env: Record<string, string | undefined>,
): boolean {
  if (!req.headers.origin) return true;
  const expectedOrigin = env.APP_ORIGIN || `http://${req.headers.host}`;
  return req.headers.origin === expectedOrigin;
}

export async function readJsonObjectBody(
  req: IncomingMessage,
  maxBytes: number,
  options: {
    requireJsonContentType?: boolean;
    tooLargeMessage?: string;
    invalidJsonMessage?: string;
    invalidObjectMessage?: string;
  } = {},
): Promise<Record<string, unknown>> {
  if (
    options.requireJsonContentType &&
    !req.headers['content-type']?.startsWith('application/json')
  ) {
    throw new Error('Expected JSON');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(options.tooLargeMessage ?? 'Request too large.');
    }
    chunks.push(buffer);
  }

  const rawText = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(options.invalidJsonMessage ?? 'Invalid JSON request.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(options.invalidObjectMessage ?? 'Invalid request.');
  }

  return parsed as Record<string, unknown>;
}
