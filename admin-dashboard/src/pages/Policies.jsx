import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

export default function Policies() {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const r = await api('/policies');
      setList(r.policies || []);
      const cur = (r.policies || []).find((p) => p.active);
      setActive(cur || null);
      setDraft(cur?.bundle || '');
    } catch (e) {
      setErr(e.error || e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function publish() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api('/policies', { method: 'POST', body: { bundle: draft } });
      setMsg(`Published policy ${r.id} (${r.signed ? 'signed' : 'unsigned'})`);
      await load();
    } catch (e) {
      setErr(e.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function activate(id) {
    setBusy(true); setErr(null); setMsg(null);
    try { await api(`/policies/${id}/activate`, { method: 'POST' }); await load(); setMsg('Activated.'); }
    catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="Signed YAML bundles distributed to all enrolled agents"
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white border rounded-lg">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-medium text-slate-800">Draft / current bundle</div>
              <div className="text-xs text-slate-500">{active ? `Active: ${active.id} v${active.version}` : 'No active policy'}</div>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="w-full h-[28rem] px-4 py-3 text-xs font-mono outline-none resize-y bg-slate-50"
              placeholder="# YAML policy bundle&#10;version: 1.0&#10;defaultVerdict: WARN&#10;rules:&#10;  - id: IN.AADHAAR&#10;    verdict: BLOCK_NO_OVERRIDE"
            />
            <div className="px-4 py-3 border-t flex items-center justify-between bg-slate-50">
              <div className="text-xs text-slate-500">{draft.length.toLocaleString()} chars</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDraft(active?.bundle || '')}
                  className="px-3 py-1.5 text-sm border rounded bg-white hover:bg-slate-100"
                >
                  Reset
                </button>
                <button
                  disabled={busy || !draft}
                  onClick={publish}
                  className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? 'Publishing…' : 'Publish & sign'}
                </button>
              </div>
            </div>
          </div>
          {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-2 rounded">{msg}</div>}
          {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-2 rounded">{err}</div>}
        </div>

        <div>
          <div className="bg-white border rounded-lg">
            <div className="px-4 py-3 border-b font-medium text-slate-800">History</div>
            <div className="divide-y">
              {list.length === 0 && <div className="p-4 text-sm text-slate-400">No policies published yet.</div>}
              {list.map((p) => (
                <div key={p.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">{p.id}</div>
                    {p.active ? <Badge variant="allow">active</Badge> : <Badge variant="neutral">v{p.version}</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{new Date(p.createdAt).toLocaleString()}</div>
                  <div className="text-xs text-slate-500">by {p.createdBy || '—'}</div>
                  {!p.active && (
                    <button
                      onClick={() => activate(p.id)}
                      className="mt-2 text-xs text-emerald-700 hover:underline"
                    >
                      Activate this version
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
