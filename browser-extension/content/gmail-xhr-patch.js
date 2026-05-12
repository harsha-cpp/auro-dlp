// AURO-DLP — MAIN world XHR/fetch backstop for Gmail send interception.
// Security-critical: prevents network egress of PHI without approval token.
(function () {
  'use strict';

  if (!location.hostname.endsWith('mail.google.com')) return;
  if (window.__auroXhrPatched) return;
  window.__auroXhrPatched = true;

  // Matches Gmail Sync send endpoint only (not draft-save /i/d)
  const SEND_URL_RE = /^https?:\/\/mail\.google\.com\/sync\/u\/\d+\/i\/s/;

  function isSendRequest(url) {
    return SEND_URL_RE.test(url);
  }

  function readApproval() {
    const raw = document.documentElement.dataset.auroXhrApproved;
    if (!raw) return null;
    try {
      const token = JSON.parse(raw);
      if (token.op === 'send' && token.exp > Date.now()) return token;
    } catch {}
    return null;
  }

  function consumeApproval(url) {
    if (!isSendRequest(url)) return false;
    const token = readApproval();
    if (!token) return false;
    return true;
  }

  function notifyBlocked(url) {
    try {
      window.dispatchEvent(new CustomEvent('auro:xhr-blocked', { detail: { url } }));
    } catch {}
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__auroUrl = String(url || '');
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (isSendRequest(this.__auroUrl)) {
      if (consumeApproval(this.__auroUrl)) {
        return origSend.apply(this, arguments);
      }
      notifyBlocked(this.__auroUrl);
      throw new Error('AURO-DLP: send blocked at network layer');
    }
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isSendRequest(url)) {
          if (!consumeApproval(url)) {
            notifyBlocked(url);
            return Promise.reject(new Error('AURO-DLP: send blocked at network layer'));
          }
        }
      } catch {}
      return origFetch.apply(this, arguments);
    };
  }
})();
