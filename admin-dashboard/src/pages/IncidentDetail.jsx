import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
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

export default function IncidentDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api(`/incidents/${id}`).then(setData).catch((e) => setErr(e.error || e.message));
  }, [id]);

  if (err) return <div className="p-8 text-rose-700">{err}</div>;
  if (!data) return <div className="p-8 text-slate-400">Loading…</div>;

  return (
    <>
      <PageHeader
        title={`Incident #${data.id}`}
        subtitle={<span><Link to="/incidents" className="text-emerald-700 hover:underline">← Back to incidents</Link></span>}
        actions={<Badge variant={verdictVariant(data.verdict)}>{data.verdict}</Badge>}
      />
      <div className="p-8 space-y-6 max-w-5xl">
        <div className="bg-white border rounded-lg p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Timestamp">{new Date(data.ts).toLocaleString()}</Field>
          <Field label="Risk">{Number(data.risk).toFixed(3)}</Field>
          <Field label="User">{data.user || '—'}</Field>
          <Field label="Endpoint">{data.endpoint || '—'}</Field>
          <Field label="Channel">{data.channel || 'gmail.compose'}</Field>
          <Field label="Recipient domain">{data.recipientDomain || '—'}</Field>
          <Field label="Attachment count">{data.attachmentCount ?? 0}</Field>
          <Field label="Body length">{data.bodyLen ?? 0} chars</Field>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <div className="font-medium text-slate-800 mb-3">Rules fired</div>
          <div className="flex flex-wrap gap-2">
            {(data.categories || []).map((c) => <Badge key={c} variant="info">{c}</Badge>)}
            {(data.categories || []).length === 0 && <span className="text-sm text-slate-400">None</span>}
          </div>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <div className="font-medium text-slate-800 mb-3">Match summary (redacted)</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
              <tr>
                <th className="py-2 font-medium">Rule</th>
                <th className="py-2 font-medium">Hits</th>
                <th className="py-2 font-medium">Sample (masked)</th>
              </tr>
            </thead>
            <tbody>
              {(data.matches || []).map((m, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-mono text-xs">{m.rule}</td>
                  <td className="py-2">{m.count}</td>
                  <td className="py-2 font-mono text-xs text-slate-500">{m.sampleMasked || '—'}</td>
                </tr>
              ))}
              {(data.matches || []).length === 0 && (
                <tr><td colSpan={3} className="py-4 text-center text-slate-400">No match details retained.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white border rounded-lg p-5">
          <div className="font-medium text-slate-800 mb-3">Override history</div>
          {(data.overrides || []).length === 0 && <div className="text-sm text-slate-400">No override requested.</div>}
          {(data.overrides || []).map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm border-b py-2 last:border-0">
              <div>
                <div className="text-slate-800">{o.requestedBy}</div>
                <div className="text-xs text-slate-500">{new Date(o.ts).toLocaleString()} · reason: {o.reason || '—'}</div>
              </div>
              <Badge variant={o.status === 'APPROVED' ? 'allow' : o.status === 'DENIED' ? 'block' : 'warn'}>{o.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
