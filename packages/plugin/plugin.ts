import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { CacheManager } from '../fetcher/cache';
import { fetchOne } from '../fetcher/fetch';
import { readHeadersConfig, readTlsConfig, validateRemotes } from '../fetcher/config';
import { Logger, LogLevel } from '../shared/logger';
import { RemoteMap, TsRemotePluginConfig } from '../fetcher/contract-public';

const DEFAULT_CACHE_DIR = 'node_modules/.ts-remote';
const DEFAULT_CACHE_TTL = 300_000; // 5 minutes
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRIES = 2;

/**
 * TypeScript Language Service Plugin for resolving remote `.d.ts` declarations.
 *
 * Works in two phases:
 * 1. On startup, reads pre-cached `.d.ts` files synchronously from disk
 * 2. In the background, fetches updated types and refreshes the project
 */
export class TsRemotePlugin {
  #ts: typeof ts;
  #info: ts.server.PluginCreateInfo;
  #config: TsRemotePluginConfig;
  #cacheManager: CacheManager;
  #logger: Logger;
  #cachedFilesByModule = new Map<string, string>();

  /** Static registry: project → external file paths for getExternalFiles */
  static #projectFiles = new Map<ts.server.Project, string[]>();

  constructor(tsModule: typeof ts, info: ts.server.PluginCreateInfo) {
    this.#ts = tsModule;
    this.#info = info;
    this.#logger = new Logger(LogLevel.Info);

    // Extract config from the plugin entry in tsconfig.json
    const rawConfig = info.config as Partial<TsRemotePluginConfig> & {
      tls?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    };
    const projectDir = info.project.getCurrentDirectory();

    this.#config = {
      name: 'ts-remote',
      remotes: (rawConfig.remotes as RemoteMap) ?? {},
      cacheDir: rawConfig.cacheDir,
      cacheTTL: rawConfig.cacheTTL,
      tls: this.resolveTls(rawConfig.tls, projectDir),
      headers: this.resolveHeaders(rawConfig.headers),
    };
    const cacheDir = this.#config.cacheDir
      ? path.resolve(projectDir, this.#config.cacheDir)
      : path.resolve(projectDir, DEFAULT_CACHE_DIR);

    this.#cacheManager = new CacheManager(cacheDir, this.#logger);

    // Load pre-cached files synchronously
    this.loadCachedFiles();

    // Validate and trigger background fetch if remotes are configured
    if (Object.keys(this.#config.remotes).length > 0) {
      try {
        validateRemotes(this.#config.remotes);
        this.triggerFetch();
      } catch (err) {
        this.#logger.error('Invalid remotes configuration', err instanceof Error ? err : undefined);
      }
    }
  }

  /**
   * Get external files managed by this plugin for a given project.
   */
  static getExternalFilesForProject(project: ts.server.Project): string[] {
    return TsRemotePlugin.#projectFiles.get(project) ?? [];
  }

  /**
   * Resolve the `tls` block from the tsconfig plugin entry (cert file paths,
   * relative to the project root) into buffers for the HTTP client.
   * A broken tls config must not take down the TS server, so errors are
   * logged and background fetching proceeds without TLS options.
   */
  private resolveTls(
    raw: Record<string, unknown> | undefined,
    projectDir: string,
  ): TsRemotePluginConfig['tls'] {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    try {
      return readTlsConfig(raw, projectDir);
    } catch (err) {
      this.#logger.error('Invalid tls configuration', err instanceof Error ? err : undefined);
      return undefined;
    }
  }

  /**
   * Resolve the `headers` block from the tsconfig plugin entry (including
   * `${ENV_VAR}` substitution). Like `tls`, a broken headers config is logged
   * and skipped rather than crashing the TS server.
   */
  private resolveHeaders(
    raw: Record<string, unknown> | undefined,
  ): TsRemotePluginConfig['headers'] {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    try {
      return readHeadersConfig(raw);
    } catch (err) {
      this.#logger.error('Invalid headers configuration', err instanceof Error ? err : undefined);
      return undefined;
    }
  }

  /**
   * Decorate the Language Service and patch module resolution on the host.
   */
  decorate(languageService: ts.LanguageService): ts.LanguageService {
    // Create a proxy that delegates to the original LS
    const proxy = Object.create(null) as ts.LanguageService;

    for (const k of Object.keys(languageService) as Array<keyof ts.LanguageService>) {
      const x = languageService[k];
      (proxy as unknown as Record<string, unknown>)[k] =
        typeof x === 'function' ? (x as Function).bind(languageService) : x;
    }

    // Patch the host's module resolution
    this.patchModuleResolution();

    // Register external files for this project
    this.updateExternalFiles();

    return proxy;
  }

  /**
   * Monkey-patch `resolveModuleNameLiterals` on the language service host
   * to resolve configured remote modules from the local cache.
   */
  private patchModuleResolution(): void {
    const host = this.#info.languageServiceHost;
    const original = host.resolveModuleNameLiterals?.bind(host);

    if (!original) {
      this.#logger.debug('resolveModuleNameLiterals not available on host, skipping patch');
      return;
    }

    const plugin = this;

    host.resolveModuleNameLiterals = (
      moduleLiterals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile,
      reusedNames,
    ) => {
      const results = original(
        moduleLiterals,
        containingFile,
        redirectedReference,
        options,
        containingSourceFile,
        reusedNames,
      );

      return results.map((result, i) => {
        // If already resolved, don't interfere
        if (result.resolvedModule) {
          return result;
        }

        const moduleName = moduleLiterals[i].text;
        const cachedPath = plugin.#cachedFilesByModule.get(moduleName);

        if (cachedPath && fs.existsSync(cachedPath)) {
          return {
            resolvedModule: {
              resolvedFileName: cachedPath,
              isExternalLibraryImport: false,
              extension: plugin.#ts.Extension.Dts,
            },
          } as ts.ResolvedModuleWithFailedLookupLocations;
        }

        return result;
      });
    };
  }

  /**
   * Synchronously load pre-cached files from disk into the module map.
   */
  private loadCachedFiles(): void {
    const entries = this.#cacheManager.entries();
    let loadedCount = 0;

    for (const [name, entry] of Object.entries(entries)) {
      if (fs.existsSync(entry.filePath)) {
        this.#cachedFilesByModule.set(name, entry.filePath);
        loadedCount++;
      }
    }

    if (loadedCount > 0) {
      this.#logger.info(`Loaded ${loadedCount} cached remote type(s)`);
    } else if (Object.keys(this.#config.remotes).length > 0) {
      this.#logger.info('No cached remote types found. Run `ts-remote fetch` to download types.');
    }
  }

  /**
   * Trigger an asynchronous background fetch for stale or missing remotes.
   * When types are updated, refreshes the project so TS re-resolves modules.
   */
  private triggerFetch(): void {
    const ttl = this.#config.cacheTTL ?? DEFAULT_CACHE_TTL;
    const remotes = this.#config.remotes;

    // Fire-and-forget — errors are logged per remote, not thrown
    (async () => {
      let updated = false;

      await Promise.all(
        Object.entries(remotes).map(async ([name, url]) => {
          try {
            const result = await fetchOne(name, url, {
              cache: this.#cacheManager,
              logger: this.#logger,
              cacheTTL: ttl,
              retries: DEFAULT_RETRIES,
              timeout: DEFAULT_TIMEOUT,
              tls: this.#config.tls,
              headers: this.#config.headers,
              staleIfError: true,
            });

            this.#cachedFilesByModule.set(name, result.cachedPath);

            if (!result.fromCache) {
              updated = true;
            }
          } catch (err) {
            this.#logger.error(
              `Failed to fetch remote types for "${name}" from ${url}`,
              err instanceof Error ? err : undefined,
            );
          }
        }),
      );

      if (updated) {
        this.updateExternalFiles();
        this.refreshProject();
      }
    })();
  }

  /**
   * Update the static external files registry for this project.
   */
  private updateExternalFiles(): void {
    const files = [...this.#cachedFilesByModule.values()];
    TsRemotePlugin.#projectFiles.set(this.#info.project, files);
  }

  /**
   * Request the TS server to refresh the project graph,
   * which forces re-resolution of modules and updated diagnostics.
   */
  private refreshProject(): void {
    try {
      this.#info.project.updateGraph();
    } catch (err) {
      this.#logger.debug(`Failed to refresh project: ${err}`);
    }
  }
}
