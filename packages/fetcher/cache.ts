import fs from 'node:fs';
import path from 'node:path';
import { CacheError } from '../shared/errors';
import { Logger } from '../shared/logger';

export type CacheEntry = {
  /** Absolute path to the cached file */
  filePath: string;
  /** When it was last fetched (epoch ms) */
  fetchedAt: number;
  /** ETag from the server, if provided */
  etag?: string;
};

export type CacheManifest = {
  version: 1;
  entries: Record<string, CacheEntry>;
};

/**
 * Manages a local disk cache for downloaded `.d.ts` files.
 *
 * Stores files in a cache directory with a `manifest.json` tracking metadata.
 * Supports TTL-based invalidation and atomic writes.
 */
export class CacheManager {
  #cacheDir: string;
  #manifestPath: string;
  #manifest: CacheManifest;
  #logger: Logger;

  constructor(cacheDir: string, logger: Logger) {
    this.#cacheDir = path.resolve(cacheDir);
    this.#manifestPath = path.join(this.#cacheDir, 'manifest.json');
    this.#logger = logger;
    this.#manifest = this.loadManifest();
  }

  /**
   * Get a cached entry if it exists and is within TTL.
   * Returns `null` if the entry doesn't exist, the file is missing, or TTL has expired.
   */
  get(name: string, ttl: number): CacheEntry | null {
    const entry = this.getStale(name);

    if (!entry) {
      return null;
    }

    // Check TTL (0 means always re-fetch)
    if (ttl === 0 || Date.now() - entry.fetchedAt > ttl) {
      this.#logger.debug(`Cache expired for "${name}"`);
      return null;
    }

    return entry;
  }

  /**
   * Get a cached entry regardless of TTL, as long as its file still exists.
   * Used for conditional revalidation (`If-None-Match`) and stale-if-error fallback.
   */
  getStale(name: string): CacheEntry | null {
    const entry = this.#manifest.entries[name];

    if (!entry) {
      return null;
    }

    // Check if cached file still exists on disk
    if (!fs.existsSync(entry.filePath)) {
      this.#logger.debug(`Cache file missing for "${name}": ${entry.filePath}`);
      delete this.#manifest.entries[name];
      this.saveManifest();
      return null;
    }

    return entry;
  }

  /**
   * Reset an entry's `fetchedAt` to now without rewriting its content,
   * e.g. after the server confirmed it via `304 Not Modified`.
   */
  touch(name: string): CacheEntry | null {
    const entry = this.#manifest.entries[name];

    if (!entry) {
      return null;
    }

    entry.fetchedAt = Date.now();
    this.saveManifest();

    return entry;
  }

  /**
   * Write a fetched `.d.ts` to disk and update the manifest.
   * Uses atomic write (temp file + rename) to prevent partial reads.
   */
  set(name: string, content: string, etag?: string): CacheEntry {
    this.ensureCacheDir();

    const fileName = this.sanitizeFileName(name) + '.d.ts';
    const filePath = path.join(this.#cacheDir, fileName);
    const tmpPath = filePath + '.tmp';

    try {
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      // Clean up temp file on failure
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
      throw new CacheError(`Failed to write cache file for "${name}": ${filePath}`, {
        name,
        filePath,
        cause: err,
      });
    }

    const entry: CacheEntry = {
      filePath,
      fetchedAt: Date.now(),
      etag,
    };

    this.#manifest.entries[name] = entry;
    this.saveManifest();

    this.#logger.debug(`Cached "${name}" at ${filePath}`);

    return entry;
  }

  /**
   * Remove a specific entry from the cache.
   */
  remove(name: string): void {
    const entry = this.#manifest.entries[name];

    if (entry) {
      try {
        fs.unlinkSync(entry.filePath);
      } catch {
        // File may already be deleted
      }

      delete this.#manifest.entries[name];
      this.saveManifest();
    }
  }

  /**
   * Remove all cached files and the manifest.
   */
  clear(): void {
    for (const entry of Object.values(this.#manifest.entries)) {
      try {
        fs.unlinkSync(entry.filePath);
      } catch {
        // ignore
      }
    }

    this.#manifest = { version: 1, entries: {} };
    this.saveManifest();
  }

  /**
   * Get all cached entries.
   */
  entries(): Record<string, CacheEntry> {
    return { ...this.#manifest.entries };
  }

  /**
   * Get the cache directory path.
   */
  get cacheDir(): string {
    return this.#cacheDir;
  }

  /**
   * Sanitize a module name into a safe filename.
   * `@scope/name` → `scope__name`, `/` → `__`, other unsafe chars → `_`
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/^@/, '')
      .replace(/\//g, '__')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  }

  /**
   * Read the manifest from disk, or create a fresh one.
   */
  private loadManifest(): CacheManifest {
    try {
      if (fs.existsSync(this.#manifestPath)) {
        const raw = fs.readFileSync(this.#manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as CacheManifest;

        if (parsed.version === 1 && parsed.entries) {
          return parsed;
        }
      }
    } catch {
      this.#logger.debug('Failed to read cache manifest, starting fresh');
    }

    return { version: 1, entries: {} };
  }

  /**
   * Write the manifest to disk atomically.
   */
  private saveManifest(): void {
    this.ensureCacheDir();

    const tmpPath = this.#manifestPath + '.tmp';

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(this.#manifest, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.#manifestPath);
    } catch (err) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
      throw new CacheError('Failed to write cache manifest', { cause: err });
    }
  }

  /**
   * Ensure the cache directory exists.
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.#cacheDir)) {
      fs.mkdirSync(this.#cacheDir, { recursive: true });
    }
  }
}
