# APIWatch — Lightweight API Health Monitor

APIWatch pings endpoints on a configurable schedule, records response time and status history in SQLite, exposes a REST API for queries, and renders a real-time dashboard UI.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    APIWatch Container                 │
│                                                      │
│  ┌─────────────┐   ┌───────────────┐   ┌──────────┐ │
│  │  Core Engine │──▶│  SQLite DB    │──▶│ REST API  │ │
│  │  (Scheduler) │   │  (history.db) │   │ :3000/api │ │
│  └─────────────┘   └───────────────┘   └──────────┘ │
│         │                                │          │
│         │ ping loop                       │          │
│         ▼                                ▼          │
│  ┌─────────────┐                   ┌──────────────┐ │
│  │  Target APIs │                   │  Dashboard   │ │
│  │  (external)  │                   │  :3000/      │ │
│  └─────────────┘                   └──────────────┘ │
└──────────────────────────────────────────────────────┘
```

**Components:**
- **Core Engine** — Cron-like scheduler that HTTP-pings each configured endpoint, measures latency, and persists results.
- **SQLite DB** — Single-file database storing check history (timestamp, endpoint, status_code, latency_ms, success).
- **REST API** — JSON endpoints to list checks, query history, get uptime stats, and manage watch targets.
- **Dashboard** — Server-rendered HTML dashboard with charts showing uptime and latency trends.

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/your-org/apiwatch.git
cd apiwatch
cp config.example.json config.json
# Edit config.json with your endpoints (see Configuration below)

# 2. Build and run with Docker
docker build -t apiwatch .
docker run -d \
  --name apiwatch \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config.json:/app/config.json:ro \
  apiwatch

# 3. Open dashboard
open http://localhost:3000
```

## Running Without Docker

```bash
npm install
npm run build
npm start
# Or for development:
npm run dev
```

## Configuration

`config.json` — placed at `/app/config.json` inside the container:

```json
{
  "port": 3000,
  "database": "./data/history.db",
  "checks": [
    {
      "name": "Google",
      "url": "https://www.google.com",
      "method": "GET",
      "intervalSeconds": 60,
      "timeoutMs": 5000,
      "expectedStatus": 200,
      "headers": {}
    },
    {
      "name": "API Example",
      "url": "https://api.example.com/v1/status",
      "method": "GET",
      "intervalSeconds": 30,
      "timeoutMs": 3000,
      "expectedStatus": 200,
      "headers": { "Authorization": "Bearer ${API_TOKEN}" }
    }
  ],
  "retentionDays": 90
}
```

| Field              | Description                                      |
|--------------------|--------------------------------------------------|
| `port`             | HTTP port for API + dashboard (default 3000)     |
| `database`         | SQLite path; use `/app/data/` volume for persistence |
| `checks[].name`    | Display name for the endpoint                    |
| `checks[].url`     | Full URL to ping                                 |
| `checks[].method`  | HTTP method (GET, POST, HEAD)                    |
| `checks[].intervalSeconds` | Seconds between checks (min 10)         |
| `checks[].timeoutMs`       | Request timeout in milliseconds          |
| `checks[].expectedStatus`  | HTTP status considered healthy           |
| `checks[].headers`         | Custom HTTP headers (env vars via ${VAR})|
| `retentionDays`    | Auto-delete records older than N days (0 = forever) |

### Environment Variable Substitution

Headers values like `"Bearer ${API_TOKEN}"` are resolved from environment variables at startup. Pass them via Docker:

```bash
docker run -e API_TOKEN=secret123 ...
```

## REST API

| Method | Path                    | Description                              |
|--------|-------------------------|------------------------------------------|
| GET    | `/api/health`           | Service health check                     |
| GET    | `/api/checks`           | List all configured checks               |
| GET    | `/api/checks/:name/history?hours=24` | Recent history for a check |
| GET    | `/api/checks/:name/stats?days=7`     | Uptime/latency stats for a check      |
| POST   | `/api/checks`           | Add a new check (body = check config)    |
| DELETE | `/api/checks/:name`     | Remove a check                           |

Example:

```bash
curl http://localhost:3000/api/checks/Google/stats?days=7
# => { "uptimePercent": 99.8, "avgLatencyMs": 42, "p95LatencyMs": 120, ... }
```

## Data Persistence

Mount a volume at `/app/data` to keep `history.db` across container restarts:

```bash
docker run -v ./data:/app/data ...
```

Without a volume, the database resets on each container start.

## Development

```bash
npm run dev      # Hot-reload development server
npm run lint     # ESLint check
npm run test     # Unit + integration tests
npm run build    # Compile TypeScript to dist/
```

## License

MIT