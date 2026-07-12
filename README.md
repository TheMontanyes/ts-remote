# ts-remote

[![npm version](https://badge.fury.io/js/ts-remote.svg)](https://www.npmjs.com/package/ts-remote)

**Share TypeScript types between independently deployed applications.**

`ts-remote` bundles your TypeScript source into a single ambient `.d.ts` file, publishes it like any other static asset, and lets consuming projects resolve those types at design time — without importing the runtime code, without a shared monorepo, and without publishing a package to npm.

It's built for **microfrontend** and **multi-repo** architectures, where each app is deployed on its own but still needs to agree on the shape of the data and APIs they exchange.

---

## How it works

```
┌─────────────────┐     build      ┌──────────────┐    serve     ┌──────────────────┐
│  Producer app   │  ──────────▶   │  types.d.ts  │  ─────────▶  │   CDN / static   │
│  (TS source)    │   (builder)    │  (ambient)   │              │     hosting      │
└─────────────────┘                └──────────────┘              └────────┬─────────┘
                                                                          │ fetch
                                                                          ▼
                                              ┌──────────────────────────────────────┐
                                              │            Consumer app               │
                                              │  ts-remote fetch  →  local cache       │
                                              │  TS plugin        →  resolves imports  │
                                              └──────────────────────────────────────┘
```

1. **Producer** runs the **builder** to emit a consolidated `declare module "..."` file from its source.
2. The `.d.ts` is **served** over HTTP(S) — a CDN, object storage, or any static host.
3. **Consumer** runs the **fetcher** (CLI or API) to download and cache it, and the **TS Language Service plugin** patches module resolution so `import { User } from "my-app"` type-checks against the remote types.

The three pieces are independent — use only what you need.

---

## Installation

```bash
npm install -D ts-remote
```

Each part has its own entry point:

| Import | Used by | Purpose |
|--------|---------|---------|
| `ts-remote/builder` | Producer | Generate the `.d.ts` bundle |
| `ts-remote/fetcher` | Consumer | Download & cache remote `.d.ts` (programmatic) |
| `ts-remote/plugin`  | Consumer | Resolve remote modules in the editor / `tsc` |
| `ts-remote` (CLI)   | Consumer | `ts-remote fetch` |

---

## Producer: building types

```typescript
import build from 'ts-remote/builder';

await build({
  entries: [
    { name: 'my-app', filename: './src/index.ts' },
    { name: 'utils', filename: './src/utils.ts' },
  ],
  output: {
    filename: './dist/types.d.ts',
  },
});
```

`./src/index.ts`:

```typescript
export interface User {
  id: string;
  name: string;
}

export function getUser(id: string): Promise<User>;
```

Generated `./dist/types.d.ts`:

```typescript
declare module "my-app" {
  export interface User {
    id: string;
    name: string;
  }
  export function getUser(id: string): Promise<User>;
}

declare module "utils" {
  export function formatDate(date: Date): string;
}
```

The output is a self-contained ambient declaration: imports of local files are inlined, private/protected members are stripped, and internal name collisions are de-duplicated. Publish `dist/types.d.ts` wherever your consumers can reach it over HTTP(S).

### Formatting the output

`output.format` receives the generated string and returns the final contents — handy for running it through Prettier:

```typescript
import build from 'ts-remote/builder';
import prettier from 'prettier';

await build({
  entries: [{ name: 'my-app', filename: './src/index.ts' }],
  output: {
    filename: './dist/types.d.ts',
    format: (code) => prettier.format(code, { parser: 'typescript' }),
  },
});
```

### Module vs. Namespace

By default each entry becomes a `declare module "name"`. Pass `DeclarationVariant.Namespace` to emit a `declare namespace` instead — useful for ambient globals rather than importable modules:

```typescript
import build, { DeclarationVariant } from 'ts-remote/builder';

await build({
  entries: [
    { name: 'MyLib', filename: './src/index.ts', variant: DeclarationVariant.Namespace },
  ],
});
```

```typescript
declare namespace MyLib {
  export interface Config { /* ... */ }
}
```

### `build(options: BuilderOptions): Promise<void>`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `entries` | `DeclarationEntry[]` | — | Modules to compile (**required**) |
| `output.filename` | `string` | `@types/types.d.ts` | Output file path |
| `output.format` | `(result: string) => string \| Promise<string>` | `(x) => x` | Post-processor for the output (e.g. Prettier) |
| `tsconfig` | `string` | `tsconfig.json` | Path to the producer's tsconfig |
| `additionalDeclarations` | `string[]` | `[]` | Extra `.d.ts` files to include for ambient context / concatenation |

```typescript
type DeclarationEntry = {
  name: string;                 // the module name used in `declare module "name"`
  filename: string;             // entry source file
  variant?: DeclarationVariant; // Module (default) | Namespace
};
```

---

## Consumer: fetching types

Point the consumer at the published `.d.ts` files. Configure remotes once in the consumer's `tsconfig.json` (used by both the CLI and the editor plugin):

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-remote",
        "remotes": {
          "my-app": "https://cdn.example.com/my-app/types.d.ts",
          "@shared/ui": "https://cdn.example.com/shared-ui/types.d.ts"
        },
        "cacheDir": "node_modules/.ts-remote",
        "cacheTTL": 300000,
        "tls": {
          "ca": "./certs/internal-ca.pem",
          "cert": "./certs/client-cert.pem",
          "key": "./certs/client-key.pem"
        },
        "headers": {
          "Authorization": "Bearer ${TYPES_REGISTRY_TOKEN}"
        }
      }
    ]
  }
}
```

`tls` is optional and only needed if a remote requires a client certificate (mutual TLS) or a self-signed/internal CA that Node doesn't trust by default:

| Property | Type | Description |
|----------|------|--------------|
| `tls.ca` | `string` | Path to a trusted CA certificate, relative to this tsconfig |
| `tls.cert` / `tls.key` | `string` | Path to a client certificate/key for mutual TLS |
| `tls.pfx` | `string` | Path to a PKCS#12 bundle, as an alternative to `cert`/`key` |
| `tls.passphrase` | `string` | Passphrase for `key` or `pfx` |
| `tls.rejectUnauthorized` | `boolean` | Verify the server's certificate (`true` by default) |

`headers` is optional and adds request headers, e.g. a token for a private host. Values may reference environment variables as `${VAR_NAME}` — resolved at fetch time, so secrets stay out of the committed tsconfig (an unset variable is an error). `Authorization`, `Cookie` and `Proxy-Authorization` are automatically dropped if a redirect leaves the original origin.

### CLI

Download every configured remote into the local cache:

```bash
ts-remote fetch
```

| Flag | Default | Description |
|------|---------|-------------|
| `--config <path>` | `./tsconfig.json` | Path to the tsconfig holding the `ts-remote` plugin config |
| `--cache-dir <path>` | `node_modules/.ts-remote/` | Where cached `.d.ts` files are written |
| `--force` | `false` | Re-fetch all remotes, ignoring the cache TTL. Also disables the stale-cache fallback: fresh types or a hard failure |
| `--help` | — | Show usage |

If a remote is temporarily unreachable and an expired copy exists in the cache, `fetch` (without `--force`) logs a warning and keeps the stale copy instead of failing — so a flaky CDN doesn't break `postinstall` or CI.

Run it in a `postinstall` script or in CI before `tsc` so the cache is warm:

```jsonc
{
  "scripts": {
    "postinstall": "ts-remote fetch"
  }
}
```

### Programmatic fetcher

The CLI is a thin wrapper over the fetcher API, which you can call directly:

```typescript
import fetch from 'ts-remote/fetcher';

