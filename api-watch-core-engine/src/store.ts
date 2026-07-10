import { CheckResult, EndpointSummary, ResultStore } from './types';

export class InMemoryStore implements ResultStore {
  private data = new Map<string, CheckResult[]>();

  async record(r: CheckResult): void {
    const arr = this.data.get(r.endpointId) ?? [];
    arr.push(r);
    if (arr.length > 720) arr.splice(0, arr.length - 720);
    this.data.set(r.endpointId, arr);
  }

  async getHistory(id: string, since: number): CheckResult[] {
    return (this.data.get(id) ?? []).filter(r => r.timestamp >= since);
  }

  async getSummary(id: string): EndpointSummary {
    const arr = this.data.get(id) ?? [];
    const since = Date.now() - 86_400_000;
    const recent = arr.filter(r => r.timestamp >= since);
    const ups = recent.filter(r => r.isUp).length;
    const avg = recent.length ? recent.reduce((s, r) => s + r.latencyMs, 0) / recent.length : 0;
    const fails = arr.filter(r => !r.isUp).length;
    return {
      endpointId: id,
      uptimePct24h: recent.length ? (ups / recent.length) * 100 : 0,
      avgLatencyMs24h: avg,
      lastCheck: arr[arr.length - 1] ?? null,
      totalChecks: arr.length,
      totalFailures: fails,
    };
  }

  async listEndpointIds(): string[] { return [...this.data.keys()]; }
}