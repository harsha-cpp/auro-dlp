// Lightweight fetch wrapper with automatic token refresh and SSE support.
const TOKEN_KEY = 'auro.token';

const authListeners = new Set();
export function onAuthFailure(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
function emitAuthFailure() { authListeners.forEach((fn) => fn()); }

export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

/** Build query string from object, skipping falsy values */
export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) p.set(k, String(v));
  });
  return p.toString();
}

let refreshPromise = null;

async function refreshToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json();
      setToken(data.access_token);
      return data.access_token;
    } catch {
      clearToken();
      emitAuthFailure();
      throw new Error('session expired');
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;

  if (!t && path !== '/auth/login') return null;

  let res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });

  if (res.status === 401) {
    try {
      const newToken = await refreshToken();
      headers.authorization = `Bearer ${newToken}`;
      res = await fetch(`/api/v1${path}`, {
        ...opts,
        headers,
        body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
      });
    } catch {
      clearToken();
      emitAuthFailure();
      throw { error: 'Session expired', status: 401 };
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/** SSE helper. Returns a close() function. Passes token as query param since EventSource can't send custom headers. */
export function apiStream(path, onEvent) {
  const token = getToken();
  if (!token) return { close() { /* no-op — not authenticated */ } };
  const url = `/api/v1${path}?token=${encodeURIComponent(token)}`;
  let es = null;
  let closed = false;
  let onOpen = null;
  let onError = null;

  function connect() {
    if (closed) return;
    es = new EventSource(url);
    es.onopen = () => { if (onOpen) onOpen(); };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(data.type || e.type, data);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      if (onError) onError();
      es.close();
      if (!closed) setTimeout(connect, 3000);
    };
  }

  connect();

  return {
    close() { closed = true; if (es) es.close(); },
    set onopen(fn) { onOpen = fn; },
    set onerror(fn) { onError = fn; },
  };
}
