# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-07-12

### ✨ Added

- **Fetcher**: Support for TLS options (`ca`, `cert`, `key`, `pfx`, `passphrase`, `rejectUnauthorized`) on `httpGet`/`fetchRemotes`, for remotes that require a client certificate (mutual TLS) or a self-signed/internal CA. Configurable programmatically via `FetcherOptions.tls` (certificate contents as `string | Buffer`) or in `tsconfig.json` via the plugin's `tls` block (`ca`/`cert`/`key`/`pfx` given as file paths, resolved relative to the tsconfig and read into buffers by `readPluginConfig`). The `TlsOptions` type is exported from `ts-remote/fetcher`.
- **Plugin**: The Language Service Plugin's background refresh honors the same `tls` block (paths resolved relative to the project root); a broken `tls` config is logged and skipped rather than taking down the TS server.
- **Fetcher**: Custom request headers via `FetcherOptions.headers` or the plugin's `headers` block in `tsconfig.json`, for remotes behind token auth (private CDNs, artifact registries). Header values in `tsconfig.json` may reference environment variables as `${VAR_NAME}` so secrets aren't committed; `Authorization`/`Cookie`/`Proxy-Authorization` are dropped when a redirect leaves the original origin.
- **Fetcher**: Stale-if-error fallback — when a fetch fails and an expired cached copy exists on disk, the stale copy is used with a warning instead of failing the run. On by default (`staleIfError: true`); `ts-remote fetch --force` disables it (fresh types or a hard failure).
- **Fetcher**: ETag revalidation — the `ETag` stored in the cache manifest (previously unused) is now sent as `If-None-Match` when re-fetching an expired entry, and a `304 Not Modified` refreshes the cache TTL without re-downloading.
- **Fetcher**: Remotes are fetched in parallel; `maxRedirects` is exposed on `FetcherOptions`; `303 See Other` redirects are followed; responses that are empty or look like an HTML error page are rejected instead of being cached as `.d.ts`.
- **Plugin**: The background refresh now shares the fetcher's full pipeline (`fetchOne`) — retries with backoff, ETag revalidation and stale-if-error included — with per-remote error isolation, instead of a single bare HTTP attempt per remote.
- **Packaging**: Declared `"engines": { "node": ">=18" }` in `package.json` (and included it in the published package), backing the Node requirement already stated in the README.
- **Builder**: `additionalDeclarations` now actually concatenates the files into the generated output, as the docs always promised — previously they only fed the compilation environment, so emitted types could reference globals (e.g. a `Window` augmentation) the consumer never received. Content is appended verbatim at the top of the output, before the module blocks, keeping top-level `declare` statements intact.
- **Builder**: `additionalDeclarations` entries can be `{ filename, emit: false }` for environment-only declarations — visible to the compiler while generating types, but not shipped in the output. The `AdditionalDeclaration` type is exported from `ts-remote/builder`.
- **Builder**: `additionalDeclarations` validation — non-`.d.ts` paths are rejected; a missing file fails loudly up front (even in `emit: false` mode, where the compiler would otherwise silently type against an environment that isn't there); a module-form file (top-level `import`/`export`, e.g. `export {}` with `declare global`) is rejected for concatenation with a hint to use script form or `emit: false`, since it would silently turn the whole output into a module and strip its globals.

### 🧪 Tests

- **Builder**: Regression coverage for a `declare global { ... }` block written directly inside an entry module (as opposed to an external `additionalDeclarations` file). This already works — the emitter preserves it as a nested `global {}` augmentation — but the tests pin the behavior, including a real consumer-side type-check proving the augmentation applies and is typed precisely rather than degrading to `any`.

## [2.1.1] - 2026-06-28

### 🐛 Fixed

- **Builder**: A class (or other named declaration) exported via a standalone `export { X }` statement — e.g. `class HttpClient {} ... export { HttpClient }` — was misdetected as an internal name collision, renamed to `X_1`, and then dropped from the generated `.d.ts` as unused. The symbol survived only as a type reference (in factory return types, instances, and the export list) without its class declaration. The collision resolver now recognises declarations exported through a local `export { X }` and exempts them from renaming.

### 🔧 Internal

- **TypeScript 6.0**: Upgraded the dev toolchain to `typescript@6.0.3` and `@types/node@26`. Migrated for the 6.0 breaking changes:
  - Added `"types": ["node"]` to `tsconfig.json` — TS 6.0 no longer auto-discovers `@types/node` through pnpm's symlinked layout.
  - Made the root `tsconfig.json` emit-free (moved `outDir`/`declaration` out of it) and kept an explicit `"rootDir"`, since TS 6.0 errors with `TS5011` when `declaration` is on without one. The publish build (`scripts/build.ts`) now sets `outDir`, `declaration`, and `rootDir: packages` itself, so `dist/` keeps the flat `builder/ fetcher/ plugin/ cli/` layout that `package.json#exports` and the bin wrapper depend on.
  - Set `ignoreDeprecations: "6.0"` for the CommonJS build, which still relies on the now-deprecated `node10` module resolution (removed in TS 7.0).

  The `typescript` peer dependency range (`>=4.9`) is unchanged — consumers on 4.9–6.x remain supported.

- **Builder**: Explicitly disable declaration/source maps (`declarationMap`, `sourceMap`, `inlineSourceMap`, `inlineSources`) when generating bundled `.d.ts`, so a consumer's tsconfig (or TS 6.0 defaults) can't leak `.d.ts.map` files or `sourceMappingURL` comments into the single ambient module output.

### 🧪 Tests

- Added builder regression tests covering inline `export class`, the standalone `export { X }` pattern, classes consumed only as types elsewhere, and that genuine name collisions are still resolved.

### 📚 Examples

- Added `examples/http-client` — an `HttpClient` abstraction (adapter, interceptors, typed models) built on the platform `fetch` with no external dependencies, doubling as a reproduction case for the fix above.

## [2.0.0] - 2026-02-26

### 🚀 Major Rewrite

Version 2.0 is a complete architectural redesign focused on performance, tree-shaking, and developer experience.

### ✨ Added

- **New Builder Architecture**: Complete rewrite with optimized AST processing
- **Fetcher Package**: HTTP client with disk cache, TTL-based invalidation, retry logic (`ts-remote/fetcher`)
- **Plugin Package**: TypeScript Language Service Plugin that patches module resolution for remote types (`ts-remote/plugin`)
- **CLI**: `ts-remote fetch` command for downloading remote `.d.ts` files with `--force`, `--config`, `--cache-dir` flags
- **Tree-Shaking Support**: Efficient module bundling with dead code elimination
- **Namespace Variant**: Support for `declare namespace` declarations via `DeclarationVariant.Namespace`
- **Async Format Support**: `output.format` now accepts `(result: string) => string | Promise<string>`
- **Improved TypeScript Coverage**: Support for more TypeScript constructs:
  - Conditional types
  - Mapped types
  - Template literal types
  - Recursive types
  - Generic constraints
  - Access modifiers (private, protected, public)
  - Static and async modifiers
  - Private fields (both TypeScript `private` and JavaScript `#field`)
- **Shared Cache System**: Reusable module resolution and compiler host caches
- **Better Error Handling**: Structured error classes with detailed information

### 🔄 Changed

- **BREAKING**: API redesigned with improved ergonomics
  - Changed from `compiler()` to `build()` function
  - Import path changed from `ts-remote/compiler` to `ts-remote/builder`
  - Entries format changed from `moduleList: { 'name': 'path' }` to `entries: [{ name, filename, variant }]`
  - Tuple format `['name', { filename }]` replaced with object format `{ name, filename }`
- **Performance**: 3-5x faster build times through:
  - Shared TypeScript compiler host
  - Optimized module resolution cache
  - Single-pass AST transformation
  - Efficient private member filtering

### 🗑️ Removed

- **BREAKING**: Removed `loader` package (replaced by `ts-remote/fetcher` and `ts-remote/plugin`)
- **BREAKING**: Removed `packages/compiler` (replaced by `packages/builder`)

### 📚 Documentation

- Comprehensive README with usage examples
- API reference documentation
- Migration guide from v1.x
- Example projects covering different use cases

### 🔧 Internal

- Migrated to kebab-case file naming convention
- Consolidated utilities into `packages/builder`
- Improved project structure with `packages/shared`
- Added TypeScript strict mode compliance

### 📦 Migration Guide

**Before (v1.x):**
```typescript
import { compiler } from 'ts-remote/compiler';

compiler({
  moduleList: {
    'moduleName': './app/index.ts',
  },
  outDir: './dist',
  outFileName: 'types.d.ts',
});
```

**After (v2.0):**
```typescript
import build from 'ts-remote/builder';

await build({
  entries: [
    { name: 'moduleName', filename: './app/index.ts' },
  ],
  output: {
    filename: './dist/types.d.ts',
  },
});
```

### 💡 Key Benefits of v2.0

1. **Better Performance**: Significantly faster build times with optimized caching
2. **Tree-Shaking**: Smaller output bundles with dead code elimination
3. **More Features**: Support for advanced TypeScript constructs
4. **Improved DX**: Better API ergonomics and error messages
5. **Type Safety**: Stricter TypeScript compliance

---

## [1.x] - Previous versions

See git history for v1.x changes.

[2.0.0]: https://github.com/arkhipovdenis/ts-remote/compare/v1.0.0...v2.0.0
