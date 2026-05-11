import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from?.pathname || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.mustChangePassword) {
        nav('/change-password', { replace: true });
      } else {
        nav(from, { replace: true });
      }
    } catch (e) {
      setErr(e.error || e.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-base font-semibold tracking-tight text-slate-900">AURO-DLP</div>
          <div className="text-xs text-slate-500">Admin Console</div>
        </div>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Email</label>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="admin@hospital.local"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-md">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="text-xs text-slate-400 text-center">
            admin@hospital.local / changeme-on-first-login
          </div>
        </form>
      </div>
    </div>
  );
}
