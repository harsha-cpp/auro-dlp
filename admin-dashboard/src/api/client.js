// Lightweight fetch wrapper. Stores JWT in sessionStorage so a tab close
// invalidates the session.
const TOKEN_KEY = 'auro.token';

export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

export async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`/api/v1${path}`, { ...opts, headers, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
