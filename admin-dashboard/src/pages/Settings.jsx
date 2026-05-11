import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';

function Section({ title, children }) {
  return (
    <div className="bg-white border rounded-lg p-5">
      <div className="font-medium text-slate-800 mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-start">
      <div className="text-sm text-slate-600 pt-2">{label}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

export default function Settings() {
  const [s, setS] = useState({});
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const [cfg, u] = await Promise.all([api('/admin/settings'), api('/admin/users')]);
      setS(cfg || {});
      setUsers(u.users || []);
    } catch (e) { setErr(e.error || e.message); }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api('/admin/settings', { method: 'PUT', body: s });
      setMsg('Saved.');
    } catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  function up(k, v) { setS({ ...s, [k]: v }); }

  return (
    <>
      <PageHeader title="Settings" subtitle="Server, SIEM and access controls" />
      <div className="p-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title="SIEM forwarding">
          <Row label="Mode">
            <select value={s.siemMode || 'off'} onChange={(e) => up('siemMode', e.target.value)} className="border rounded px-2 py-1.5 text-sm bg-white">
              <option value="off">Off</option>
              <option value="splunk">Splunk HEC</option>
              <option value="syslog">Syslog (RFC 5424)</option>
              <option value="webhook">Generic webhook</option>
            </select>
          </Row>
          <Row label="Endpoint URL">
            <input value={s.siemUrl || ''} onChange={(e) => up('siemUrl', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="https://splunk.hospital.local:8088/services/collector" />
          </Row>
          <Row label="Token / shared secret">
            <input value={s.siemToken || ''} onChange={(e) => up('siemToken', e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" type="password" />
          </Row>
        </Section>

        <Section title="Retention">
          <Row label="Incidents (days)">
            <input type="number" min={1} value={s.retentionDays || 365} onChange={(e) => up('retentionDays', Number(e.target.value))} className="w-32 border rounded px-2 py-1.5 text-sm" />
          </Row>
          <Row label="Audit log (days)">
            <input type="number" min={1} value={s.auditRetentionDays || 2555} onChange={(e) => up('auditRetentionDays', Number(e.target.value))} className="w-32 border rounded px-2 py-1.5 text-sm" />
          </Row>
        </Section>

        <Section title="Override workflow">
          <Row label="Require reason text">
            <input type="checkbox" checked={!!s.overrideRequireReason} onChange={(e) => up('overrideRequireReason', e.target.checked)} />
          </Row>
          <Row label="OTP TTL (seconds)">
            <input type="number" min={60} max={1800} value={s.overrideTtl || 300} onChange={(e) => up('overrideTtl', Number(e.target.value))} className="w-32 border rounded px-2 py-1.5 text-sm" />
          </Row>
          <Row label="Max overrides / user / day">
            <input type="number" min={0} value={s.overrideDailyMax ?? 5} onChange={(e) => up('overrideDailyMax', Number(e.target.value))} className="w-32 border rounded px-2 py-1.5 text-sm" />
          </Row>
        </Section>

        <Section title="Users (RBAC)">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
              <tr>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={3} className="py-3 text-slate-400">No users</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2">{u.email}</td>
                  <td className="py-2 font-mono text-xs">{u.role}</td>
                  <td className="py-2 text-xs">{u.disabled ? 'disabled' : 'active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <div className="xl:col-span-2 flex justify-end items-center gap-3">
          {msg && <span className="text-sm text-emerald-700">{msg}</span>}
          {err && <span className="text-sm text-rose-700">{err}</span>}
          <button disabled={busy} onClick={save} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </>
  );
}
