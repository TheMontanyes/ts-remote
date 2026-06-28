import { HttpClientFactory } from './http-client-factory';

/**
 * Ready-to-use HTTP client instance backed by the `fetch` adapter.
 */
export const http = HttpClientFactory.create();
