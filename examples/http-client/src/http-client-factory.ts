import { HttpClient } from './lib/http-client';
import { HttpAdapter } from './lib/models';
import { FetchHttpAdapter } from './fetch-http-adapter';

export class HttpClientFactory {
  static create(adapter?: HttpAdapter): HttpClient {
    return new HttpClient(adapter ?? new FetchHttpAdapter());
  }

  static createWithBaseURL(baseURL: string): HttpClient {
    return new HttpClient(new FetchHttpAdapter(baseURL));
  }
}
