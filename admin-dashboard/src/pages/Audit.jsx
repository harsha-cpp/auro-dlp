import React, { useEffect, useState, useCallback } from 'react';
import { api, qs } from '../api/client.js';
import { fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

const ACTIONS = [
  '',
  'auth.login', 'auth.logout', 'auth.failure',
  'policy.publish', 'policy.activate',
  'incident.create', 'incident.override.mint', 'incident.override.consume', 'incident.override.deny',
  'agent.isolate', 'agent.heartbeat',
  'rbac.user.create', 'rbac.user.update', 'rbac.user.delete',
  'settings.update',
];

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ action: '', actor: '', from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [chainOk, setChainOk] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const q = qs({ ...filters, page, pageSize: 100 });
      const r = await api(`/audit?${q}`);
      setRows(r.rows || []);
      setTotal(r.total || 0);
      setChainOk(r.chainVerified ?? null);
    } catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="HMAC-chained, append-only record"
        actions={
          chainOk == null ? null :
            chainOk ? <Badge variant="allow">Chain verified</Badge> : <Badge variant="block">TAMPERED</Badge>
        }
      />
      <div className="p-6 space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Action</label>
            <select value={filters.action} onChange={(e) => { setPage(1); setFilters({ ...filters, action: e.target.value }); }}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
              {ACTIONS.map((a) => <option key={a} value={a}>{a || 'All'}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Actor</label>
            <input value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <button onClick={() => { setPage(1); load(); }} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium">Apply</button>
        </div>

        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded-md text-sm">{err}</div>}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Detail</th>
                <th className="px-4 py-2 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {busy && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
              {!busy && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No entries.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDate(r.ts)}</td>
                  <td className="px-4 py-2 text-xs">{r.actor || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.target || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-600 truncate max-w-[20rem]">{r.detail || '—'}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-400">{(r.hash || '').slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <div>{total.toLocaleString()} total</div>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 text-sm hover:bg-slate-50">Prev</button>
            <button disabled={rows.length < 100} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 text-sm hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
