import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import ts from 'typescript';
import build from '../builder/build';
import fetchRemotes from '../fetcher/fetch';
import { TsRemotePlugin } from '../plugin/plugin';
import { LogLevel } from '../shared/logger';

let tmpDir: string;
let server: http.Server | undefined;

function createServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = undefined;
    } else {
      resolve();
    }
  });
}

describe('e2e: builder → fetcher → plugin', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-e2e-'));
  });

  afterEach(async () => {
    await closeServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full cycle: build .d.ts, serve via HTTP, fetch to cache, resolve in plugin', async () => {
    // --- Step 1: Builder generates .d.ts from source ---

    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'global.d.ts'),
      `
interface AppSettings {
  locale: string;
}

declare var appSettings: AppSettings;
`,
    );

    fs.writeFileSync(
      path.join(srcDir, 'index.ts'),
      `
export interface User {
  id: string;
  name: string; 
}

export function getUser(id: string): Promise<User> {
  return Promise.resolve({ id, name: 'test' });
}

export enum Role {
  Admin = 'admin',
  User = 'user',
}

export const getSettings = () => appSettings;
`,
    );

    const outputPath = path.join(tmpDir, 'dist', 'types.d.ts');

    await build({
      entries: [{ name: 'test-app', filename: path.join(srcDir, 'index.ts') }],
      output: { filename: outputPath },
      tsconfig: path.resolve(process.cwd(), 'tsconfig.json'),
      additionalDeclarations: [path.join(srcDir, 'global.d.ts')],
    });

    assert.ok(fs.existsSync(outputPath), 'Builder should create output .d.ts');

    const dtsContent = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(
      dtsContent.includes('declare module "test-app"'),
      'Output should contain declare module',
    );
    assert.ok(dtsContent.includes('User'), 'Output should contain User interface');
    assert.ok(dtsContent.includes('getUser'), 'Output should contain getUser function');
    assert.ok(dtsContent.includes('Role'), 'Output should contain Role enum');
    assert.ok(
      dtsContent.includes('interface AppSettings'),
      'Output should ship the global declarations',
    );
    assert.match(
      dtsContent,
      /getSettings: \(\) => AppSettings/,
      'Emitted types should resolve against the global declarations',
    );

    // --- Step 2: Serve .d.ts via HTTP ---

    const url = await createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(dtsContent);
    });

    // --- Step 3: Fetcher downloads and caches ---

    const cacheDir = path.join(tmpDir, '.cache');

    const results = await fetchRemotes({
      remotes: { 'test-app': `${url}/types.d.ts` },
      cacheDir,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'test-app');
    assert.equal(results[0].fromCache, false);
    assert.ok(fs.existsSync(results[0].cachedPath), 'Cached file should exist on disk');

    const cachedContent = fs.readFileSync(results[0].cachedPath, 'utf-8');
    assert.equal(cachedContent, dtsContent, 'Cached content should match built .d.ts');

    // The fetched file must remain a script (no top-level import/export):
    // only then do its top-level declarations stay global for the consumer.
    const cachedSourceFile = ts.createSourceFile(
      results[0].cachedPath,
      cachedContent,
      ts.ScriptTarget.Latest,
      true,
    );
    assert.equal(
      ts.isExternalModule(cachedSourceFile),
      false,
      'Fetched .d.ts must be a script file so its globals apply in the consumer',
    );

    // Verify manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, 'manifest.json'), 'utf-8'));
    assert.ok(manifest.entries['test-app'], 'Manifest should have test-app entry');
    assert.ok(manifest.entries['test-app'].filePath, 'Manifest entry should have filePath');

    // --- Step 4: Plugin resolves module from cache ---

    const unresolvedResult = {
      resolvedModule: undefined,
    } as ts.ResolvedModuleWithFailedLookupLocations;

    const originalResolve = mock.fn(() => [unresolvedResult]);

    const host: Partial<ts.LanguageServiceHost> = {
      resolveModuleNameLiterals: originalResolve,
    };

    const project = {
      getCurrentDirectory: () => tmpDir,
      updateGraph: mock.fn(),
    } as unknown as ts.server.Project;

    const info = {
      config: {
        remotes: { 'test-app': `${url}/types.d.ts` },
        cacheDir: '.cache',
      },
      languageService: {} as ts.LanguageService,
      languageServiceHost: host as ts.LanguageServiceHost,
      project,
      serverHost: {} as ts.server.ServerHost,
    } as ts.server.PluginCreateInfo;

    const plugin = new TsRemotePlugin(ts, info);
    plugin.decorate(info.languageService);

    // Verify external files are registered
    const externalFiles = TsRemotePlugin.getExternalFilesForProject(project);
    assert.equal(externalFiles.length, 1, 'Plugin should register 1 external file');
    assert.ok(externalFiles[0].endsWith('.d.ts'), 'External file should be a .d.ts');

    // Verify module resolution
    const patchedResolve = host.resolveModuleNameLiterals!;
    const moduleLiterals = [{ text: 'test-app' }] as ts.StringLiteralLike[];

    const resolved = patchedResolve(
      moduleLiterals,
      'consumer.ts',
      undefined as unknown as ts.ResolvedProjectReference | undefined,
      {} as ts.CompilerOptions,
      {} as ts.SourceFile,
      undefined,
    );

    assert.equal(resolved.length, 1);
    assert.ok(resolved[0].resolvedModule, 'Module should be resolved');
    assert.equal(resolved[0].resolvedModule!.extension, ts.Extension.Dts);
    assert.equal(
      resolved[0].resolvedModule!.resolvedFileName,
      results[0].cachedPath,
      'Resolved path should match cached path',
    );

    // --- Step 5: Cache hit on second fetch ---

    const results2 = await fetchRemotes({
      remotes: { 'test-app': `${url}/types.d.ts` },
      cacheDir,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results2[0].fromCache, true, 'Second fetch should be a cache hit');
    assert.equal(results2[0].cachedPath, results[0].cachedPath, 'Cached path should be the same');
  });
});
