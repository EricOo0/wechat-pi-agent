export interface MetricsQuery {
  readonly registry: { readonly contentType: string };
  metrics(): Promise<string>;
}
