import { LogLevel } from '../shared/logger';

/**
 * A map of module names to their remote `.d.ts` URLs.
 *
 * Keys are the module names used in `declare module "name"`.
 * Values are HTTP(S) URLs pointing to `.d.ts` files.
 */
export type RemoteMap = Record<string, string>;

/**
 * TLS options for HTTPS requests, forwarded to Node's `https` client.
 *
 * Use this when a remote requires a client certificate (mutual TLS) or a
 * custom/self-signed CA that isn't in Node's default trust store.
 */
export type TlsOptions = {
  /** Trusted CA certificate(s), added to (not replacing) Node's default trust store. */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Client certificate for mutual TLS. */
  cert?: string | Buffer;
  /** Private key matching `cert`. */
  key?: string | Buffer;
  /** PKCS#12 certificate/key bundle, as an alternative to `cert`/`key`. */
  pfx?: string | Buffer;
  /** Passphrase for `key` or `pfx`. */
  passphrase?: string;
  /**
   * Verify the server's certificate against trusted CAs.
   * @default true
   */
  rejectUnauthorized?: boolean;
};

/**
 * Options for the fetcher.
 */
export type FetcherOptions = {
  /**
   * Map of remote module name to URL.
   *
   * @example
   * ```typescript
   * {
   *   "my-app": "https://cdn.example.com/@types/types.d.ts",
   *   "@shared/ui": "https://assets.example.com/shared-ui/types.d.ts"
   * }
   * ```
   */
  remotes: RemoteMap;

  /**
   * Directory for cached `.d.ts` files.
   * @default "node_modules/.ts-remote/"
   */
  cacheDir?: string;

  /**
   * Cache TTL in milliseconds.
   * Cached files older than this will be re-fetched.
   * Set to `0` to always re-fetch. Set to `Infinity` to never re-fetch.
   * @default 300_000 (5 minutes)
   */
  cacheTTL?: number;

  /**
   * Number of retry attempts on HTTP failure.
   * @default 2
   */
  retries?: number;

  /**
   * Timeout for each HTTP request in milliseconds.
   * @default 10_000 (10 seconds)
   */
  timeout?: number;

  /**
   * Maximum number of redirects to follow per request.
   * @default 5
   */
  maxRedirects?: number;

  /**
   * Log level for output verbosity.
   * @default LogLevel.Info
   */
  logLevel?: LogLevel;

  /**
   * TLS options for HTTPS requests (client certificates, custom CA, etc).
   */
  tls?: TlsOptions;

  /**
   * Extra request headers, e.g. an `Authorization` token for a private host.
   *
   * `Authorization`, `Cookie` and `Proxy-Authorization` are dropped when a
   * redirect leaves the original origin, so credentials can't leak.
   */
  headers?: Record<string, string>;

  /**
   * When a fetch fails and an expired cached copy exists on disk, fall back
   * to the stale copy (with a warning) instead of throwing.
   * @default true
   */
  staleIfError?: boolean;
};

/**
 * Result of fetching a single remote.
 */
export type FetchResult = {
  /** The module name */
  name: string;
  /** The URL it was fetched from */
  url: string;
  /** The local path where the `.d.ts` is cached */
  cachedPath: string;
  /** Whether it was served from cache (true) or freshly fetched (false) */
  fromCache: boolean;
  /** True when the fetch failed and an expired cached copy was used instead */
  stale?: boolean;
};

/**
 * Configuration as read from the tsconfig.json plugins section.
 */
export type TsRemotePluginConfig = {
  name: 'ts-remote';
  remotes: RemoteMap;
  cacheDir?: string;
  cacheTTL?: number;
  tls?: TlsOptions;
  headers?: Record<string, string>;
};
