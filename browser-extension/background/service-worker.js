// AURO-DLP — MV3 service worker
import { DEFAULTS } from '../lib/config.js';
import { log, setLogLevel } from '../lib/log.js';

let config = { ...DEFAULTS };
let agentSocket = null;
let pending = new Map();
let socketReady = null;

async function loadConfig() {
  const managed = await new Promise(r => chrome.storage.managed.get(null, r));
  const local = await new Promise(r => chrome.storage.local.get(null, r));
  config = { ...DEFAULTS, ...local, ...managed };
  setLogLevel(config.logLevel || 'info');
  log.info('config loaded', { strictMode: config.strictMode });
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
        log.info('agent socket open');
        agentSocket = ws;
        resolve(ws);
      };
      ws.onerror = (e) => {
        log.error('agent socket error', e?.message || e);
        socketReady = null;
        reject(new Error('agent_unreachable'));
      };
      ws.onclose = () => {
        log.warn('agent socket closed');
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
          log.error('bad agent message', e);
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
  const resp = await fetch(`${config.agentRest}/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`agent_http_${resp.status}`);
  return await resp.json();
}

function onUnreachableVerdict() {
  if (config.strictMode) {
    return { verdict: 'BLOCK', risk: 1.0, matches: [], categories: ['SYSTEM'],
      warning_message: 'AURO-DLP local agent is unreachable. Contact IT (#dlp-help).',
      policy_version: 'fallback' };
  }
  return { verdict: 'WARN', risk: 0.5, matches: [], categories: ['SYSTEM'],
    warning_message: 'AURO-DLP could not verify this message. Proceed with caution.',
    policy_version: 'fallback' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'inspect') {
        const verdict = await inspect(msg.payload).catch(err => {
          log.warn('inspect failed', err.message);
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
      } else if (msg?.type === 'telemetry') {
        fetch(`${config.agentRest}/telemetry`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(msg.payload),
        }).catch(() => {});
        sendResponse({ ok: true });
      } else if (msg?.type === 'inspectFile') {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown_op' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// A11: Heartbeat must await loadConfig before fetching
chrome.alarms.create('hb', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'hb') return;
  await loadConfig();
  try {
    await fetch(`${config.policyServerUrl}/agents/extension-heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint_id: config.endpointId, ext_version: chrome.runtime.getManifest().version }),
    });
  } catch (e) {
    log.warn('heartbeat failed', e.message);
  }
});

chrome.runtime.onInstalled.addListener(() => loadConfig());
chrome.runtime.onStartup.addListener(() => loadConfig());
loadConfig();
