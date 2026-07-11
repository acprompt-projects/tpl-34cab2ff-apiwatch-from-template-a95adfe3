import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from alerting import AlertingEngine, AlertRule, AlertEvent

engine = AlertingEngine()

class AlertingHandler(BaseHTTPRequestHandler):
    def _json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/rules":
            eid = params.get("endpoint_id", [None])[0]
            self._json([vars(r) for r in engine.list_rules(eid)])
        elif parsed.path == "/events":
            eid = params.get("endpoint_id", [None])[0]
            limit = int(params.get("limit", [100])[0])
            self._json([vars(e) for e in engine.list_events(eid, limit)])
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/rules":
            d = self._body()
            rule = AlertRule(
                endpoint_id=d.get("endpoint_id", ""),
                rule_type=d.get("rule_type", ""),
                threshold=float(d.get("threshold", 0)),
                cooldown_seconds=int(d.get("cooldown_seconds", 300)),
                enabled=d.get("enabled", True),
                webhook_url=d.get("webhook_url", ""),
                webhook_type=d.get("webhook_type", "generic"),
            )
            created = engine.add_rule(rule)
            self._json(vars(created), 201)
        elif parsed.path == "/evaluate":
            d = self._body()
            result = __import__("alerting").HealthCheckResult(
                endpoint_id=d["endpoint_id"],
                status=d.get("status", "up"),
                status_code=int(d.get("status_code", 200)),
                latency_ms=float(d.get("latency_ms", 0)),
                timestamp=float(d.get("timestamp", 0)),
                error=d.get("error", ""),
            )
            engine.evaluate(result)
            self._json({"evaluated": True})
        else:
            self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if parsed.path == "/rules":
            rule_id = int(params.get("id", [0])[0])
            engine.delete_rule(rule_id)
            self._json({"deleted": True})
        elif parsed.path == "/events/ack":
            event_id = int(params.get("id", [0])[0])
            engine.acknowledge_event(event_id)
            self._json({"acknowledged": True})
        else:
            self._json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        pass  # suppress default logging

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8090), AlertingHandler)
    print("Alerting API listening on :8090")
    server.serve_forever()