const results = await fetch({
  remotes: {
    'my-app': 'https://cdn.example.com/my-app/types.d.ts',
  },
});

console.log(results[0].cachedPath); // node_modules/.ts-remote/my-app.d.ts
console.log(results[0].fromCache);  // false on first run, true while within TTL
```

`FetcherOptions`:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `remotes` | `Record<string, string>` | — | Map of module name → `.d.ts` URL (**required**) |
| `cacheDir` | `string` | `node_modules/.ts-remote` | Cache directory |
| `cacheTTL` | `number` | `300000` (5 min) | Cache lifetime in ms. `0` = always re-fetch, `Infinity` = never |
| `retries` | `number` | `2` | Retry attempts on network failure (4xx is not retried) |
| `timeout` | `number` | `10000` | Per-request timeout in ms |
| `maxRedirects` | `number` | `5` | Maximum redirects to follow per request |
| `logLevel` | `LogLevel` | `Info` | Verbosity |
| `tls` | `TlsOptions` | — | Client cert, custom CA, etc — forwarded to Node's `https` client |
| `headers` | `Record<string, string>` | — | Extra request headers (e.g. `Authorization`); credentials are dropped on cross-origin redirects |
| `staleIfError` | `boolean` | `true` | On fetch failure, fall back to an expired cached copy (with a warning) instead of throwing |

Each `FetchResult` is `{ name, url, cachedPath, fromCache, stale? }` — `stale: true` marks a result served from expired cache because the fetch failed.

Remotes are fetched in parallel. When an expired cache entry has an `ETag` from the server, the re-fetch is conditional (`If-None-Match`): a `304 Not Modified` revalidates the cached copy without re-downloading. Responses that are empty or look like an HTML error page are rejected rather than cached.

Calling the fetcher directly (rather than through the `tsconfig.json` plugin config) is the same escape hatch used above, except `tls.ca`/`cert`/`key`/`pfx` take the certificate content itself (`string | Buffer`), not a file path — read the file yourself:

```typescript
import fs from 'node:fs';
import fetch from 'ts-remote/fetcher';

