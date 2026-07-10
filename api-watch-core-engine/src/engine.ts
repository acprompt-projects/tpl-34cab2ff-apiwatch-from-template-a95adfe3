import { EndpointConfig, CheckResult, ResultStore } from './types';

export class MonitorEngine {
  private timers = new Map<string, NodeJS.Timer>();
  private store: ResultStore;

  constructor(store: ResultStore) { this.store = store; }

  start(config: EndpointConfig): void {
    if (this.timers.has(config.id)) this.stop(config.id);
    const ms = config.intervalSec * 1000;
    const run = () => this.check(config).then(r => this.store.record(r)).catch(() => {});
    run();
    this.timers.set(config.id, setInterval(run, ms));
  }

  stop(id: string): void {
    const t = this.timers.get(id);
    if (t) { clearInterval(t); this.timers.delete(id); }
  }

  stopAll(): void { for (const id of this.timers.keys()) this.stop(id); }

  async check(cfg: EndpointConfig): Promise<CheckResult> {
    const start = Date.now();
    const violations: string[] = [];
    let status: number | null = null;
    let body = '';
    let error: string | undefined;

    const headers: Record<string, string> = { ...cfg.headers };
    let reqBody: string | undefined = cfg.body;

    if (cfg.graphql) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify({ query: cfg.graphql.query, variables: cfg.graphql.variables });
    }

    try {
      const res = await fetch(cfg.url, {
        method: cfg.method ?? 'GET',
        headers,
        body: reqBody ?? undefined,
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      body = await res.text();
    } catch (e: any) {
      error = e.message ?? String(e);
    }

    const latencyMs = Date.now() - start;
    let isUp = status !== null && status >= 200 && status < 400;

    if (cfg.rules.expectedStatus && status !== cfg.rules.expectedStatus) {
      violations.push(`status ${status} !== expected ${cfg.rules.expectedStatus}`);
      isUp = false;
    }
    if (cfg.rules.bodyRegex) {
      const re = new RegExp(cfg.rules.bodyRegex);
      if (!re.test(body)) {
        violations.push(`body did not match /${cfg.rules.bodyRegex}/`);
        isUp = false;
      }
    }
    if (cfg.rules.latencyThresholdMs && latencyMs > cfg.rules.latencyThresholdMs) {
      violations.push(`latency ${latencyMs}ms > threshold ${cfg.rules.latencyThresholdMs}ms`);
      isUp = false;
    }
    if (error) { isUp = false; violations.push(error); }

    return { endpointId: cfg.id, timestamp: start, status, latencyMs, isUp, violations, error };
  }
}

export { InMemoryStore } from './store';