# HTTP Client Example

This example mirrors a real-world `src/infrastructure/http` module — an
`HttpClient` abstraction over a pluggable adapter, interceptors, and typed
request/response/error models. The adapter is implemented on top of the
platform `fetch` API, so the example pulls in **no external libraries** (no
axios).

It also serves as a **regression case** for a bug where a class exported via the
`class X {} ... export { X }` pattern was emitted as a *type reference only* —
the `class X { ... }` declaration itself was dropped from the generated `.d.ts`.

## Files

- `src/lib/http-client.ts` — the `HttpClient` class (declared, then `export { HttpClient }`)
- `src/lib/request-abort-controller.ts` — request cancellation helper
- `src/lib/models/` — `HttpResponse`, `HttpError`, `HttpRequestConfig`, `HttpAdapter`, interceptor models
- `src/fetch-http-adapter.ts` — `fetch`-based `HttpAdapter` implementation
- `src/fetch-interceptor-manager.ts` — array-backed interceptor manager
- `src/http-client-factory.ts` — `HttpClientFactory`
- `src/http.ts` — ready-to-use `http` instance
- `src/index.ts` — public barrel (re-exports `HttpClient` and friends)
- `build.ts` — generates `dist/http-client.d.ts`

## Running the Example

```bash
# From the project root
npx ts-node --transpileOnly --compiler-options '{"module":"commonjs","moduleResolution":"node10"}' examples/http-client/build.ts
```

## Expected Output

The generated `dist/http-client.d.ts` declares a single ambient module that
contains the **full `class HttpClient` declaration** (not just a reference):

```typescript
declare module "@infra/http" {
  class HttpClient {
    readonly interceptorManager: HttpInterceptorManager;
    constructor(httpAdapter: HttpAdapter);
    get<T = unknown, R = HttpResponse<T>, D = unknown>(
      url: string,
      config?: HttpRequestConfig<D>,
    ): Promise<R>;
    // ...the rest of the public surface...
  }
  class HttpClientFactory {
    static create(adapter?: HttpAdapter): HttpClient;
  }
  const http: HttpClient;
  export { HttpClient, HttpClientFactory, http /* ...types... */ };
}
```

## Why the `export { X }` pattern matters

When a declaration is exported indirectly:

```typescript
class HttpClient { /* ... */ }
export { HttpClient };
```

the builder must recognise that `HttpClient` is the real exported symbol. Before
the fix, the collision resolver only looked for an inline `export` modifier on
the declaration, mistook this class for an internal name colliding with the
re-exported `HttpClient`, renamed it to `HttpClient_1`, and then dropped it as
unused — leaving the class referenced only as a type.
