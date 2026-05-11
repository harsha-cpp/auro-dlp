import React, { useEffect, useState, useRef } from 'react';
import yaml from 'js-yaml';
import { api } from '../api/client.js';
import { fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

export default function Policies() {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [yamlErr, setYamlErr] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await api('/policies');
      setList(r.policies || []);
      const cur = (r.policies || []).find((p) => p.active);
      setActive(cur || null);
      if (!draft && cur?.yaml) setDraft(cur.yaml);
    } catch (e) {
      setErr(e.error || e.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function validateDraft(text) {
    setYamlErr(null);
    try {
      yaml.load(text);
      return true;
    } catch (e) {
      const mark = e.mark;
      const loc = mark ? `line ${mark.line + 1}, col ${mark.column + 1}` : '';
      setYamlErr(`${e.reason || e.message}${loc ? ` (${loc})` : ''}`);
      return false;
    }
  }

  async function publish() {
    if (!validateDraft(draft)) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const parsed = yaml.load(draft);
      await api('/policies', { method: 'POST', body: { version: parsed.version || '1.0', yaml: draft } });
      setMsg('Published successfully.');
      await load();
    } catch (e) {
      setErr(e.error || e.message);
    } finally { setBusy(false); }
  }

  async function activate(id) {
    setBusy(true); setErr(null); setMsg(null);
    try { await api(`/policies/${id}/activate`, { method: 'POST' }); await load(); setMsg('Activated.'); }
    catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;

  return (
    <>
      <PageHeader title="Policies" subtitle="Signed YAML bundles distributed to all enrolled agents" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="text-sm font-medium text-slate-800">Policy editor</div>
              <span className="text-xs text-slate-500">{active ? `Active: v${active.version}` : 'No active policy'}</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft) validateDraft(draft); }}
              rows={24}
              spellCheck={false}
              className="w-full font-mono text-sm px-4 py-3 border-0 focus:outline-none resize-y bg-white"
              placeholder="# Paste or write YAML policy here..."
            />
            {yamlErr && (
              <div className="px-4 py-2 border-t bg-rose-50 text-xs text-rose-700">
                YAML error: {yamlErr}
              </div>
            )}
            <div className="px-4 py-3 border-t flex items-center justify-between bg-slate-50">
              <div className="flex gap-2">
                <button onClick={() => validateDraft(draft)} className="px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50">
                  Validate
                </button>
                <button onClick={() => setDraft(active?.yaml || '')} className="px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50">
                  Reset
                </button>
              </div>
              <button disabled={busy || !draft || !!yamlErr} onClick={publish}
                className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 font-medium">
                {busy ? 'Publishing…' : 'Publish & sign'}
              </button>
            </div>
          </div>
          {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-2 rounded-md">{msg}</div>}
          {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-2 rounded-md">{err}</div>}
        </div>

        <div>
          <div className="bg-white border border-slate-200 rounded-lg">
            <div className="px-4 py-3 border-b text-sm font-medium text-slate-800">History</div>
            <div className="divide-y max-h-[32rem] overflow-y-auto">
              {list.length === 0 && <div className="p-4 text-sm text-slate-400">No policies published yet.</div>}
              {list.map((p) => (
                <div key={p.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">{p.id}</div>
                    {p.active ? <Badge variant="allow">active</Badge> : <Badge variant="neutral">v{p.version}</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{fmtDate(p.created_at)}</div>
                  {!p.active && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => activate(p.id)} className="text-xs text-slate-700 hover:underline font-medium">Activate</button>
                      <button onClick={() => setDraft(p.yaml || '')} className="text-xs text-slate-500 hover:underline">Load</button>
                    </div>
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
