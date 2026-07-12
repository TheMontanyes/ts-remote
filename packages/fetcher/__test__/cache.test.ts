import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CacheManager } from '../cache';
import { Logger, LogLevel } from '../../shared/logger';

let tmpDir: string;
let logger: Logger;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-remote-cache-'));
  logger = new Logger(LogLevel.Silent);
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('CacheManager', () => {
  beforeEach(setup);
  afterEach(cleanup);

  describe('set / get', () => {
    it('writes a file and retrieves it from cache', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'declare module "my-app" {}');

      assert.ok(fs.existsSync(entry.filePath));
      assert.equal(fs.readFileSync(entry.filePath, 'utf-8'), 'declare module "my-app" {}');

      const cached = cache.get('my-app', Infinity);
      assert.ok(cached);
      assert.equal(cached!.filePath, entry.filePath);
    });

    it('returns null for nonexistent entry', () => {
      const cache = new CacheManager(tmpDir, logger);
      assert.equal(cache.get('nonexistent', Infinity), null);
    });

    it('returns null when TTL expired', async () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('my-app', 'content');

      // Wait a bit so the entry becomes older than TTL=1ms
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(cache.get('my-app', 1), null);
    });

    it('returns null when TTL is 0 (force re-fetch)', () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('my-app', 'content');

      assert.equal(cache.get('my-app', 0), null);
    });

    it('returns entry when TTL is Infinity', () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('my-app', 'content');

      const cached = cache.get('my-app', Infinity);
      assert.ok(cached);
    });

    it('returns null when cached file is deleted from disk', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'content');
      fs.unlinkSync(entry.filePath);

      assert.equal(cache.get('my-app', Infinity), null);
    });
  });

  describe('getStale', () => {
    it('returns an entry even when TTL has expired', async () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'content');

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(cache.get('my-app', 1), null);

      const stale = cache.getStale('my-app');
      assert.ok(stale);
      assert.equal(stale!.filePath, entry.filePath);
    });

    it('returns null when the file is deleted from disk', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'content');
      fs.unlinkSync(entry.filePath);

      assert.equal(cache.getStale('my-app'), null);
    });

    it('returns null for nonexistent entry', () => {
      const cache = new CacheManager(tmpDir, logger);
      assert.equal(cache.getStale('nonexistent'), null);
    });
  });

  describe('touch', () => {
    it('revalidates an expired entry without rewriting content', async () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('my-app', 'content');

      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(cache.get('my-app', 5), null);

      const touched = cache.touch('my-app');
      assert.ok(touched);

      const fresh = cache.get('my-app', 5);
      assert.ok(fresh);
      assert.equal(fs.readFileSync(fresh!.filePath, 'utf-8'), 'content');
    });

    it('returns null for nonexistent entry', () => {
      const cache = new CacheManager(tmpDir, logger);
      assert.equal(cache.touch('nonexistent'), null);
    });
  });

  describe('sanitizeFileName', () => {
    it('handles scoped package names', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('@scope/name', 'content');

      assert.ok(entry.filePath.includes('scope__name.d.ts'));
    });

    it('handles slashes in names', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('a/b/c', 'content');

      assert.ok(entry.filePath.includes('a__b__c.d.ts'));
    });
  });

  describe('remove', () => {
    it('removes a cached entry and its file', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'content');
      assert.ok(fs.existsSync(entry.filePath));

      cache.remove('my-app');
      assert.ok(!fs.existsSync(entry.filePath));
      assert.equal(cache.get('my-app', Infinity), null);
    });

    it('does nothing for nonexistent entry', () => {
      const cache = new CacheManager(tmpDir, logger);
      assert.doesNotThrow(() => cache.remove('nonexistent'));
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('app-a', 'content-a');
      cache.set('app-b', 'content-b');

      cache.clear();
      assert.equal(cache.get('app-a', Infinity), null);
      assert.equal(cache.get('app-b', Infinity), null);
      assert.deepStrictEqual(cache.entries(), {});
    });
  });

  describe('entries', () => {
    it('returns all cached entries', () => {
      const cache = new CacheManager(tmpDir, logger);
      cache.set('app-a', 'content-a');
      cache.set('app-b', 'content-b');

      const entries = cache.entries();
      assert.ok('app-a' in entries);
      assert.ok('app-b' in entries);
    });
  });

  describe('manifest persistence', () => {
    it('survives cache manager restart', () => {
      const cache1 = new CacheManager(tmpDir, logger);
      cache1.set('my-app', 'declare module "my-app" {}');

      // Create a new CacheManager pointing at the same directory
      const cache2 = new CacheManager(tmpDir, logger);
      const cached = cache2.get('my-app', Infinity);
      assert.ok(cached);
      assert.equal(fs.readFileSync(cached!.filePath, 'utf-8'), 'declare module "my-app" {}');
    });
  });

  describe('etag', () => {
    it('stores and retrieves etag', () => {
      const cache = new CacheManager(tmpDir, logger);
      const entry = cache.set('my-app', 'content', '"abc123"');

      assert.equal(entry.etag, '"abc123"');

      const cached = cache.get('my-app', Infinity);
      assert.equal(cached!.etag, '"abc123"');
    });
  });
});
