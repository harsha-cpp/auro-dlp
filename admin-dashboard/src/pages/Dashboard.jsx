import React, { useEffect, useState, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { api, apiStream } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#0ea5e9', '#a855f7'];

function StatCard({ label, value, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1 text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    api('/incidents/stats')
      .then(setStats)
      .catch((e) => setErr(e.error || e.message || 'failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const stream = apiStream('/stream', (type) => {
      if (type === 'incident.created') {
        setStats((prev) => prev ? { ...prev, incidents24h: (prev.incidents24h || 0) + 1 } : prev);
      }
    });
    stream.onopen = () => setSseConnected(true);
    stream.onerror = () => setSseConnected(false);
    streamRef.current = stream;
    return () => stream.close();
  }, []);

  const trend = stats?.trend14d || [];
  const byCategory = stats?.byCategory || [];
  const byVerdict = stats?.byVerdict
    ? Object.entries(stats.byVerdict).map(([verdict, count]) => ({ verdict, count }))
    : [];

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Real-time policy enforcement across endpoints"
        actions={
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {sseConnected ? 'Live' : 'Disconnected'}
          </div>
        }
      />
      <div className="p-6 space-y-6">
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded-md text-sm">{err}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Endpoints online" value={stats?.endpointsOnline ?? '—'} hint={`of ${stats?.endpointsTotal ?? '—'} enrolled`} />
          <StatCard label="Incidents (24h)" value={stats?.incidents24h ?? '—'} />
          <StatCard label="Blocked (24h)" value={stats?.blocked24h ?? '—'} />
          <StatCard label="Policy version" value={stats?.activePolicy ?? '—'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-sm font-medium text-slate-800">Incidents over time</div>
              <div className="text-xs text-slate-400">Last 14 days</div>
            </div>
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#0f172a" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-sm font-medium text-slate-800 mb-3">Verdict breakdown</div>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byVerdict} dataKey="count" nameKey="verdict" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {byVerdict.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-sm font-medium text-slate-800 mb-3">Top categories</div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={byCategory} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" fill="#0f172a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
