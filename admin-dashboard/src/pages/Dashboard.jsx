import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#0ea5e9', '#a855f7'];

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="bg-white border rounded-lg p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${accent || 'text-slate-900'}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api('/incidents/stats')
      .then(setStats)
      .catch((e) => setErr(e.error || e.message || 'failed'));
  }, []);

  const trend = stats?.trend || [];
  const byCategory = stats?.byCategory || [];
  const byVerdict = stats?.byVerdict || [];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Real-time view of policy enforcement across endpoints"
      />
      <div className="p-8 space-y-6">
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded">{err}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Endpoints online" value={stats?.endpointsOnline ?? '—'} hint={`of ${stats?.endpointsTotal ?? '—'} enrolled`} />
          <StatCard label="Incidents (24h)" value={stats?.incidents24h ?? '—'} accent="text-slate-900" />
          <StatCard label="Blocked sends (24h)" value={stats?.blocked24h ?? '—'} accent="text-rose-700" />
          <StatCard label="Active policy" value={stats?.activePolicy ?? '—'} hint={stats?.activePolicySigned ? 'Signed' : 'Unsigned'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border rounded-lg p-5">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-medium text-slate-800">Incidents over time</div>
              <div className="text-xs text-slate-400">Last 14 days</div>
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="incidents" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="blocks" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white border rounded-lg p-5">
            <div className="font-medium text-slate-800 mb-3">Verdict breakdown</div>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byVerdict} dataKey="count" nameKey="verdict" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {byVerdict.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-medium text-slate-800">Top-fired rules</div>
            <div className="text-xs text-slate-400">Aggregated</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={byCategory} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
