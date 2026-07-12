import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpGet } from '../http';
import { generateTestCerts } from './test-certs';

let server: http.Server | https.Server | undefined;

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

afterEach(() => {
  return new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = undefined;
    } else {
      resolve();
    }
  });
});

describe('httpGet', () => {
  it('fetches a 200 response', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('declare module "test" {}');
    });

    const result = await httpGet(url);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'declare module "test" {}');
  });

  it('follows redirects', async () => {
    let requestCount = 0;
    const url = await createServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        res.writeHead(302, { Location: '/final' });
        res.end();
      } else {
        res.writeHead(200);
        res.end('redirected content');
      }
    });

    const result = await httpGet(url);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'redirected content');
  });

  it('rejects on 404', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    await assert.rejects(
      () => httpGet(url),
      (err: Error) => {
        assert.ok(err.message.includes('404'));
        return true;
      },
    );
  });

  it('rejects on 500', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });

    await assert.rejects(
      () => httpGet(url),
      (err: Error) => {
        assert.ok(err.message.includes('500'));
        return true;
      },
    );
  });

  it('rejects on timeout', async () => {
    const url = await createServer((_req, _res) => {
      // Don't respond — let it timeout
    });

    await assert.rejects(() => httpGet(url, { timeout: 100 }), /timed out/i);
  });

  it('rejects on invalid URL', async () => {
    await assert.rejects(() => httpGet('not-a-url'), /Invalid URL/);
  });

  it('rejects on too many redirects', async () => {
    const url = await createServer((_req, res) => {
      res.writeHead(302, { Location: '/' });
      res.end();
    });

    await assert.rejects(() => httpGet(url, { maxRedirects: 2 }), /redirect/i);
  });

  it('follows 303 redirects', async () => {
    let requestCount = 0;
    const url = await createServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        res.writeHead(303, { Location: '/final' });
        res.end();
      } else {
        res.writeHead(200);
        res.end('see other content');
      }
    });

    const result = await httpGet(url);
    assert.equal(result.body, 'see other content');
  });

  it('sends custom request headers', async () => {
    let seenAuth: string | undefined;
    const url = await createServer((req, res) => {
      seenAuth = req.headers['authorization'];
      res.writeHead(200);
      res.end('ok');
    });

    await httpGet(url, { headers: { Authorization: 'Bearer token-123' } });
    assert.equal(seenAuth, 'Bearer token-123');
  });

  it('keeps auth headers on same-origin redirects', async () => {
    const seenAuth: Array<string | undefined> = [];
    const url = await createServer((req, res) => {
      seenAuth.push(req.headers['authorization']);
      if (seenAuth.length === 1) {
        res.writeHead(302, { Location: '/final' });
        res.end();
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });

    await httpGet(url, { headers: { Authorization: 'Bearer token-123' } });
    assert.deepStrictEqual(seenAuth, ['Bearer token-123', 'Bearer token-123']);
  });

  it('drops auth headers on cross-origin redirects but keeps the rest', async () => {
    // Second server = a different origin (different port)
    let targetHeaders: Record<string, string | string[] | undefined> = {};
    const targetServer = http.createServer((req, res) => {
      targetHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });
    const targetUrl = await new Promise<string>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        const addr = targetServer.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}/final`);
      });
    });

    try {
      const url = await createServer((_req, res) => {
        res.writeHead(302, { Location: targetUrl });
        res.end();
      });

      await httpGet(url, {
        headers: { Authorization: 'Bearer secret', Cookie: 'sid=1', 'X-Custom': 'kept' },
      });

      assert.equal(targetHeaders['authorization'], undefined);
      assert.equal(targetHeaders['cookie'], undefined);
      assert.equal(targetHeaders['x-custom'], 'kept');
    } finally {
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  });
});

describe('httpGet TLS options', () => {
  let certDir: string;
  let caCert: Buffer;
  let serverCert: Buffer;
  let serverKey: Buffer;
  let clientCert: Buffer;
  let clientKey: Buffer;

  before(() => {
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-certs-'));
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

  it('rejects a self-signed server cert when no CA is provided', async () => {
    const url = await createHttpsServer({ cert: serverCert, key: serverKey }, (_req, res) => {
      res.writeHead(200);
      res.end('secret');
    });

    await assert.rejects(() => httpGet(url), /certificate|self.signed/i);
  });

  it('trusts the server when a matching custom CA is provided', async () => {
    const url = await createHttpsServer({ cert: serverCert, key: serverKey }, (_req, res) => {
      res.writeHead(200);
      res.end('secret');
    });

    const result = await httpGet(url, { tls: { ca: caCert } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'secret');
  });

  it('rejects when the server requires a client certificate and none is sent', async () => {
    const url = await createHttpsServer(
      { cert: serverCert, key: serverKey, ca: caCert, requestCert: true, rejectUnauthorized: true },
      (_req, res) => {
        res.writeHead(200);
        res.end('secret');
      },
    );

    await assert.rejects(() => httpGet(url, { tls: { ca: caCert } }));
  });

  it('sends a client certificate for mutual TLS', async () => {
    const url = await createHttpsServer(
      { cert: serverCert, key: serverKey, ca: caCert, requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        const socket = req.socket as import('tls').TLSSocket;
        res.writeHead(200);
        res.end(socket.authorized ? 'authorized' : 'unauthorized');
      },
    );

    const result = await httpGet(url, {
      tls: { ca: caCert, cert: clientCert, key: clientKey },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'authorized');
  });
});
