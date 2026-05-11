// AURO-DLP — MV3 service worker
// Responsibilities:
//  - Hold persistent WSS to local agent
//  - Proxy inspect requests from content scripts
//  - Cache last verdict / config
//  - Heartbeat policy server (so dashboard knows extension is alive)

const DEFAULTS = {
  agentEndpoint: 'ws://127.0.0.1:7443/v1/stream',
  agentRest: 'http://127.0.0.1:7443/v1',
  policyServerUrl: 'https://policy.hospital.local:8443/api/v1',
  endpointId: 'unknown',
  logLevel: 'info',
  strictMode: true,
};

let config = { ...DEFAULTS };
let agentSocket = null;
let pending = new Map(); // requestId -> {resolve, reject, timer}
let socketReady = null;

const log = (lvl, ...args) => {
  const order = { debug: 0, info: 1, warn: 2, error: 3 };
  if (order[lvl] >= order[config.logLevel]) {
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl]('[AURO-DLP]', ...args);
  }
};

async function loadConfig() {
  const managed = await new Promise(r => chrome.storage.managed.get(null, r));
  const local = await new Promise(r => chrome.storage.local.get(null, r));
  config = { ...DEFAULTS, ...local, ...managed };
  log('info', 'config loaded', { strictMode: config.strictMode });
}

function newRequestId() {
  return crypto.randomUUID();
}

async function ensureSocket() {
  if (agentSocket && agentSocket.readyState === WebSocket.OPEN) return agentSocket;
  if (socketReady) return socketReady;
  socketReady = new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(config.agentEndpoint);
      ws.onopen = () => {
        log('info', 'agent socket open');
        agentSocket = ws;
        resolve(ws);
      };
      ws.onerror = (e) => {
        log('error', 'agent socket error', e?.message || e);
        socketReady = null;
        reject(new Error('agent_unreachable'));
      };
      ws.onclose = () => {
        log('warn', 'agent socket closed');
        agentSocket = null;
        socketReady = null;
      };
      ws.onmessage = (msg) => {
        try {
          const env = JSON.parse(msg.data);
          const p = pending.get(env.request_id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(env.request_id);
            p.resolve(env.payload);
          }
        } catch (e) {
          log('error', 'bad agent message', e);
        }
      };
    } catch (e) {
      socketReady = null;
      reject(e);
    }
  });
  return socketReady;
}

async function inspect(payload) {
  // First try WSS for low latency. Fall back to REST.
  try {
    const ws = await ensureSocket();
    const requestId = newRequestId();
    const envelope = { request_id: requestId, op: 'inspect', payload };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('agent_timeout'));
      }, 8000);
      pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify(envelope));
    });
  } catch (wsErr) {
    log('warn', 'WSS failed, fallback to REST', wsErr?.message);
    const resp = await fetch(`${config.agentRest}/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(`agent_http_${resp.status}`);
    return await resp.json();
  }
}

function onUnreachableVerdict() {
  if (config.strictMode) {
    return { verdict: 'BLOCK', risk: 1.0, matches: [], categories: ['SYSTEM'],
      warning_message: 'AURO-DLP local agent is unreachable. Contact IT (#dlp-help).',
      policy_version: 'fallback' };
  }
  return { verdict: 'WARN', risk: 0.5, matches: [], categories: ['SYSTEM'],
    warning_message: 'AURO-DLP could not verify this message. Proceed with caution.', policy_version: 'fallback' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'inspect') {
        const verdict = await inspect(msg.payload).catch(err => {
          log('warn', 'inspect failed', err.message);
          return onUnreachableVerdict();
        });
        sendResponse({ ok: true, verdict });
      } else if (msg?.type === 'override') {
        const r = await fetch(`${config.agentRest}/override`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: r.ok, body: await r.json().catch(() => ({})) });
      } else if (msg?.type === 'getConfig') {
        sendResponse({ ok: true, config });
      } else {
        sendResponse({ ok: false, error: 'unknown_op' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});

// Heartbeat the policy server every 5 min so dashboard knows we are alive.
chrome.alarms.create('hb', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'hb') return;
  try {
    await fetch(`${config.policyServerUrl}/agents/extension-heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint_id: config.endpointId, ext_version: chrome.runtime.getManifest().version }),
    });
  } catch (e) {
    log('warn', 'heartbeat failed', e.message);
  }
});

chrome.runtime.onInstalled.addListener(() => loadConfig());
chrome.runtime.onStartup.addListener(() => loadConfig());
loadConfig();
