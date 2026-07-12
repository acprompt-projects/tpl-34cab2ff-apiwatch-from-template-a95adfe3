const express = require("express");
const db = require("./db");

const app = express();
app.use(express.json());

// --- CRUD: Endpoints ---
app.get("/api/endpoints", (req, res) => {
  const active = req.query.active === "1" || req.query.active === "true";
  res.json(db.listEndpoints(active));
});

app.get("/api/endpoints/:id", (req, res) => {
  const ep = db.getEndpoint(+req.params.id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  res.json(ep);
});

app.post("/api/endpoints", (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "name and url are required" });
  const ep = db.createEndpoint(req.body);
  res.status(201).json(ep);
});

app.put("/api/endpoints/:id", (req, res) => {
  const ep = db.updateEndpoint(+req.params.id, req.body);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  res.json(ep);
});

app.delete("/api/endpoints/:id", (req, res) => {
  if (!db.deleteEndpoint(+req.params.id)) return res.status(404).json({ error: "Endpoint not found" });
  res.status(204).end();
});

// --- Checks / Metrics ---
app.post("/api/checks", (req, res) => {
  const { endpoint_id } = req.body;
  if (!endpoint_id) return res.status(400).json({ error: "endpoint_id is required" });
  if (!db.getEndpoint(+endpoint_id)) return res.status(404).json({ error: "Endpoint not found" });
  db.insertCheck(req.body);
  res.status(201).json({ ok: true });
});

app.get("/api/endpoints/:id/checks", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json(db.getChecks(+req.params.id, limit, offset));
});

app.get("/api/endpoints/:id/metrics", (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes, 10) || 60, 43200);
  res.json(db.getMetrics(+req.params.id, minutes));
});

// --- Alerts ---
app.get("/api/alerts", (req, res) => {
  const endpointId = req.query.endpoint_id ? +req.query.endpoint_id : null;
  const ack = req.query.acknowledged === undefined ? null : req.query.acknowledged === "1";
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json(db.getAlerts(endpointId, ack, limit, offset));
});

app.post("/api/alerts", (req, res) => {
  const { endpoint_id, alert_type, message } = req.body;
  if (!endpoint_id || !alert_type || !message)
    return res.status(400).json({ error: "endpoint_id, alert_type, and message are required" });
  db.insertAlert(req.body);
  res.status(201).json({ ok: true });
});

app.patch("/api/alerts/:id/acknowledge", (req, res) => {
  if (!db.acknowledgeAlert(+req.params.id))
    return res.status(404).json({ error: "Alert not found" });
  res.json({ ok: true });
});

// --- Health ---
app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`API Watch server listening on port ${PORT}`));

module.exports = app;