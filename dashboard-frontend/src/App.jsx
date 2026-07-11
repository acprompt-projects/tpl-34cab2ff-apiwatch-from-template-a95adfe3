import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function StatusDot({ status }) {
  const c = status === 'healthy' ? 'bg-emerald-400' : status === 'degraded' ? 'bg-amber-400' : 'bg-red-500';
  return <span className={`inline-block w-3 h-3 rounded-full ${c} shadow-lg`} />;
}

function AddEndpoint({ onAdd }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [interval, setInterval_] = useState(60);
  const submit = (e) => { e.preventDefault(); if (!url) return; onAdd({ url, name: name || url, intervalSec: interval }); setUrl(''); setName(''); };
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 items-end bg-slate-800 p-4 rounded-xl">
      <div className="flex-1 min-w-[140px]"><label className="text-xs text-slate-400">Name</label><input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm" /></div>
      <div className="flex-[2] min-w-[200px]"><label className="text-xs text-slate-400">URL</label><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/health" required className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm" /></div>
      <div className="w-20"><label className="text-xs text-slate-400">Sec</label><input type="number" min={10} value={interval} onChange={e => setInterval_(+e.target.value)} className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm" /></div>
      <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1 rounded text-sm font-medium">Add</button>
    </form>
  );
}

function EndpointCard({ ep, selected, onSelect, onRemove }) {
  const up = ep.uptimePercent ?? 0;
  const status = up >= 99 ? 'healthy' : up >= 90 ? 'degraded' : 'down';
  return (
    <div onClick={() => onSelect(ep.id)} className={`cursor-pointer p-4 rounded-xl border-2 transition-all ${selected ? 'border-indigo-500 bg-slate-800' : 'border-transparent bg-slate-800 hover:border-slate-600'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-white text-sm truncate">{ep.name}</span>
        <StatusDot status={status} />
      </div>
      <div className="text-xs text-slate-400 truncate mb-2">{ep.url}</div>
      <div className="flex justify-between text-xs">
        <span className={up >= 99 ? 'text-emerald-400' : up >= 90 ? 'text-amber-400' : 'text-red-400'}>{up.toFixed(1)}% up</span>
        <span className="text-slate-500">{ep.avgResponseMs ?? '—'}ms avg</span>
      </div>
      <button onClick={e => { e.stopPropagation(); onRemove(ep.id); }} className="mt-2 text-xs text-red-400 hover:text-red-300">Remove</button>
    </div>
  );
}

function MetricsPanel({ ep }) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    if (!ep) return;
    let active = true;
    apiFetch(`/endpoints/${ep.id}/metrics?hours=24`).then(d => active && setMetrics(d)).catch(() => {});
    return () => { active = false; };
  }, [ep?.id]);
  if (!ep || !metrics) return <div className="text-slate-500 text-sm p-8 text-center">Select an endpoint to view metrics</div>;
  const chartData = (metrics.responseTimes || []).map(r => ({ t: new Date(r.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ms: r.responseMs }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Uptime', value: `${(metrics.uptimePercent ?? 0).toFixed(2)}%` },
          { label: 'Avg Response', value: `${metrics.avgResponseMs ?? 0}ms` },
          { label: 'Incidents (24h)', value: metrics.incidents24h ?? 0 },
        ].map(s => <div key={s.label} className="bg-slate-800 rounded-xl p-4"><div className="text-xs text-slate-400">{s.label}</div><div className="text-xl font-bold text-white">{s.value}</div></div>)}
      </div>
      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-2">Response Time (24h)</h3>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}><XAxis dataKey="t" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} unit="ms" /><Tooltip contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#fff' }} /><Line type="monotone" dataKey="ms" stroke="#818cf8" strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        ) : <div className="text-slate-500 text-sm h-[200px] flex items-center justify-center">No data yet</div>}
      </div>
      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-2">Incident History</h3>
        {(metrics.incidents || []).length ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {metrics.incidents.map((inc, i) => (
              <div key={i} className="flex justify-between items-start text-xs border-l-2 border-red-500 pl-2">
                <div><span className="text-red-400 font-medium">{inc.statusCode ?? 'Timeout'}</span><span className="text-slate-400 ml-2">{inc.message || ''}</span></div>
                <span className="text-slate-500 whitespace-nowrap">{new Date(inc.checkedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : <div className="text-slate-500 text-sm">No incidents in the last 24 hours 🎉</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [endpoints, setEndpoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const load = useCallback(() => { apiFetch('/endpoints').then(setEndpoints).catch(() => {}); }, []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  const add = async (data) => { await apiFetch('/endpoints', { method: 'POST', body: JSON.stringify(data) }); load(); };
  const remove = async (id) => { await apiFetch(`/endpoints/${id}`, { method: 'DELETE' }); if (selectedId === id) setSelectedId(null); load(); };
  const selected = endpoints.find(e => e.id === selectedId);
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-700 px-6 py-4 flex items-center gap-3">
        <span className="text-2xl">🛰️</span><h1 className="text-xl font-bold tracking-tight">APIWatch</h1>
        <span className="ml-auto text-xs text-slate-500">Auto-refresh 15s</span>
      </header>
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <AddEndpoint onAdd={add} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3 lg:col-span-1">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Endpoints ({endpoints.length})</h2>
            {endpoints.length ? endpoints.map(ep => <EndpointCard key={ep.id} ep={ep} selected={selectedId === ep.id} onSelect={setSelectedId} onRemove={remove} />) : <div className="text-slate-500 text-sm">No endpoints yet. Add one above!</div>}
          </div>
          <div className="lg:col-span-2"><h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Metrics</h2><MetricsPanel ep={selected} /></div>
        </div>
      </main>
    </div>
  );
}