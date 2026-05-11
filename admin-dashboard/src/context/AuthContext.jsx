import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, clearToken, getToken, onAuthFailure } from '../api/client.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    const t = getToken();
    if (!t) { setReady(true); return; }
    api('/auth/me')
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  // Listen for auth failures from apiClient (e.g. refresh failed)
  useEffect(() => {
    return onAuthFailure(() => {
      setUser(null);
    });
  }, []);

  async function login(email, password) {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(data.access_token);
    const u = data.user || { email, role: 'admin' };
    setUser(u);
    if (data.must_change_password) {
      setMustChangePassword(true);
      return { ...u, mustChangePassword: true };
    }
    return u;
  }

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearToken();
    setUser(null);
    setMustChangePassword(false);
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, login, logout, mustChangePassword, setMustChangePassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
