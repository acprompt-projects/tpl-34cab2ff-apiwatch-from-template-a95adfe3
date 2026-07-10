export interface CheckRule {
  expectedStatus?: number;
  bodyRegex?: string;
  latencyThresholdMs?: number;
}

export interface EndpointConfig {
  id: string;
  url: string;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  intervalSec: number;
  graphql?: { query: string; variables?: Record<string, unknown> };
  rules: CheckRule;
}

export interface CheckResult {
  endpointId: string;
  timestamp: number;
  status: number | null;
  latencyMs: number;
  isUp: boolean;
  violations: string[];
  error?: string;
}

export interface EndpointSummary {
  endpointId: string;
  uptimePct24h: number;
  avgLatencyMs24h: number;
  lastCheck: CheckResult | null;
  totalChecks: number;
  totalFailures: number;
}

export interface ResultStore {
  record(result: CheckResult): Promise<void>;
  getHistory(endpointId: string, since: number): Promise<CheckResult[]>;
  getSummary(endpointId: string): Promise<EndpointSummary>;
  listEndpointIds(): Promise<string[]>;
}