const results = await fetch({
  remotes: {
    'my-app': 'https://internal.example.com/my-app/types.d.ts',
  },
  tls: {
    ca: fs.readFileSync('./certs/internal-ca.pem'),
    cert: fs.readFileSync('./certs/client-cert.pem'),
    key: fs.readFileSync('./certs/client-key.pem'),
  },
});
```

### Editor & build-time resolution (plugin)

The `ts-remote` plugin is a [TypeScript Language Service Plugin](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin). With the `tsconfig.json` above in place, your editor resolves remote imports against the cached declarations:

```typescript
import { User, getUser } from 'my-app'; // ✅ typed from the remote .d.ts
```

> **Editor note:** Language Service Plugins run inside the TypeScript server your editor ships with. In VS Code, select **"Use Workspace Version"** of TypeScript so the plugin is loaded. On startup the plugin loads types from the cache populated by `ts-remote fetch` — so fetch first — and then refreshes stale or missing remotes in the background, honoring the same `remotes`, `cacheDir`, `cacheTTL`, `tls` and `headers` settings.

---

## End-to-end example

**Producer** (`shared-types` app) publishes its contracts:

```typescript
// build.ts — run on deploy, upload dist/types.d.ts to your CDN
import build from 'ts-remote/builder';

await build({
  entries: [{ name: '@acme/orders', filename: './src/public-api.ts' }],
  output: { filename: './dist/types.d.ts' },
});
```

**Consumer** (`checkout` app) opts in:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-remote",
        "remotes": { "@acme/orders": "https://cdn.acme.dev/orders/types.d.ts" }
      }
    ]
  }
}
```

```bash
ts-remote fetch        # warm the cache
```

```typescript
// checkout/src/cart.ts
import type { Order } from '@acme/orders'; // resolved from the fetched .d.ts

function total(order: Order): number { /* ... */ }
```

See [`examples/`](./examples/README.md) for runnable builder examples, including the [`http-client`](./examples/http-client) abstraction.

---

## Requirements

- TypeScript >= 4.9
- Node.js >= 18

## Links

- [Examples](./examples/README.md)
- [Migration from v1.x](./MIGRATION.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

MIT © Denis Arkhipov
