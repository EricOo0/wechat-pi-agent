export interface TelemetryPort {
  increment(name: string, labels?: Readonly<Record<string, string>>, value?: number): void;
  observe(name: string, value: number, labels?: Readonly<Record<string, string>>): void;
  set(name: string, value: number): void;
}

export const noopTelemetry: TelemetryPort = {
  increment: () => undefined,
  observe: () => undefined,
  set: () => undefined,
};
