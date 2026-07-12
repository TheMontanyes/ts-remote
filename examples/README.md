# ts-remote Examples

This directory contains example projects demonstrating different use cases of ts-remote.

## Available Examples

### [basic/](./basic/)
**Basic module declarations**

Demonstrates the most common usage pattern with multiple modules.

- Multiple entry points
- Module variant (default)
- Typical microfrontend setup

```bash
ts-node examples/basic/build.ts
```

### [namespace/](./namespace/)
**Namespace declarations**

Shows how to generate namespace-style declarations for libraries.

- Single entry point
- Namespace variant
- Global/CDN library pattern

```bash
ts-node examples/namespace/build.ts
```

### [comprehensive/](./comprehensive/)
**Comprehensive TypeScript syntax coverage**

Test suite covering all possible TypeScript constructs and SyntaxKind nodes.

- All declaration types (variables, functions, classes)
- All type forms (interfaces, type aliases, enums)
- Advanced types (conditional, mapped, template literal)
- Generics with constraints
- All modifiers (access control, readonly, async, static)
- Perfect for testing and validation

```bash
ts-node examples/comprehensive/build.ts
```

### [name-collisions/](./name-collisions/)
**Automatic name collision resolution**

Demonstrates how ts-remote handles duplicate type names from different source files.

- Automatic renaming of internal types
- Reference updates across modules

```bash
ts-node examples/name-collisions/build.ts
```

### [http-client/](./http-client/)
**Real-world HTTP client abstraction**

An `HttpClient` over a pluggable adapter with interceptors and typed models, built on the platform `fetch` — no external libraries. Doubles as a regression case for the `class X {} ... export { X }` emit bug.

- Layered module structure (models, adapter, factory, barrel)
- Classes exported via standalone `export { X }` statements

```bash
ts-node examples/http-client/build.ts
```

## Running All Examples

```bash
# From project root
ts-node examples/basic/build.ts
ts-node examples/namespace/build.ts
ts-node examples/comprehensive/build.ts
ts-node examples/name-collisions/build.ts
ts-node examples/http-client/build.ts
```

## Creating Your Own

To create a new project using ts-remote:

1. Install the package:
```bash
npm install -D ts-remote
```

2. Create a build script:
```typescript
import build from 'ts-remote/builder';

await build({
  entries: [
    { name: 'my-module', filename: './src/index.ts' },
  ],
  output: {
    filename: './dist/types.d.ts',
  },
});
```

3. Run the build:
```bash
ts-node build.ts
```

## Common Patterns

### Microfrontend Architecture

```typescript
await build({
  entries: [
    { name: '@app/core', filename: './packages/core/src/index.ts' },
    { name: '@app/auth', filename: './packages/auth/src/index.ts' },
    { name: '@app/ui', filename: './packages/ui/src/index.ts' },
  ],
  output: {
    filename: './dist/federated-types.d.ts',
  },
});
```

### With Prettier Formatting

```typescript
import build from 'ts-remote/builder';
import prettier from 'prettier';

await build({
  entries: [{ name: 'my-app', filename: './src/index.ts' }],
  output: {
    filename: './dist/types.d.ts',
    format: (result) => prettier.format(result, { parser: 'typescript' }),
  },
});
```

### With Custom TypeScript Config

```typescript
await build({
  entries: [{ name: 'my-app', filename: './src/index.ts' }],
  tsconfig: './tsconfig.build.json',
  output: {
    filename: './dist/types.d.ts',
  },
});
```

### With Global Declarations

If the source relies on global ambient types (e.g. a `Window` augmentation), pass the `.d.ts` via `additionalDeclarations` — it feeds the compilation **and** is concatenated into the output, so consumers receive the globals too:

```typescript
// src/global.d.ts
interface Bar { baz: string; }
interface Window { foo: Bar; }

// src/get-bar.ts
export const getBar = () => window.foo;
```

```typescript
await build({
  entries: [{ name: 'my-app', filename: './src/get-bar.ts' }],
  additionalDeclarations: ['./src/global.d.ts'],
  output: {
    filename: './dist/types.d.ts',
  },
});
```

Use `{ filename, emit: false }` for environment-only declarations — visible to the compiler, but not shipped in the output. Note that concatenated files must be in script form (no top-level `import`/`export`, so no `export {}` + `declare global` pattern) — the builder rejects module-form files with a clear error.
