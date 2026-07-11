import sqlite3
import json
import time
import threading
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

DB_PATH = "alerting.db"

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class AlertRule:
    id: Optional[int] = None
    endpoint_id: str = ""
    rule_type: str = ""          # consecutive_failures | latency_spike | status_change
    threshold: float = 0         # failures count | ms | n/a
    cooldown_seconds: int = 300  # min time between repeated alerts for same rule+endpoint
    enabled: bool = True
    webhook_url: str = ""
    webhook_type: str = "generic"  # slack | discord | generic

@dataclass
class AlertEvent:
    id: Optional[int] = None
    endpoint_id: str = ""
    rule_id: int = 0
    rule_type: str = ""
    message: str = ""
    severity: str = "warning"
    triggered_at: float = 0.0
    acknowledged: bool = False
    webhook_status: int = 0      # HTTP status code from notification dispatch

@dataclass
class HealthCheckResult:
    endpoint_id: str
    status: str        # "up" | "down" | "degraded"
    status_code: int
    latency_ms: float
    timestamp: float
    error: str = ""

# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    threshold REAL NOT NULL,
    cooldown_seconds INTEGER DEFAULT 300,
    enabled INTEGER DEFAULT 1,
    webhook_url TEXT NOT NULL,
    webhook_type TEXT DEFAULT 'generic'
);
CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id TEXT NOT NULL,
    rule_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    triggered_at REAL NOT NULL,
    acknowledged INTEGER DEFAULT 0,
    webhook_status INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_endpoint ON alert_events(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_events_triggered ON alert_events(triggered_at);
"""

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn

# ---------------------------------------------------------------------------
# Webhook dispatch
# ---------------------------------------------------------------------------

def _build_payload(webhook_type: str, event: AlertEvent) -> bytes:
    payload: Dict[str, Any]
    if webhook_type == "slack":
        payload = {
            "text": f":rotating_light: *{event.severity.upper()}* — {event.endpoint_id}",
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*Alert:* {event.rule_type}"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": event.message}},
            ],
        }
    elif webhook_type == "discord":
        payload = {
            "content": f"🚨 **{event.severity.upper()}** — {event.endpoint_id}",
            "embeds": [{"title": event.rule_type, "description": event.message, "color": 16711680 if event.severity == "critical" else 16753920}],
        }
    else:
        payload = asdict(event)
    return json.dumps(payload).encode()

def dispatch_webhook(url: str, webhook_type: str, event: AlertEvent, timeout: int = 5) -> int:
    data = _build_payload(webhook_type, event)
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        logger.warning("Webhook HTTP error %s for %s", exc.code, url)
        return exc.code
    except Exception as exc:
        logger.warning("Webhook dispatch failed for %s: %s", url, exc)
        return 0

# ---------------------------------------------------------------------------
# Alerting Engine
# ---------------------------------------------------------------------------

class AlertingEngine:
    def __init__(self, db_path: str = DB_PATH):
        global DB_PATH
        DB_PATH = db_path
        self._lock = threading.Lock()
        # endpoint_id -> list of recent HealthCheckResult (in-memory ring)
        self._history: Dict[str, List[HealthCheckResult]] = {}
        self._max_history = 50

    # -- rule CRUD --

    def add_rule(self, rule: AlertRule) -> AlertRule:
        with _get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO alert_rules (endpoint_id,rule_type,threshold,cooldown_seconds,enabled,webhook_url,webhook_type) VALUES (?,?,?,?,?,?,?)",
                (rule.endpoint_id, rule.rule_type, rule.threshold, rule.cooldown_seconds, int(rule.enabled), rule.webhook_url, rule.webhook_type),
            )
            rule.id = cur.lastrowid
        return rule

    def list_rules(self, endpoint_id: Optional[str] = None) -> List[AlertRule]:
        with _get_conn() as conn:
            if endpoint_id:
                rows = conn.execute("SELECT * FROM alert_rules WHERE endpoint_id=?", (endpoint_id,)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM alert_rules").fetchall()
        return [AlertRule(id=r["id"], endpoint_id=r["endpoint_id"], rule_type=r["rule_type"],
                          threshold=r["threshold"], cooldown_seconds=r["cooldown_seconds"],
                          enabled=bool(r["enabled"]), webhook_url=r["webhook_url"], webhook_type=r["webhook_type"]) for r in rows]

    def delete_rule(self, rule_id: int) -> bool:
        with _get_conn() as conn:
            conn.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,))
        return True

    # -- event queries --

    def list_events(self, endpoint_id: Optional[str] = None, limit: int = 100) -> List[AlertEvent]:
        with _get_conn() as conn:
            if endpoint_id:
                rows = conn.execute("SELECT * FROM alert_events WHERE endpoint_id=? ORDER BY triggered_at DESC LIMIT ?", (endpoint_id, limit)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT ?", (limit,)).fetchall()
        return [AlertEvent(**dict(r)) for r in rows]

    def acknowledge_event(self, event_id: int) -> bool:
        with _get_conn() as conn:
            conn.execute("UPDATE alert_events SET acknowledged=1 WHERE id=?", (event_id,))
        return True

    # -- core evaluation --

    def evaluate(self, result: HealthCheckResult):
        eid = result.endpoint_id
        with self._lock:
            self._history.setdefault(eid, []).append(result)
            if len(self._history[eid]) > self._max_history:
                self._history[eid] = self._history[eid][-self._max_history:]
            history = list(self._history[eid])

        rules = self.list_rules(eid)
        for rule in rules:
            if not rule.enabled:
                continue
            if rule.rule_type == "consecutive_failures":
                self._eval_consecutive(rule, history)
            elif rule.rule_type == "latency_spike":
                self._eval_latency(rule, history)
            elif rule.rule_type == "status_change":
                self._eval_status_change(rule, history)

    def _is_cooled_down(self, rule: AlertRule) -> bool:
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT MAX(triggered_at) AS last FROM alert_events WHERE endpoint_id=? AND rule_id=?",
                (rule.endpoint_id, rule.id),
            ).fetchone()
        if row and row["last"] and (time.time() - row["last"]) < rule.cooldown_seconds:
            return False
        return True

    def _fire(self, rule: AlertRule, message: str, severity: str = "warning"):
        if not self._is_cooled_down(rule):
            return
        event = AlertEvent(
            endpoint_id=rule.endpoint_id, rule_id=rule.id, rule_type=rule.rule_type,
            message=message, severity=severity, triggered_at=time.time(),
        )
        status = 0
        if rule.webhook_url:
            status = dispatch_webhook(rule.webhook_url, rule.webhook_type, event)
        event.webhook_status = status
        with _get_conn() as conn:
            conn.execute(
                "INSERT INTO alert_events (endpoint_id,rule_id,rule_type,message,severity,triggered_at,acknowledged,webhook_status) VALUES (?,?,?,?,?,?,?,?)",
                (event.endpoint_id, event.rule_id, event.rule_type, event.message, event.severity, event.triggered_at, int(event.acknowledged), event.webhook_status),
            )
        logger.info("Alert fired: %s — %s", rule.rule_type, message)

    def _eval_consecutive(self, rule: AlertRule, history: List[HealthCheckResult]):
        n = int(rule.threshold)
        recent = [h for h in history if h.status == "down"][-n:] if n else []
        # check last N results are all down
        if len(history) >= n and all(h.status == "down" for h in history[-n:]):
            self._fire(rule, f"{n} consecutive failures on {rule.endpoint_id}", severity="critical")

    def _eval_latency(self, rule: AlertRule, history: List[HealthCheckResult]):
        if len(history) < 2:
            return
        prev_avg = sum(h.latency_ms for h in history[:-1]) / (len(history) - 1)
        current = history[-1].latency_ms
        if current > rule.threshold and current > prev_avg * 1.5:
            self._fire(rule, f"Latency spike on {rule.endpoint_id}: {current:.0f}ms (avg {prev_avg:.0f}ms, threshold {rule.threshold:.0f}ms)", severity="warning")

    def _eval_status_change(self, rule: AlertRule, history: List[HealthCheckResult]):
        if len(history) < 2:
            return
        prev, curr = history[-2], history[-1]
        if prev.status != curr.status:
            self._fire(rule, f"Status changed on {rule.endpoint_id}: {prev.status} → {curr.status}", severity="critical" if curr.status == "down" else "warning")