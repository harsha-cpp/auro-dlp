import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ChangePassword() {
  const nav = useNavigate();
  const { setMustChangePassword } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  function validate() {
    if (form.newPassword.length < 12) return 'Password must be at least 12 characters.';
    if (!/[a-zA-Z]/.test(form.newPassword)) return 'Must include at least one letter.';
    if (!/[0-9]/.test(form.newPassword)) return 'Must include at least one digit.';
    if (form.newPassword !== form.confirmPassword) return 'Passwords do not match.';
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setMustChangePassword(false);
      nav('/dashboard', { replace: true });
    } catch (e) {
      setErr(e.error || e.message || 'Failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-base font-semibold tracking-tight text-slate-900">Change Password</div>
          <div className="text-xs text-slate-500">Set a new password before continuing.</div>
        </div>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Current Password</label>
            <input type="password" required value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">New Password</label>
            <input type="password" required value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            <div className="text-xs text-slate-400 mt-1">Min 12 chars, letter + digit</div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Confirm</label>
            <input type="password" required value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-md">{err}</div>}
          <button type="submit" disabled={busy}
            className="w-full bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50">
            {busy ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
