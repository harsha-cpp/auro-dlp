import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge, { verdictVariant } from '../components/Badge.jsx';

const VERDICTS = ['', 'ALLOW', 'WARN', 'BLOCK', 'BLOCK_NO_OVERRIDE'];

export default function Incidents() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ verdict: '', q: '', from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const qs = new URLSearchParams();
    if (filters.verdict) qs.set('verdict', filters.verdict);
    if (filters.q) qs.set('q', filters.q);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    qs.set('page', String(page));
    qs.set('pageSize', '50');
    try {
      const r = await api(`/incidents?${qs.toString()}`);
      setRows(r.rows || []);
      setTotal(r.total || 0);
    } catch (e) {
      setErr(e.error || e.message || 'failed');
    } finally {
      setBusy(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    qs.set('format', 'csv');
    window.open(`/api/v1/incidents/export?${qs.toString()}`, '_blank');
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Detected exfiltration attempts (metadata only — no message bodies stored)"
        actions={
          <button onClick={exportCsv} className="px-3 py-1.5 text-sm border rounded-md bg-white hover:bg-slate-50">
            Export CSV
          </button>
        }
      />
      <div className="p-8 space-y-4">
        <div className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Verdict</label>
            <select
              value={filters.verdict}
              onChange={(e) => { setPage(1); setFilters({ ...filters, verdict: e.target.value }); }}
              className="border rounded px-2 py-1.5 text-sm bg-white"
            >
              {VERDICTS.map((v) => <option key={v} value={v}>{v || 'All'}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Search (user, endpoint, rule)</label>
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="e.g. dr.sharma or IN.AADHAAR"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
          </div>
          <button onClick={() => { setPage(1); load(); }} className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded hover:bg-slate-800">
            Apply
          </button>
        </div>

        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded">{err}</div>}

        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Verdict</th>
                <th className="px-4 py-2 font-medium">Risk</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Rules fired</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {busy && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!busy && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No incidents match the filters.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge variant={verdictVariant(r.verdict)}>{r.verdict}</Badge></td>
                  <td className="px-4 py-2 font-mono">{Number(r.risk).toFixed(2)}</td>
                  <td className="px-4 py-2">{r.user || '—'}</td>
                  <td className="px-4 py-2">{r.endpoint || '—'}</td>
                  <td className="px-4 py-2">{r.channel || 'gmail.compose'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(r.categories || []).slice(0, 4).map((c) => (
                        <Badge key={c} variant="info">{c}</Badge>
                      ))}
                      {(r.categories || []).length > 4 && <Badge variant="neutral">+{r.categories.length - 4}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link to={`/incidents/${r.id}`} className="text-emerald-700 hover:underline text-xs">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <div>{total.toLocaleString()} total</div>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">Prev</button>
            <button disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
