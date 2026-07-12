import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import ts from 'typescript';
import { TsRemotePlugin } from '../plugin';
import { CacheManager } from '../../fetcher/cache';
import { Logger, LogLevel } from '../../shared/logger';
import { generateTestCerts } from '../../fetcher/__test__/test-certs';

let tmpDir: string;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-plugin-'));
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Create a minimal mock of ts.server.PluginCreateInfo
 */
function createMockInfo(
  config: Record<string, unknown>,
  projectDir: string,
): ts.server.PluginCreateInfo {
  const resolvedModules: ts.ResolvedModuleWithFailedLookupLocations[] = [];

  const host: Partial<ts.LanguageServiceHost> = {
    resolveModuleNameLiterals: () => resolvedModules,
  };

  const languageService = {} as ts.LanguageService;

  // Create a minimal project mock
  const project = {
    getCurrentDirectory: () => projectDir,
    updateGraph: mock.fn(),
  } as unknown as ts.server.Project;

  return {
    config,
    languageService,
    languageServiceHost: host as ts.LanguageServiceHost,
    project,
    serverHost: {} as ts.server.ServerHost,
  } as ts.server.PluginCreateInfo;
}

describe('TsRemotePlugin', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('constructs with empty remotes without error', () => {
    const info = createMockInfo({ remotes: {} }, tmpDir);
    assert.doesNotThrow(() => new TsRemotePlugin(ts, info));
  });

  it('loads pre-cached files on construction', () => {
    // Pre-populate cache
    const cacheDir = path.join(tmpDir, 'node_modules/.ts-remote');
    const logger = new Logger(LogLevel.Silent);
    const cache = new CacheManager(cacheDir, logger);
    cache.set('my-app', 'declare module "my-app" { export const x: number; }');

    const info = createMockInfo(
      { remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' } },
      tmpDir,
    );

    const plugin = new TsRemotePlugin(ts, info);

    // The plugin should have loaded the cached file
    const externalFiles = TsRemotePlugin.getExternalFilesForProject(info.project);
    // External files are set after decorate() is called
    const ls = plugin.decorate(info.languageService);
    const files = TsRemotePlugin.getExternalFilesForProject(info.project);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('.d.ts'));
  });

  it('decorate returns a language service proxy', () => {
    const info = createMockInfo({ remotes: {} }, tmpDir);
    const plugin = new TsRemotePlugin(ts, info);

    const mockLs = {
      getCompletionsAtPosition: mock.fn(),
      getQuickInfoAtPosition: mock.fn(),
    } as unknown as ts.LanguageService;

    const decorated = plugin.decorate(mockLs);
    assert.ok(decorated);
    assert.ok(typeof decorated.getCompletionsAtPosition === 'function');
    assert.ok(typeof decorated.getQuickInfoAtPosition === 'function');
  });

  it('resolves remote modules from cache via patched resolution', () => {
    // Pre-populate cache
    const cacheDir = path.join(tmpDir, 'node_modules/.ts-remote');
    const logger = new Logger(LogLevel.Silent);
    const cache = new CacheManager(cacheDir, logger);
    const entry = cache.set('my-app', 'declare module "my-app" { export const x: number; }');

    // Create an unresolved result
    const unresolvedResult = {
      resolvedModule: undefined,
    } as ts.ResolvedModuleWithFailedLookupLocations;

    const originalResolve = mock.fn(() => [unresolvedResult]);

    const host: Partial<ts.LanguageServiceHost> = {
      resolveModuleNameLiterals: originalResolve,
    };

    const info = createMockInfo(
      { remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' } },
      tmpDir,
    );
    // Override host with our mock
    (info as { languageServiceHost: Partial<ts.LanguageServiceHost> }).languageServiceHost =
      host as ts.LanguageServiceHost;

    const plugin = new TsRemotePlugin(ts, info);
    plugin.decorate(info.languageService);

    // Now call the patched resolveModuleNameLiterals
    const patchedResolve = host.resolveModuleNameLiterals!;
    const moduleLiterals = [{ text: 'my-app' }] as ts.StringLiteralLike[];

    const results = patchedResolve(
      moduleLiterals,
      'test.ts',
      undefined as unknown as ts.ResolvedProjectReference | undefined,
      {} as ts.CompilerOptions,
      {} as ts.SourceFile,
      undefined,
    );

    assert.equal(results.length, 1);
    assert.ok(results[0].resolvedModule);
    assert.equal(results[0].resolvedModule!.resolvedFileName, entry.filePath);
    assert.equal(results[0].resolvedModule!.extension, ts.Extension.Dts);
  });

  it('does not override already resolved modules', () => {
    const cacheDir = path.join(tmpDir, 'node_modules/.ts-remote');
    const logger = new Logger(LogLevel.Silent);
    const cache = new CacheManager(cacheDir, logger);
    cache.set('my-app', 'declare module "my-app" {}');

    const alreadyResolved = {
      resolvedModule: {
        resolvedFileName: '/some/other/path.d.ts',
        isExternalLibraryImport: true,
        extension: ts.Extension.Dts,
      },
    } as ts.ResolvedModuleWithFailedLookupLocations;

    const originalResolve = mock.fn(() => [alreadyResolved]);

    const host: Partial<ts.LanguageServiceHost> = {
      resolveModuleNameLiterals: originalResolve,
    };

    const info = createMockInfo(
      { remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' } },
      tmpDir,
    );
    (info as { languageServiceHost: Partial<ts.LanguageServiceHost> }).languageServiceHost =
      host as ts.LanguageServiceHost;

    const plugin = new TsRemotePlugin(ts, info);
    plugin.decorate(info.languageService);

    const patchedResolve = host.resolveModuleNameLiterals!;
    const moduleLiterals = [{ text: 'my-app' }] as ts.StringLiteralLike[];

    const results = patchedResolve(
      moduleLiterals,
      'test.ts',
      undefined as unknown as ts.ResolvedProjectReference | undefined,
      {} as ts.CompilerOptions,
      {} as ts.SourceFile,
      undefined,
    );

    // Should keep the original resolution
    assert.equal(results[0].resolvedModule!.resolvedFileName, '/some/other/path.d.ts');
  });

  describe('getExternalFilesForProject', () => {
    it('returns empty array for unknown project', () => {
      const unknownProject = {} as ts.server.Project;
      const files = TsRemotePlugin.getExternalFilesForProject(unknownProject);
      assert.deepStrictEqual(files, []);
    });
  });

  it('constructs without error when the tls config is invalid', () => {
    const info = createMockInfo(
      {
        remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' },
        tls: { ca: './missing-ca.pem' },
      },
      tmpDir,
    );

    assert.doesNotThrow(() => new TsRemotePlugin(ts, info));
  });

  it('background fetch honors the tls config (mutual TLS)', async () => {
    generateTestCerts(tmpDir);
    const caCert = fs.readFileSync(path.join(tmpDir, 'ca-cert.pem'));

    const server = https.createServer(
      {
        cert: fs.readFileSync(path.join(tmpDir, 'server-cert.pem')),
        key: fs.readFileSync(path.join(tmpDir, 'server-key.pem')),
        ca: caCert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (_req, res) => {
        res.writeHead(200);
        res.end('declare module "my-app" { export const fromMtls: boolean; }');
      },
    );

    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        resolve(`https://127.0.0.1:${addr.port}/types.d.ts`);
      });
    });

    try {
      const info = createMockInfo(
        {
          remotes: { 'my-app': url },
          tls: {
            ca: './ca-cert.pem',
            cert: './client-cert.pem',
            key: './client-key.pem',
          },
        },
        tmpDir,
      );

      new TsRemotePlugin(ts, info);

      // The fetch is fire-and-forget — poll the cache until it lands
      const cachedPath = path.join(tmpDir, 'node_modules/.ts-remote/my-app.d.ts');
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(cachedPath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      assert.ok(fs.existsSync(cachedPath), 'expected background fetch to cache the remote');
      assert.match(fs.readFileSync(cachedPath, 'utf-8'), /fromMtls/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('uses custom cacheDir from config', () => {
    const customCacheDir = path.join(tmpDir, 'custom-cache');
    const logger = new Logger(LogLevel.Silent);
    const cache = new CacheManager(customCacheDir, logger);
    cache.set('my-app', 'declare module "my-app" {}');

    const info = createMockInfo(
      {
        remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' },
        cacheDir: 'custom-cache',
      },
      tmpDir,
    );

    const plugin = new TsRemotePlugin(ts, info);
    plugin.decorate(info.languageService);

    const files = TsRemotePlugin.getExternalFilesForProject(info.project);
    assert.equal(files.length, 1);
    assert.ok(files[0].includes('custom-cache'));
  });
});
