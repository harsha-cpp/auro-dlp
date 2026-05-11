import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, apiStream, qs } from '../api/client.js';
import { fmtDate } from '../lib/format.js';
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
  const streamRef = useRef(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const q = qs({ ...filters, page, pageSize: 50 });
      const r = await api(`/incidents?${q}`);
      setRows(r.rows || []);
      setTotal(r.total || 0);
    } catch (e) {
      setErr(e.error || e.message || 'failed');
    } finally {
      setBusy(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const stream = apiStream('/stream', (type, data) => {
      if (type === 'incident.created' && page === 1) {
        setRows((prev) => [data, ...prev].slice(0, 50));
        setTotal((t) => t + 1);
      }
    });
    streamRef.current = stream;
    return () => stream.close();
  }, [page]);

  function exportCsv() {
    const q = qs({ ...filters, format: 'csv' });
    window.open(`/api/v1/incidents/export?${q}`, '_blank');
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Detected exfiltration attempts"
        actions={
          <button onClick={exportCsv} className="px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50">
            Export CSV
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Verdict</label>
            <select
              value={filters.verdict}
              onChange={(e) => { setPage(1); setFilters({ ...filters, verdict: e.target.value }); }}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {VERDICTS.map((v) => <option key={v} value={v}>{v || 'All'}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Search</label>
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="user, endpoint, or rule"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <button onClick={() => { setPage(1); load(); }} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium">
            Apply
          </button>
        </div>

        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded-md text-sm">{err}</div>}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Verdict</th>
                <th className="px-4 py-2 font-medium">Risk</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Categories</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {busy && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!busy && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No incidents found.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.incident_id || r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-600">{fmtDate(r.ts)}</td>
                  <td className="px-4 py-2"><Badge variant={verdictVariant(r.verdict)}>{r.verdict}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{Number(r.risk).toFixed(2)}</td>
                  <td className="px-4 py-2 text-xs">{r.user_principal || '—'}</td>
                  <td className="px-4 py-2 text-xs">{r.endpoint_id || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(r.categories) ? r.categories : []).slice(0, 3).map((c) => (
                        <span key={c} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{c}</span>
                      ))}
                      {(Array.isArray(r.categories) ? r.categories : []).length > 3 && (
                        <span className="text-[10px] text-slate-400">+{r.categories.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link to={`/incidents/${r.incident_id || r.id}`} className="text-xs text-slate-700 hover:underline font-medium">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <div>{total.toLocaleString()} total</div>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 text-sm hover:bg-slate-50">Prev</button>
            <button disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 text-sm hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
