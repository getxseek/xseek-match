import { lookup } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { XSEEK_USER_AGENT } from '../../version.js';
import { blockedAddress } from '../lib/safe-url.js';

const CONNECT_FAILED_MESSAGE =
  'Could not connect. Check the URL, network access and TLS certificate.';

type PinnedResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  /** Read only for 200 responses; empty otherwise. */
  body: Buffer;
};

type PinnedRequestOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  payload?: string;
  maxBytes: number;
  timeoutMs: number;
};

// Private LAN/Docker addresses are intentional. Every resolved address is checked on every
// request and the socket connects only to a checked one, which also defeats DNS rebinding.
const pinnedDnsLookup = ((
  hostname: string,
  options: { all?: boolean },
  callback: (error: Error | null, address?: unknown, family?: number) => void,
) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) {
      return callback(new Error('Blocked destination'));
    }
    const primary = addresses[0]!;
    if (options.all) callback(null, addresses);
    else callback(null, primary.address, primary.family);
  });
}) as NonNullable<RequestOptions['lookup']>;

/**
 * Sends one request through the pinned, address-checked resolver. Redirects are never
 * followed and connection pooling is disabled so no socket outlives its check.
 */
export function pinnedRequest(url: URL, options: PinnedRequestOptions): Promise<PinnedResponse> {
  // Node skips the custom lookup for IP-literal hosts, so check those here.
  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literalHost) && blockedAddress(literalHost)) {
    return Promise.reject(new Error(CONNECT_FAILED_MESSAGE));
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: options.method ?? 'GET',
        headers: { 'User-Agent': XSEEK_USER_AGENT, ...options.headers },
        lookup: pinnedDnsLookup,
        agent: false,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode !== 200) {
          response.resume();
          resolve({ statusCode, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let tooLarge = false;
        response.on('data', (chunk: Buffer) => {
          if (tooLarge) return;
          totalBytes += chunk.length;
          if (totalBytes <= options.maxBytes) {
            chunks.push(chunk);
            return;
          }
          // Destroying the request does not stop a buffered 'end', so the flag decides.
          tooLarge = true;
          reject(new Error('Response too large'));
          req.destroy();
        });
        response.on('error', () => reject(new Error('Connection interrupted. Please retry.')));
        response.on('end', () => {
          if (tooLarge) return;
          resolve({ statusCode, headers: response.headers, body: Buffer.concat(chunks) });
        });
      },
    );

    const timer = setTimeout(() => req.destroy(new Error('Timed out')), options.timeoutMs);
    req.once('close', () => clearTimeout(timer));
    req.on('error', () => reject(new Error(CONNECT_FAILED_MESSAGE)));
    req.end(options.payload);
  });
}
