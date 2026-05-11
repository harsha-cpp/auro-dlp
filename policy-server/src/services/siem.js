// SIEM forwarder. Three sinks supported:
//
//  1. Splunk HEC          — set SIEM_HEC_URL, SIEM_HEC_TOKEN
//  2. Syslog over TCP     — set SIEM_SYSLOG_URL=tcp://host:514
//  3. Generic webhook     — set SIEM_WEBHOOK_URL, SIEM_WEBHOOK_SECRET (HMAC-SHA-256)
//
// All three are best-effort and never block the request path.
import crypto from 'node:crypto';
import net from 'node:net';

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
  await fetch(url, {
    method: 'POST',
    headers: { 'authorization': `Splunk ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event, sourcetype: 'auro:dlp' }),
  });
}

async function forwardSyslog(event) {
  const url = process.env.SIEM_SYSLOG_URL;
  if (!url) return;
  const m = url.match(/^tcp:\/\/([^:]+):(\d+)$/i);
  if (!m) return;
  const [, host, port] = m;
  await new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) }, () => {
      // Pri 17 = local2.alert. RFC 5424: "<PRI>VER TS HOST APP PROCID MSGID SD MSG"
      const msg = `<17>1 ${event['@ts']} auro auro-policy ${process.pid} ${event.event_type} - ${JSON.stringify(event)}\n`;
      sock.end(msg);
      resolve();
    });
    sock.on('error', reject);
    sock.setTimeout(2000, () => { sock.destroy(); reject(new Error('syslog timeout')); });
  });
}

async function forwardWebhook(event) {
  const url = process.env.SIEM_WEBHOOK_URL;
  if (!url) return;
  const secret = process.env.SIEM_WEBHOOK_SECRET || '';
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auro-signature': `sha256=${sig}`,
    },
    body,
  });
}
