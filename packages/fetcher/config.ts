import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { ConfigError } from '../shared/errors';
import { RemoteMap, TlsOptions, TsRemotePluginConfig } from './contract-public';

/**
 * Read the ts-remote plugin configuration from a tsconfig.json file.
 *
 * Looks for an entry in `compilerOptions.plugins` where `name === "ts-remote"`.
 * Throws `ConfigError` if the tsconfig cannot be read or the plugin is not configured.
 */
export function readPluginConfig(tsconfigPath: string): TsRemotePluginConfig {
  let config: Record<string, unknown>;

  try {
    const result = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (result.error) {
      throw new ConfigError(
        `Failed to read tsconfig at ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(
          result.error.messageText,
          '\n',
        )}`,
      );
    }

    config = result.config as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to read tsconfig at ${tsconfigPath}`, { cause: err });
  }

  const compilerOptions = config['compilerOptions'] as Record<string, unknown> | undefined;

  if (!compilerOptions?.['plugins'] || !Array.isArray(compilerOptions['plugins'])) {
    throw new ConfigError(
      'No plugins configured in tsconfig.json. Add ts-remote to compilerOptions.plugins.',
    );
  }

  const pluginEntry = (compilerOptions['plugins'] as Array<Record<string, unknown>>).find(
    (p) => p['name'] === 'ts-remote',
  );

  if (!pluginEntry) {
    throw new ConfigError(
      'ts-remote plugin not found in tsconfig.json compilerOptions.plugins. ' +
        'Add { "name": "ts-remote", "remotes": { ... } } to the plugins array.',
    );
  }

  if (!pluginEntry['remotes'] || typeof pluginEntry['remotes'] !== 'object') {
    throw new ConfigError(
      'ts-remote plugin is missing the "remotes" field. ' +
        'Add a remotes object mapping module names to URLs.',
    );
  }

  const remotes = pluginEntry['remotes'] as RemoteMap;

  validateRemotes(remotes);

  const tls =
    pluginEntry['tls'] && typeof pluginEntry['tls'] === 'object'
      ? readTlsConfig(pluginEntry['tls'] as Record<string, unknown>, path.dirname(tsconfigPath))
      : undefined;

  const headers =
    pluginEntry['headers'] && typeof pluginEntry['headers'] === 'object'
      ? readHeadersConfig(pluginEntry['headers'] as Record<string, unknown>)
      : undefined;

  return {
    name: 'ts-remote',
    remotes,
    cacheDir: typeof pluginEntry['cacheDir'] === 'string' ? pluginEntry['cacheDir'] : undefined,
    cacheTTL: typeof pluginEntry['cacheTTL'] === 'number' ? pluginEntry['cacheTTL'] : undefined,
    tls,
    headers,
  };
}

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Read the `headers` block of the plugin config.
 *
 * Values may reference environment variables as `${VAR_NAME}` so secrets
 * (e.g. auth tokens) don't have to be committed inside tsconfig.json.
 * Referencing an unset variable is an error.
 */
export function readHeadersConfig(raw: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      throw new ConfigError(`Invalid "headers.${name}": expected a string.`);
    }

    headers[name] = value.replace(ENV_VAR_PATTERN, (_, varName: string) => {
      const resolved = process.env[varName];

      if (resolved === undefined) {
        throw new ConfigError(
          `Header "${name}" references environment variable "${varName}", which is not set.`,
        );
      }

      return resolved;
    });
  }

  return headers;
}

/**
 * Read the `tls` block of the plugin config.
 *
 * `ca`, `cert`, `key` and `pfx` are given as file paths (relative to the
 * tsconfig's directory, unless absolute) and are read into buffers here so
 * downstream consumers can pass them straight to Node's `https` client.
 */
export function readTlsConfig(raw: Record<string, unknown>, baseDir: string): TlsOptions {
  const tls: TlsOptions = {};

  for (const field of ['ca', 'cert', 'key', 'pfx'] as const) {
    const value = raw[field];

    if (value === undefined) continue;

    if (typeof value !== 'string') {
      throw new ConfigError(`Invalid "tls.${field}": expected a file path string.`);
    }

    const filePath = path.isAbsolute(value) ? value : path.resolve(baseDir, value);

    try {
      tls[field] = fs.readFileSync(filePath);
    } catch (err) {
      throw new ConfigError(`Failed to read "tls.${field}" file: ${filePath}`, { cause: err });
    }
  }

  if (raw['passphrase'] !== undefined) {
    if (typeof raw['passphrase'] !== 'string') {
      throw new ConfigError('Invalid "tls.passphrase": expected a string.');
    }
    tls.passphrase = raw['passphrase'];
  }

  if (raw['rejectUnauthorized'] !== undefined) {
    if (typeof raw['rejectUnauthorized'] !== 'boolean') {
      throw new ConfigError('Invalid "tls.rejectUnauthorized": expected a boolean.');
    }
    tls.rejectUnauthorized = raw['rejectUnauthorized'];
  }

  return tls;
}

/**
 * Validate the remotes map: ensure all keys are non-empty strings
 * and all values are valid HTTP(S) URLs.
 */
export function validateRemotes(remotes: RemoteMap): void {
  const entries = Object.entries(remotes);

  if (entries.length === 0) {
    throw new ConfigError('The "remotes" object is empty. Add at least one remote entry.');
  }

  for (const [name, url] of entries) {
    if (!name || typeof name !== 'string') {
      throw new ConfigError(
        `Invalid remote name: "${name}". Module names must be non-empty strings.`,
      );
    }

    if (!url || typeof url !== 'string') {
      throw new ConfigError(`Invalid URL for remote "${name}": URL must be a non-empty string.`);
    }

    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ConfigError(
          `Invalid URL for remote "${name}": "${url}". Only http:// and https:// URLs are supported.`,
        );
      }
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(`Invalid URL for remote "${name}": "${url}". Must be a valid URL.`);
    }
  }
}
