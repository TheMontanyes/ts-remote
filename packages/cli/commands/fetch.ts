import path from 'node:path';
import process from 'node:process';
import { readPluginConfig } from '../../fetcher/config';
import fetchRemotes from '../../fetcher/fetch';
import { Logger, LogLevel } from '../../shared/logger';

/**
 * Execute the `ts-remote fetch` command.
 *
 * Reads remotes configuration from tsconfig.json and downloads
 * all remote `.d.ts` files to the local cache.
 */
export async function fetchCommand(flags: Record<string, string | boolean>): Promise<void> {
  const cwd = process.cwd();
  const configPath =
    typeof flags['config'] === 'string'
      ? path.resolve(cwd, flags['config'])
      : path.resolve(cwd, 'tsconfig.json');
  const force = flags['force'] === true;
  const cacheDir =
    typeof flags['cache-dir'] === 'string' ? path.resolve(cwd, flags['cache-dir']) : undefined;

  const logger = new Logger(LogLevel.Info);
  logger.time('fetch');

  const pluginConfig = readPluginConfig(configPath);

  const results = await fetchRemotes({
    remotes: pluginConfig.remotes,
    cacheDir: cacheDir ?? pluginConfig.cacheDir,
    cacheTTL: force ? 0 : pluginConfig.cacheTTL,
    tls: pluginConfig.tls,
    headers: pluginConfig.headers,
    // --force means "give me fresh types or fail" — no stale fallback
    staleIfError: !force,
  });

  for (const result of results) {
    if (result.stale) {
      logger.warn(`${result.name}: server unreachable, using stale cache (${result.cachedPath})`);
    } else if (result.fromCache) {
      logger.info(`${result.name}: cached (${result.cachedPath})`);
    } else {
      logger.info(`${result.name}: fetched from ${result.url}`);
    }
  }

  logger.timeEnd('fetch');
}
