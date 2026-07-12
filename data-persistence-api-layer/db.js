const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "apiwatch.db");

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      headers TEXT DEFAULT '{}',
      body TEXT DEFAULT NULL,
      expected_status INTEGER DEFAULT 200,
      check_interval_sec INTEGER NOT NULL DEFAULT 60,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      is_up INTEGER NOT NULL,
      error_message TEXT DEFAULT NULL,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_checks_endpoint_id ON checks(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_endpoint_id ON alerts(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
  `);
}

// --- Endpoint helpers ---
function createEndpoint(data) {
  const stmt = getDb().prepare(`
    INSERT INTO endpoints (name, url, method, headers, body, expected_status, check_interval_sec, is_active)
    VALUES (@name, @url, @method, @headers, @body, @expected_status, @check_interval_sec, @is_active)
  `);
  const info = stmt.run({
    name: data.name,
    url: data.url,
    method: data.method || "GET",
    headers: JSON.stringify(data.headers || {}),
    body: data.body || null,
    expected_status: data.expected_status || 200,
    check_interval_sec: data.check_interval_sec || 60,
    is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
  });
  return getEndpoint(info.lastInsertRowid);
}

function getEndpoint(id) {
  const row = getDb().prepare("SELECT * FROM endpoints WHERE id = ?").get(id);
  if (row) row.headers = JSON.parse(row.headers);
  return row || null;
}

function listEndpoints(activeOnly = false) {
  const sql = activeOnly
    ? "SELECT * FROM endpoints WHERE is_active = 1 ORDER BY id"
    : "SELECT * FROM endpoints ORDER BY id";
  const rows = getDb().prepare(sql).all();
  return rows.map((r) => { r.headers = JSON.parse(r.headers); return r; });
}

function updateEndpoint(id, data) {
  const existing = getEndpoint(id);
  if (!existing) return null;
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  getDb().prepare(`
    UPDATE endpoints SET name=@name, url=@url, method=@method, headers=@headers,
      body=@body, expected_status=@expected_status, check_interval_sec=@check_interval_sec,
      is_active=@is_active, updated_at=@updated_at
    WHERE id=@id
  `).run({
    id, name: merged.name, url: merged.url, method: merged.method,
    headers: JSON.stringify(merged.headers || {}), body: merged.body || null,
    expected_status: merged.expected_status, check_interval_sec: merged.check_interval_sec,
    is_active: merged.is_active ? 1 : 0, updated_at: merged.updated_at,
  });
  return getEndpoint(id);
}

function deleteEndpoint(id) {
  return getDb().prepare("DELETE FROM endpoints WHERE id = ?").run(id).changes > 0;
}

// --- Check helpers ---
function insertCheck(data) {
  getDb().prepare(`
    INSERT INTO checks (endpoint_id, status_code, response_time_ms, is_up, error_message, checked_at)
    VALUES (@endpoint_id, @status_code, @response_time_ms, @is_up, @error_message, @checked_at)
  `).run({
    endpoint_id: data.endpoint_id,
    status_code: data.status_code || null,
    response_time_ms: data.response_time_ms || null,
    is_up: data.is_up ? 1 : 0,
    error_message: data.error_message || null,
    checked_at: data.checked_at || new Date().toISOString(),
  });
}

function getChecks(endpointId, limit = 100, offset = 0) {
  return getDb().prepare(
    "SELECT * FROM checks WHERE endpoint_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?"
  ).all(endpointId, limit, offset);
}

function getMetrics(endpointId, minutes = 60) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const row = getDb().prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_count,
      AVG(response_time_ms) as avg_response_ms,
      MAX(response_time_ms) as max_response_ms,
      MIN(response_time_ms) as min_response_ms
    FROM checks WHERE endpoint_id = ? AND checked_at >= ?
  `).get(endpointId, since);
  return {
    total: row.total,
    uptime_pct: row.total ? +((row.up_count / row.total) * 100).toFixed(2) : 0,
    avg_response_ms: row.avg_response_ms ? +row.avg_response_ms.toFixed(1) : null,
    max_response_ms: row.max_response_ms,
    min_response_ms: row.min_response_ms,
    window_minutes: minutes,
  };
}

// --- Alert helpers ---
function insertAlert(data) {
  getDb().prepare(`
    INSERT INTO alerts (endpoint_id, alert_type, message) VALUES (@endpoint_id, @alert_type, @message)
  `).run({ endpoint_id: data.endpoint_id, alert_type: data.alert_type, message: data.message });
}

function getAlerts(endpointId = null, acknowledged = null, limit = 50, offset = 0) {
  let sql = "SELECT * FROM alerts WHERE 1=1";
  const params = [];
  if (endpointId) { sql += " AND endpoint_id = ?"; params.push(endpointId); }
  if (acknowledged !== null) { sql += " AND is_acknowledged = ?"; params.push(acknowledged ? 1 : 0); }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params);
}

function acknowledgeAlert(id) {
  return getDb().prepare("UPDATE alerts SET is_acknowledged = 1 WHERE id = ?").run(id).changes > 0;
}

module.exports = {
  getDb, createEndpoint, getEndpoint, listEndpoints, updateEndpoint, deleteEndpoint,
  insertCheck, getChecks, getMetrics, insertAlert, getAlerts, acknowledgeAlert,
};