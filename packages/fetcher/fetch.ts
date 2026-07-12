import path from 'node:path';
import process from 'node:process';
import { FetcherOptions, FetchResult, TlsOptions } from './contract-public';
import { CacheManager } from './cache';
import { httpGet, HttpGetResult } from './http';
import { validateRemotes } from './config';
import { Logger, LogLevel } from '../shared/logger';
import { FetchError } from '../shared/errors';

const DEFAULT_CACHE_DIR = 'node_modules/.ts-remote';
const DEFAULT_CACHE_TTL = 300_000; // 5 minutes
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT = 10_000; // 10 seconds

export type FetchOneOptions = {
  cache: CacheManager;
  logger: Logger;
  cacheTTL: number;
  retries: number;
  timeout: number;
  maxRedirects?: number;
  tls?: TlsOptions;
  headers?: Record<string, string>;
  staleIfError: boolean;
};

/**
 * Fetch remote `.d.ts` files and cache them locally.
 *
 * Downloads declaration files from the configured URLs (in parallel) and
 * stores them in a local cache directory for use by the TS Language Service
 * Plugin or direct consumption.
 *
 * @example
 * ```typescript
 * import fetch from 'ts-remote/fetcher';
 *
 * const results = await fetch({
 *   remotes: {
 *     'my-app': 'https://cdn.example.com/types.d.ts',
 *   },
 * });
 *
 * console.log(results[0].cachedPath); // node_modules/.ts-remote/my-app.d.ts
 * ```
 */
export default async function fetchRemotes(options: FetcherOptions): Promise<FetchResult[]> {
  const {
    remotes,
    cacheDir = path.resolve(process.cwd(), DEFAULT_CACHE_DIR),
    cacheTTL = DEFAULT_CACHE_TTL,
    retries = DEFAULT_RETRIES,
    timeout = DEFAULT_TIMEOUT,
    maxRedirects,
    logLevel = LogLevel.Info,
    tls,
    headers,
    staleIfError = true,
  } = options;

  validateRemotes(remotes);

  const logger = new Logger(logLevel);
  const cache = new CacheManager(cacheDir, logger);

  return Promise.all(
    Object.entries(remotes).map(([name, url]) =>
      fetchOne(name, url, {
        cache,
        logger,
        cacheTTL,
        retries,
        timeout,
        maxRedirects,
        tls,
        headers,
        staleIfError,
      }),
    ),
  );
}

/**
 * Fetch a single remote, going through the full cache lifecycle:
 *
 * 1. Fresh cache entry (within TTL) → served as-is, no request.
 * 2. Expired entry with a stored ETag → conditional request (`If-None-Match`);
 *    a `304 Not Modified` revalidates the cached copy without re-downloading.
 * 3. Fetch failure with an expired copy on disk → the stale copy is used
 *    (with a warning) when `staleIfError` is enabled.
 *
 * Used by `fetchRemotes` and by the Language Service Plugin's background refresh.
 */
export async function fetchOne(
  name: string,
  url: string,
  options: FetchOneOptions,
): Promise<FetchResult> {
  const { cache, logger, cacheTTL, staleIfError } = options;

  const cached = cache.get(name, cacheTTL);

  if (cached) {
    logger.info(`${name}: using cached version`, { path: cached.filePath });
    return { name, url, cachedPath: cached.filePath, fromCache: true };
  }

  // An expired copy enables conditional requests and stale-if-error fallback
  const stale = cache.getStale(name);

  const headers: Record<string, string> = { ...options.headers };
  if (stale?.etag) {
    headers['If-None-Match'] = stale.etag;
  }

  let result: HttpGetResult;

  try {
    result = await fetchWithRetries(url, { ...options, headers, name });

    if (result.statusCode !== 304) {
      validateDeclarationBody(url, result);
    }
  } catch (err) {
    if (staleIfError && stale) {
      logger.warn(
        `${name}: fetch failed (${err instanceof Error ? err.message : String(err)}), using stale cached version`,
        { path: stale.filePath },
      );
      return { name, url, cachedPath: stale.filePath, fromCache: true, stale: true };
    }
    throw err;
  }

  // 304 Not Modified — the cached copy is still current, refresh its TTL
  if (result.statusCode === 304) {
    if (!stale) {
      throw new FetchError(url, 304, 'Server returned 304 but nothing is cached');
    }
    cache.touch(name);
    logger.info(`${name}: not modified, cache revalidated`, { path: stale.filePath });
    return { name, url, cachedPath: stale.filePath, fromCache: true };
  }

  const etagHeader = result.headers['etag'];
  const entry = cache.set(
    name,
    result.body,
    typeof etagHeader === 'string' ? etagHeader : undefined,
  );

  logger.info(`${name}: fetched and cached`, { url, path: entry.filePath });
  return { name, url, cachedPath: entry.filePath, fromCache: false };
}

/**
 * Reject responses that clearly aren't a declaration file — e.g. an HTML
 * error page served with a 200 status by a misconfigured CDN, which would
 * otherwise be cached and break type resolution.
 */
function validateDeclarationBody(url: string, result: HttpGetResult): void {
  const body = result.body.trim();

  if (body.length === 0) {
    throw new FetchError(url, result.statusCode, 'Empty response body');
  }

  if (/^<!doctype\s|^<html[\s>]/i.test(body)) {
    throw new FetchError(
      url,
      result.statusCode,
      'Response looks like an HTML page, not a declaration file',
    );
  }
}

async function fetchWithRetries(
  url: string,
  options: {
    retries: number;
    timeout: number;
    maxRedirects?: number;
    tls?: TlsOptions;
    headers?: Record<string, string>;
    logger: Logger;
    name: string;
  },
): Promise<HttpGetResult> {
  const { retries, timeout, maxRedirects, tls, headers, logger, name } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms, ...
        logger.debug(`${name}: retry ${attempt}/${retries} after ${delay}ms`);
        await sleep(delay);
      }

      return await httpGet(url, { timeout, maxRedirects, tls, headers });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on 4xx errors (client errors)
      if (err instanceof FetchError && (err.details as { statusCode?: number })?.statusCode) {
        const statusCode = (err.details as { statusCode: number }).statusCode;
        if (statusCode >= 400 && statusCode < 500) {
          throw err;
        }
      }

      logger.debug(`${name}: attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
