import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readPluginConfig, validateRemotes } from '../config';

function createTempTsconfig(config: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-test-'));
  const filePath = path.join(dir, 'tsconfig.json');
  fs.writeFileSync(filePath, JSON.stringify(config));
  return filePath;
}

describe('validateRemotes', () => {
  it('accepts valid remotes', () => {
    assert.doesNotThrow(() => {
      validateRemotes({ 'my-app': 'https://cdn.example.com/types.d.ts' });
    });
  });

  it('throws on empty remotes', () => {
    assert.throws(() => validateRemotes({}), /empty/);
  });

  it('throws on invalid URL', () => {
    assert.throws(() => validateRemotes({ app: 'not-a-url' }), /Invalid URL/);
  });

  it('throws on non-http URL', () => {
    assert.throws(() => validateRemotes({ app: 'ftp://example.com/types.d.ts' }), /http/);
  });

  it('accepts http URLs', () => {
    assert.doesNotThrow(() => {
      validateRemotes({ app: 'http://localhost:3000/types.d.ts' });
    });
  });
});

describe('readPluginConfig', () => {
  it('reads valid config from tsconfig.json', () => {
    const filePath = createTempTsconfig({
      compilerOptions: {
        plugins: [
          {
            name: 'ts-remote',
            remotes: { 'my-app': 'https://cdn.example.com/types.d.ts' },
          },
        ],
      },
    });

    const config = readPluginConfig(filePath);
    assert.equal(config.name, 'ts-remote');
    assert.deepStrictEqual(config.remotes, { 'my-app': 'https://cdn.example.com/types.d.ts' });
  });

  it('reads optional cacheDir and cacheTTL', () => {
    const filePath = createTempTsconfig({
      compilerOptions: {
        plugins: [
          {
            name: 'ts-remote',
            remotes: { app: 'https://cdn.example.com/types.d.ts' },
            cacheDir: '.cache',
            cacheTTL: 60000,
          },
        ],
      },
    });

    const config = readPluginConfig(filePath);
    assert.equal(config.cacheDir, '.cache');
    assert.equal(config.cacheTTL, 60000);
  });

  it('throws when no plugins configured', () => {
    const filePath = createTempTsconfig({ compilerOptions: {} });
    assert.throws(() => readPluginConfig(filePath), /No plugins/);
  });

  it('throws when ts-remote plugin not found', () => {
    const filePath = createTempTsconfig({
      compilerOptions: {
        plugins: [{ name: 'other-plugin' }],
      },
    });
    assert.throws(() => readPluginConfig(filePath), /not found/);
  });

  it('throws when remotes field is missing', () => {
    const filePath = createTempTsconfig({
      compilerOptions: {
        plugins: [{ name: 'ts-remote' }],
      },
    });
    assert.throws(() => readPluginConfig(filePath), /missing.*remotes/i);
  });

  it('throws when tsconfig does not exist', () => {
    assert.throws(() => readPluginConfig('/nonexistent/tsconfig.json'), /Failed to read/);
  });

  describe('tls', () => {
    it('reads cert/key/ca file paths relative to the tsconfig directory', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-test-'));
      fs.writeFileSync(path.join(dir, 'ca.pem'), 'ca-content');
      fs.writeFileSync(path.join(dir, 'client-cert.pem'), 'cert-content');
      fs.writeFileSync(path.join(dir, 'client-key.pem'), 'key-content');

      const filePath = path.join(dir, 'tsconfig.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          compilerOptions: {
            plugins: [
              {
                name: 'ts-remote',
                remotes: { app: 'https://cdn.example.com/types.d.ts' },
                tls: {
                  ca: './ca.pem',
                  cert: './client-cert.pem',
                  key: './client-key.pem',
                  passphrase: 'secret',
                  rejectUnauthorized: false,
                },
              },
            ],
          },
        }),
      );

      const config = readPluginConfig(filePath);
      assert.ok(config.tls);
      assert.equal(config.tls?.ca?.toString(), 'ca-content');
      assert.equal(config.tls?.cert?.toString(), 'cert-content');
      assert.equal(config.tls?.key?.toString(), 'key-content');
      assert.equal(config.tls?.passphrase, 'secret');
      assert.equal(config.tls?.rejectUnauthorized, false);
    });

    it('throws when a tls file does not exist', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
              tls: { ca: './missing-ca.pem' },
            },
          ],
        },
      });

      assert.throws(() => readPluginConfig(filePath), /Failed to read "tls\.ca"/);
    });

    it('throws when tls.passphrase is not a string', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
              tls: { passphrase: 123 },
            },
          ],
        },
      });

      assert.throws(() => readPluginConfig(filePath), /Invalid "tls\.passphrase"/);
    });

    it('omits tls when not configured', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
            },
          ],
        },
      });

      const config = readPluginConfig(filePath);
      assert.equal(config.tls, undefined);
    });
  });

  describe('headers', () => {
    it('reads plain header values', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
              headers: { 'X-Team': 'checkout' },
            },
          ],
        },
      });

      const config = readPluginConfig(filePath);
      assert.deepStrictEqual(config.headers, { 'X-Team': 'checkout' });
    });

    it('substitutes ${VAR} references from the environment', () => {
      process.env['TS_REMOTE_TEST_TOKEN'] = 'secret-token';

      try {
        const filePath = createTempTsconfig({
          compilerOptions: {
            plugins: [
              {
                name: 'ts-remote',
                remotes: { app: 'https://cdn.example.com/types.d.ts' },
                headers: { Authorization: 'Bearer ${TS_REMOTE_TEST_TOKEN}' },
              },
            ],
          },
        });

        const config = readPluginConfig(filePath);
        assert.deepStrictEqual(config.headers, { Authorization: 'Bearer secret-token' });
      } finally {
        delete process.env['TS_REMOTE_TEST_TOKEN'];
      }
    });

    it('throws when a referenced environment variable is not set', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
              headers: { Authorization: 'Bearer ${TS_REMOTE_UNSET_VAR}' },
            },
          ],
        },
      });

      assert.throws(() => readPluginConfig(filePath), /TS_REMOTE_UNSET_VAR.*not set/);
    });

    it('throws when a header value is not a string', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
              headers: { 'X-Retry': 3 },
            },
          ],
        },
      });

      assert.throws(() => readPluginConfig(filePath), /Invalid "headers\.X-Retry"/);
    });

    it('omits headers when not configured', () => {
      const filePath = createTempTsconfig({
        compilerOptions: {
          plugins: [
            {
              name: 'ts-remote',
              remotes: { app: 'https://cdn.example.com/types.d.ts' },
            },
          ],
        },
      });

      const config = readPluginConfig(filePath);
      assert.equal(config.headers, undefined);
    });
  });
});
