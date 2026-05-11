import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';

const ROLES = ['admin', 'security', 'auditor', 'helpdesk'];

function TabButton({ active, children, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition ${active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {children}
    </button>
  );
}

function AddUserModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ email: '', role: 'helpdesk', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api('/admin/users', { method: 'POST', body: form });
      onAdded();
      onClose();
    } catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-lg w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium text-slate-900">Add User</div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Email</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Initial Password</label>
          <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        {err && <div className="text-sm text-rose-700">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={busy} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('siem');
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [cfg, u] = await Promise.all([api('/admin/settings'), api('/admin/users')]);
      setSettings(cfg || {});
      setUsers(u.users || []);
    } catch (e) { setErr(e.error || e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function saveSettings() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api('/admin/settings', { method: 'PUT', body: settings });
      setMsg('Settings saved.');
    } catch (e) { setErr(e.error || e.message); }
    finally { setBusy(false); }
  }

  async function updateUser(id, patch) {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body: patch });
      await load();
    } catch (e) { setErr(e.error || e.message); }
  }

  async function deleteUser(id, email) {
    if (!confirm(`Delete user ${email}?`)) return;
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e) { setErr(e.error || e.message); }
  }

  function up(path, value) {
    setSettings((s) => {
      const copy = { ...s };
      const parts = path.split('.');
      let ref = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        ref[parts[i]] = { ...(ref[parts[i]] || {}) };
        ref = ref[parts[i]];
      }
      ref[parts[parts.length - 1]] = value;
      return copy;
    });
  }

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <>
      <PageHeader title="Settings" subtitle="Server, SIEM and access controls" />
      <div className="p-6 space-y-4">
        <div className="flex border-b">
          <TabButton active={tab === 'siem'} onClick={() => setTab('siem')}>SIEM</TabButton>
          <TabButton active={tab === 'retention'} onClick={() => setTab('retention')}>Retention</TabButton>
          <TabButton active={tab === 'rbac'} onClick={() => setTab('rbac')}>RBAC</TabButton>
        </div>

        {tab === 'siem' && (
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Splunk HEC URL</label>
              <input value={settings?.siem?.splunk || ''} onChange={(e) => up('siem.splunk', e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="https://splunk.hospital.local:8088/services/collector" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Syslog endpoint</label>
              <input value={settings?.siem?.syslog || ''} onChange={(e) => up('siem.syslog', e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="syslog://10.0.0.5:514" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Webhook URL</label>
              <input value={settings?.siem?.webhook || ''} onChange={(e) => up('siem.webhook', e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" placeholder="https://hooks.example.com/dlp" />
            </div>
            <button disabled={busy} onClick={saveSettings} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {tab === 'retention' && (
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-md">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Incident retention (days)</label>
              <input type="number" min={1} value={settings?.retentionDays || 365} onChange={(e) => up('retentionDays', Number(e.target.value))}
                className="w-32 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Override TTL (seconds)</label>
              <input type="number" min={60} max={1800} value={settings?.overrideTtlSeconds || 120} onChange={(e) => up('overrideTtlSeconds', Number(e.target.value))}
                className="w-32 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <button disabled={busy} onClick={saveSettings} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {tab === 'rbac' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowAddUser(true)} className="bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium">Add User</button>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Last login</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users.</td></tr>}
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-xs">{u.email}</td>
                      <td className="px-4 py-2">
                        <select value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(u.last_login)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => updateUser(u.id, { disabled: !u.disabled })} className="text-xs">
                          <Badge variant={u.disabled ? 'block' : 'allow'}>{u.disabled ? 'disabled' : 'active'}</Badge>
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => deleteUser(u.id, u.email)} className="text-xs text-rose-700 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {msg && <div className="text-sm text-emerald-700">{msg}</div>}
        {err && <div className="text-sm text-rose-700">{err}</div>}
      </div>
      {showAddUser && <AddUserModal onClose={() => setShowAddUser(false)} onAdded={load} />}
    </>
  );
}
