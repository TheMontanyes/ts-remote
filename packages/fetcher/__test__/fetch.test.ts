import { describe, it, beforeEach, afterEach, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import fetchRemotes from '../fetch';
import { LogLevel } from '../../shared/logger';
import { generateTestCerts } from './test-certs';

let server: http.Server | https.Server | undefined;
let tmpDir: string;

function createServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function createHttpsServer(
  options: https.ServerOptions,
  handler: http.RequestListener,
): Promise<string> {
  return new Promise((resolve) => {
    server = https.createServer(options, handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as { port: number };
      resolve(`https://127.0.0.1:${addr.port}`);
    });
  });
}

describe('fetchRemotes', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-fetch-'));
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (server) {
        server.close(() => resolve());
        server = undefined;
      } else {
        resolve();
      }
    });
  });

  it('fetches remote and caches to disk', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(200);
      res.end('declare module "my-app" { export const version: string; }');
    });

    const results = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'my-app');
    assert.equal(results[0].fromCache, false);
    assert.ok(fs.existsSync(results[0].cachedPath));
    assert.equal(
      fs.readFileSync(results[0].cachedPath, 'utf-8'),
      'declare module "my-app" { export const version: string; }',
    );
  });

  it('serves from cache on second call', async () => {
    let requestCount = 0;
    const url = await createServer((_req, res) => {
      requestCount++;
      res.writeHead(200);
      res.end('declare module "my-app" {}');
    });

    await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: Infinity,
      logLevel: LogLevel.Silent,
    });

    const results = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: Infinity,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results[0].fromCache, true);
    assert.equal(requestCount, 1);
  });

  it('re-fetches when cacheTTL is 0 (force)', async () => {
    let requestCount = 0;
    const url = await createServer((_req, res) => {
      requestCount++;
      res.writeHead(200);
      res.end(`version ${requestCount}`);
    });

    await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      logLevel: LogLevel.Silent,
    });

    const results = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results[0].fromCache, false);
    assert.equal(requestCount, 2);
  });

  it('fetches multiple remotes', async () => {
    const url = await createServer((req, res) => {
      res.writeHead(200);
      res.end(`types for ${req.url}`);
    });

    const results = await fetchRemotes({
      remotes: {
        'app-a': `${url}/a`,
        'app-b': `${url}/b`,
      },
      cacheDir: tmpDir,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].name, 'app-a');
    assert.equal(results[1].name, 'app-b');
  });

  it('throws on invalid remotes', async () => {
    await assert.rejects(
      () => fetchRemotes({ remotes: {}, cacheDir: tmpDir, logLevel: LogLevel.Silent }),
      /empty/,
    );
  });

  it('does not retry on 4xx errors', async () => {
    let requestCount = 0;
    const url = await createServer((_req, res) => {
      requestCount++;
      res.writeHead(404);
      res.end();
    });

    await assert.rejects(
      () =>
        fetchRemotes({
          remotes: { 'my-app': url },
          cacheDir: tmpDir,
          retries: 2,
          logLevel: LogLevel.Silent,
        }),
      /404/,
    );

    assert.equal(requestCount, 1);
  });

  it('passes custom headers to the server', async () => {
    let seenAuth: string | undefined;
    const url = await createServer((req, res) => {
      seenAuth = req.headers['authorization'];
      res.writeHead(200);
      res.end('declare module "my-app" {}');
    });

    await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      headers: { Authorization: 'Bearer token-123' },
      logLevel: LogLevel.Silent,
    });

    assert.equal(seenAuth, 'Bearer token-123');
  });

  it('revalidates an expired entry via ETag / 304 without re-downloading', async () => {
    const requests: Array<string | undefined> = [];
    const url = await createServer((req, res) => {
      requests.push(req.headers['if-none-match']);

      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304);
        res.end();
      } else {
        res.writeHead(200, { ETag: '"v1"' });
        res.end('declare module "my-app" {}');
      }
    });

    const first = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      logLevel: LogLevel.Silent,
    });
    assert.equal(first[0].fromCache, false);

    const second = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      logLevel: LogLevel.Silent,
    });

    assert.deepStrictEqual(requests, [undefined, '"v1"']);
    assert.equal(second[0].fromCache, true);
    assert.equal(second[0].stale, undefined);
    assert.equal(fs.readFileSync(second[0].cachedPath, 'utf-8'), 'declare module "my-app" {}');
  });

  it('falls back to a stale cached copy when the server starts failing', async () => {
    let failing = false;
    const url = await createServer((_req, res) => {
      if (failing) {
        res.writeHead(500);
        res.end();
      } else {
        res.writeHead(200);
        res.end('declare module "my-app" { export const v: 1; }');
      }
    });

    await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      logLevel: LogLevel.Silent,
    });

    failing = true;
    const results = await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      retries: 0,
      logLevel: LogLevel.Silent,
    });

    assert.equal(results[0].fromCache, true);
    assert.equal(results[0].stale, true);
    assert.match(fs.readFileSync(results[0].cachedPath, 'utf-8'), /export const v/);
  });

  it('throws instead of falling back when staleIfError is false', async () => {
    let failing = false;
    const url = await createServer((_req, res) => {
      if (failing) {
        res.writeHead(500);
        res.end();
      } else {
        res.writeHead(200);
        res.end('declare module "my-app" {}');
      }
    });

    await fetchRemotes({
      remotes: { 'my-app': url },
      cacheDir: tmpDir,
      cacheTTL: 0,
      logLevel: LogLevel.Silent,
    });

    failing = true;
    await assert.rejects(
      () =>
        fetchRemotes({
          remotes: { 'my-app': url },
          cacheDir: tmpDir,
          cacheTTL: 0,
          retries: 0,
          staleIfError: false,
          logLevel: LogLevel.Silent,
        }),
      /500/,
    );
  });

  it('rejects an HTML response instead of caching it', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>Not Found</body></html>');
    });

    await assert.rejects(
      () =>
        fetchRemotes({ remotes: { 'my-app': url }, cacheDir: tmpDir, logLevel: LogLevel.Silent }),
      /HTML page/,
    );
  });

  it('rejects an empty response body', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(200);
      res.end('');
    });

    await assert.rejects(
      () =>
        fetchRemotes({ remotes: { 'my-app': url }, cacheDir: tmpDir, logLevel: LogLevel.Silent }),
      /Empty response/i,
    );
  });

  it('honors maxRedirects', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(302, { Location: '/' });
      res.end();
    });

    await assert.rejects(
      () =>
        fetchRemotes({
          remotes: { 'my-app': url },
          cacheDir: tmpDir,
          maxRedirects: 1,
          retries: 0,
          logLevel: LogLevel.Silent,
        }),
      /redirect/i,
    );
  });

  describe('tls', () => {
    let certDir: string;
    let caCert: Buffer;
    let serverCert: Buffer;
    let serverKey: Buffer;
    let clientCert: Buffer;
    let clientKey: Buffer;

    before(() => {
      certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-fetch-certs-'));
      generateTestCerts(certDir);

      caCert = fs.readFileSync(path.join(certDir, 'ca-cert.pem'));
      serverCert = fs.readFileSync(path.join(certDir, 'server-cert.pem'));
      serverKey = fs.readFileSync(path.join(certDir, 'server-key.pem'));
      clientCert = fs.readFileSync(path.join(certDir, 'client-cert.pem'));
      clientKey = fs.readFileSync(path.join(certDir, 'client-key.pem'));
    });

    after(() => {
      fs.rmSync(certDir, { recursive: true, force: true });
    });

    it('rejects an untrusted HTTPS remote when no tls option is passed', async () => {
      const url = await createHttpsServer({ cert: serverCert, key: serverKey }, (_req, res) => {
        res.writeHead(200);
        res.end('declare module "my-app" {}');
      });

      await assert.rejects(() =>
        fetchRemotes({
          remotes: { 'my-app': url },
          cacheDir: tmpDir,
          retries: 0,
          logLevel: LogLevel.Silent,
        }),
      );
    });

    it('fetches from a remote behind a custom CA when tls.ca is passed', async () => {
      const url = await createHttpsServer({ cert: serverCert, key: serverKey }, (_req, res) => {
        res.writeHead(200);
        res.end('declare module "my-app" {}');
      });

      const results = await fetchRemotes({
        remotes: { 'my-app': url },
        cacheDir: tmpDir,
        logLevel: LogLevel.Silent,
        tls: { ca: caCert },
      });

      assert.equal(results[0].fromCache, false);
      assert.equal(fs.readFileSync(results[0].cachedPath, 'utf-8'), 'declare module "my-app" {}');
    });

    it('sends a client certificate to a remote requiring mutual TLS', async () => {
      const url = await createHttpsServer(
        {
          cert: serverCert,
          key: serverKey,
          ca: caCert,
          requestCert: true,
          rejectUnauthorized: true,
        },
        (_req, res) => {
          res.writeHead(200);
          res.end('declare module "my-app" {}');
        },
      );

      const results = await fetchRemotes({
        remotes: { 'my-app': url },
        cacheDir: tmpDir,
        logLevel: LogLevel.Silent,
        tls: { ca: caCert, cert: clientCert, key: clientKey },
      });

      assert.equal(results[0].fromCache, false);
      assert.equal(fs.readFileSync(results[0].cachedPath, 'utf-8'), 'declare module "my-app" {}');
    });
  });
});
