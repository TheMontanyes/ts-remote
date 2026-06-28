import { HttpInternalRequestConfig } from './http-request-config.model';
import { HttpResponse } from './http-response.model';

export class HttpError<T = unknown> extends Error {
  constructor(
    message?: string,
    public readonly status?: number,
    public readonly config?: HttpInternalRequestConfig<T>,
    public readonly response?: HttpResponse<T>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
