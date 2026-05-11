import crypto from 'node:crypto';
import net from 'node:net';

const siemStatus = {
  splunk: { ok: false, lastSuccess: null, lastError: null },
  syslog: { ok: false, lastSuccess: null, lastError: null },
  webhook: { ok: false, lastSuccess: null, lastError: null },
};

export function getSiemStatus() {
  return { ...siemStatus };
}

export async function forwardSiem(eventType, payload) {
  const event = { '@ts': new Date().toISOString(), event_type: eventType, ...payload };
  await Promise.allSettled([
    forwardHEC(event),
    forwardSyslog(event),
    forwardWebhook(event),
  ]);
}

async function forwardHEC(event) {
  const url = process.env.SIEM_HEC_URL;
  const token = process.env.SIEM_HEC_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'authorization': `Splunk ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event, sourcetype: 'auro:dlp' }),
    });
    siemStatus.splunk = { ok: true, lastSuccess: new Date().toISOString(), lastError: null };
  } catch (e) {
    siemStatus.splunk = { ok: false, lastSuccess: siemStatus.splunk.lastSuccess, lastError: e.message };
  }
}

async function forwardSyslog(event) {
  const url = process.env.SIEM_SYSLOG_URL;
  if (!url) return;
  const m = url.match(/^tcp:\/\/([^:]+):(\d+)$/i);
  if (!m) return;
  const [, host, port] = m;
  try {
    await new Promise((resolve, reject) => {
      const sock = net.connect({ host, port: Number(port) }, () => {
        const msg = `<17>1 ${event['@ts']} auro auro-policy ${process.pid} ${event.event_type} - ${JSON.stringify(event)}\n`;
        sock.end(msg);
        resolve();
      });
      sock.on('error', reject);
      sock.setTimeout(2000, () => { sock.destroy(); reject(new Error('syslog timeout')); });
    });
    siemStatus.syslog = { ok: true, lastSuccess: new Date().toISOString(), lastError: null };
  } catch (e) {
    siemStatus.syslog = { ok: false, lastSuccess: siemStatus.syslog.lastSuccess, lastError: e.message };
  }
}

async function forwardWebhook(event) {
  const url = process.env.SIEM_WEBHOOK_URL;
  if (!url) return;
  const secret = process.env.SIEM_WEBHOOK_SECRET || '';
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auro-signature': `sha256=${sig}` },
      body,
    });
    siemStatus.webhook = { ok: true, lastSuccess: new Date().toISOString(), lastError: null };
  } catch (e) {
    siemStatus.webhook = { ok: false, lastSuccess: siemStatus.webhook.lastSuccess, lastError: e.message };
  }
}
