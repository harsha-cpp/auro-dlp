import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

function statusVariant(status) {
  if (status === 'online') return 'allow';
  if (status === 'stale') return 'warn';
  if (status === 'tampered') return 'block';
  return 'neutral';
}

export default function Endpoints() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await api('/agents');
      setRows(r.agents || []);
    } catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  async function isolate(id) {
    if (!confirm('Mark this endpoint isolated? Agent will refuse outbound until cleared.')) return;
    try { await api(`/agents/${id}/isolate`, { method: 'POST' }); await load(); }
    catch (e) { setErr(e.error || e.message); }
  }

  return (
    <>
      <PageHeader
        title="Endpoints"
        subtitle="Enrolled agents and their last reported state"
        actions={
          <button onClick={load} className="px-3 py-1.5 text-sm border rounded bg-white hover:bg-slate-50">Refresh</button>
        }
      />
      <div className="p-8 space-y-4">
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded">{err}</div>}
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Hostname</th>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">OS</th>
                <th className="px-4 py-2 font-medium">Agent ver.</th>
                <th className="px-4 py-2 font-medium">Policy ver.</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {busy && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
              {!busy && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No endpoints enrolled.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs">{r.hostname}</td>
                  <td className="px-4 py-2">{r.user || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.os || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.agentVersion || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.policyVersion || '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.lastSeen ? new Date(r.lastSeen).toLocaleString() : 'never'}</td>
                  <td className="px-4 py-2"><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    {r.status !== 'isolated' && (
                      <button onClick={() => isolate(r.id)} className="text-xs text-rose-700 hover:underline">Isolate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
