import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge, { verdictVariant } from '../components/Badge.jsx';

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5">{children}</div>
    </div>
  );
}

function OverrideModal({ incidentId, onClose, onMinted }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  async function mint() {
    if (reason.length < 8) { setErr('Reason must be at least 8 characters.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api('/admin/override', { method: 'POST', body: { incident_id: incidentId, reason } });
      setResult(r);
      setSecondsLeft(120);
      if (onMinted) onMinted(r);
    } catch (e) { setErr(e.error || e.message || 'Failed'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [secondsLeft > 0]);

  const expired = result && secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium text-slate-900">Mint Override Code</div>
        {!result && (
          <>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Reason (min 8 chars)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="Clinical necessity: patient discharge requires..." />
            </div>
            {err && <div className="text-sm text-rose-700">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50">Cancel</button>
              <button onClick={mint} disabled={busy} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50">
                {busy ? 'Minting…' : 'Mint Code'}
              </button>
            </div>
          </>
        )}
        {result && !expired && (
          <div className="text-center space-y-3">
            <div className="text-4xl font-mono font-bold tracking-widest text-slate-900">{result.code}</div>
            <div className="text-sm text-slate-600">Read this code to the doctor</div>
            <div className="text-xs text-slate-500">Expires in <span className="font-mono font-medium">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span></div>
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50">Close</button>
          </div>
        )}
        {expired && (
          <div className="text-center space-y-3">
            <div className="text-sm text-rose-700 font-medium">Code expired</div>
            <button onClick={() => { setResult(null); setReason(''); }} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium">Mint new code</button>
            <button onClick={onClose} className="ml-2 px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function IncidentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => {
    api(`/incidents/${id}`).then(setData).catch((e) => setErr(e.error || e.message));
  }, [id]);

  if (err) return <div className="p-6 text-rose-700 text-sm">{err}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading…</div>;

  const inc = data.incident || data;
  const matches = data.matches || [];
  const overrides = data.overrides || [];
  const canMintOverride = user && (user.role === 'admin' || user.role === 'security');

  return (
    <>
      <PageHeader
        title={`Incident #${inc.incident_id || inc.id || id}`}
        subtitle={<Link to="/incidents" className="text-xs text-slate-500 hover:underline">← Back</Link>}
        actions={
          <div className="flex items-center gap-2">
            {canMintOverride && (
              <button onClick={() => setShowOverride(true)} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium">
                Mint Override
              </button>
            )}
            <Badge variant={verdictVariant(inc.verdict)}>{inc.verdict}</Badge>
          </div>
        }
      />
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Timestamp">{fmtDate(inc.ts)}</Field>
          <Field label="Risk">{Number(inc.risk).toFixed(3)}</Field>
          <Field label="User">{inc.user_principal || '—'}</Field>
          <Field label="Endpoint">{inc.endpoint_id || '—'}</Field>
          <Field label="Verdict">{inc.verdict}</Field>
          <Field label="Policy version">{inc.policy_version || '—'}</Field>
          <Field label="Rule IDs">{(Array.isArray(inc.rule_ids) ? inc.rule_ids : []).join(', ') || '—'}</Field>
          <Field label="Categories">{(Array.isArray(inc.categories) ? inc.categories : []).join(', ') || '—'}</Field>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-sm font-medium text-slate-800 mb-3">Match summary</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
              <tr>
                <th className="py-2 font-medium">Rule</th>
                <th className="py-2 font-medium">Hits</th>
                <th className="py-2 font-medium">Sample (masked)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {matches.map((m, i) => (
                <tr key={i}>
                  <td className="py-2 font-mono text-xs">{m.rule}</td>
                  <td className="py-2">{m.count}</td>
                  <td className="py-2 font-mono text-xs text-slate-500">{m.sampleMasked || '—'}</td>
                </tr>
              ))}
              {matches.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-center text-slate-400">No match details.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-sm font-medium text-slate-800 mb-3">Override history</div>
          {overrides.length === 0 && <div className="text-sm text-slate-400">No override requested.</div>}
          <div className="divide-y divide-slate-200">
            {overrides.map((o, i) => (
              <div key={o.id || i} className="flex items-center justify-between text-sm py-2">
                <div>
                  <div className="text-slate-800">{o.requestedBy || o.actor || '—'}</div>
                  <div className="text-xs text-slate-500">{fmtDate(o.ts || o.created_at)} · {o.reason || '—'}</div>
                </div>
                <Badge variant={o.status === 'APPROVED' ? 'allow' : o.status === 'DENIED' ? 'block' : 'warn'}>{o.status || 'PENDING'}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showOverride && <OverrideModal incidentId={id} onClose={() => setShowOverride(false)} />}
    </>
  );
}
