// AURO-DLP — page-world (MAIN) XHR backstop.
// Runs in mail.google.com's own JS context so we can monkey-patch
// XMLHttpRequest before Gmail uses it. The isolated content script handles
// UI/messaging; this file's only job is: if Gmail tries to POST a send
// without our approval flag, throw before the network call leaves the box.
(function () {
  'use strict';

  if (window.__auroXhrPatched) return;
  window.__auroXhrPatched = true;

  // Gmail's classic send URL contains act=sm. The post-2018 "data layer"
  // posts to /sync/u/<n>/i/s with a JSON body containing the action id "sm".
  const CLASSIC_SEND_RE = /[?&]act=sm(?:&|$)/;
  const NEW_LAYER_PATH_RE = /\/sync\/.*\/i\/s\b|\/i\/s\b/;

  function isSendRequest(url, body) {
    if (!url) return false;
    if (CLASSIC_SEND_RE.test(url)) return true;
    if (NEW_LAYER_PATH_RE.test(url) && typeof body === 'string' && body.indexOf('"sm"') !== -1) return true;
    return false;
  }

  function approved() {
    return document.documentElement.dataset.auroXhrApproved === '1';
  }
  function consumeApproval() {
    delete document.documentElement.dataset.auroXhrApproved;
  }
  function notifyBlocked(url, body) {
    try {
      window.dispatchEvent(new CustomEvent('auro:xhr-blocked', {
        detail: { url, bodyPreview: typeof body === 'string' ? body.slice(0, 4096) : '' },
      }));
    } catch {}
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__auroMeta = { method: String(method || ''), url: String(url || '') };
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__auroMeta;
    if (meta && isSendRequest(meta.url, body)) {
      if (approved()) {
        consumeApproval();
        return origSend.apply(this, arguments);
      }
      notifyBlocked(meta.url, body);
      throw new Error('AURO-DLP: send blocked at network layer');
    }
    return origSend.apply(this, arguments);
  };

  // fetch() backstop — Gmail uses XHR today but this future-proofs against
  // a migration to fetch() for sends.
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const body = init && init.body;
        if (isSendRequest(url, typeof body === 'string' ? body : '')) {
          if (approved()) {
            consumeApproval();
          } else {
            notifyBlocked(url, body);
            return Promise.reject(new Error('AURO-DLP: send blocked at network layer'));
          }
        }
      } catch {}
      return origFetch.apply(this, arguments);
    };
  }

  console.log('[AURO-DLP] XHR backstop installed in MAIN world');
})();
