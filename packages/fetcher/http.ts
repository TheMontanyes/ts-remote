import https from 'node:https';
import http from 'node:http';
import { FetchError, TimeoutError } from '../shared/errors';
import { TlsOptions } from './contract-public';

export type HttpGetResult = {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
};

export type HttpGetOptions = {
  timeout?: number;
  maxRedirects?: number;
  /** TLS options (client cert, custom CA, etc), used only for `https:` URLs. */
  tls?: TlsOptions;
  /** Extra request headers, e.g. `Authorization` for a private host. */
  headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/**
 * Perform an HTTP(S) GET request.
 *
 * Follows redirects (301/302/307/308) up to `maxRedirects`.
 * Enforces a timeout on the entire request lifecycle.
 */
export function httpGet(url: string, options: HttpGetOptions = {}): Promise<HttpGetResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return doRequest(url, timeout, maxRedirects, options.tls, options.headers);
}

function doRequest(
  url: string,
  timeout: number,
  remainingRedirects: number,
  tls?: TlsOptions,
  headers?: Record<string, string>,
): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new FetchError(url, undefined, 'Invalid URL'));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';

    const onResponse = (res: http.IncomingMessage): void => {
      const statusCode = res.statusCode ?? 0;

      // Handle redirects
      if (REDIRECT_CODES.has(statusCode)) {
        const location = res.headers.location;

        if (!location) {
          reject(new FetchError(url, statusCode, 'Redirect without Location header'));
          return;
        }

        if (remainingRedirects <= 0) {
          reject(new FetchError(url, statusCode, 'Too many redirects'));
          return;
        }

        // Resolve relative URLs against the current URL
        const redirectUrl = new URL(location, url);

        // Credentials must not leak to a different origin
        let redirectHeaders = headers;
        if (redirectHeaders && redirectUrl.origin !== parsedUrl.origin) {
          redirectHeaders = Object.fromEntries(
            Object.entries(redirectHeaders).filter(
              ([key]) => !SENSITIVE_HEADERS.has(key.toLowerCase()),
            ),
          );
        }

        // Consume the response body to free up the socket
        res.resume();

        doRequest(redirectUrl.href, timeout, remainingRedirects - 1, tls, redirectHeaders).then(
          resolve,
          reject,
        );
        return;
      }

      // Reject on client/server errors
      if (statusCode >= 400) {
        res.resume();
        reject(new FetchError(url, statusCode));
        return;
      }

      // Collect response body
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve({
          statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      });

      res.on('error', (err) => {
        reject(new FetchError(url, undefined, err.message));
      });
    };

    // TLS options (client cert, custom CA, etc) only apply to https: requests.
    const req = isHttps
      ? https.get(url, { ...tls, headers }, onResponse)
      : http.get(url, { headers }, onResponse);

    req.on('error', (err) => {
      reject(new FetchError(url, undefined, err.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new TimeoutError(url, timeout));
    });

    req.setTimeout(timeout);
  });
}
