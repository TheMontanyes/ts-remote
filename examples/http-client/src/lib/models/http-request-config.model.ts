export interface HttpRequestConfig<Data = unknown> {
  url?: string;
  method?: string;
  baseURL?: string;
  data?: Data;
  params?: Record<string, unknown>;
  headers?: Headers;
  timeout?: number;
  signal?: AbortSignal;
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer' | 'document' | 'stream' | 'formdata';
  withCredentials?: boolean;
  maxRedirects?: number;
  validateStatus?: (status: number) => boolean;
}

export interface HttpInternalRequestConfig<Data = unknown> extends HttpRequestConfig<Data> {
  headers: Headers;
  validateStatus: (status: number) => boolean;
}
