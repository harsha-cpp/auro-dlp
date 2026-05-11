// AURO-DLP — Gmail compose monitor (content script, ISOLATED world)
(function () {
  'use strict';

  if (!location.hostname.endsWith('mail.google.com')) return;

  const STATE = { pasteBuffer: [], lastSnapshotAt: 0 };
  const PASTE_WINDOW_MS = 60_000;

  // --- Logging via lib/log.js pattern (inline since non-module context) ---
  const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  let logLevel = 'info';
  const log = {
    debug: (...a) => LOG_LEVELS.debug >= LOG_LEVELS[logLevel] && console.debug('[AURO-DLP]', ...a),
    info: (...a) => LOG_LEVELS.info >= LOG_LEVELS[logLevel] && console.info('[AURO-DLP]', ...a),
    warn: (...a) => LOG_LEVELS.warn >= LOG_LEVELS[logLevel] && console.warn('[AURO-DLP]', ...a),
    error: (...a) => LOG_LEVELS.error >= LOG_LEVELS[logLevel] && console.error('[AURO-DLP]', ...a),
  };

  // Load logLevel from config
  chrome.runtime.sendMessage({ type: 'getConfig' }, (res) => {
    if (res?.config?.logLevel) logLevel = res.config.logLevel;
  });

  // --- Utilities ---
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // A5: Selector resilience — fallback chains for Gmail class selectors
  const COMPOSE_SELECTORS = [
    '[role="dialog"]',
    'div.M9',
    'div[aria-label*="essage"]',
    'div[gh="cm"]',
    'div.nH[data-legacy-compose-id]',
  ];

  function findCompose(target) {
    if (!target) return null;
    const el = target.nodeType === 1 ? target : (target.parentElement || null);
    if (!el || typeof el.closest !== 'function') return null;
    for (const sel of COMPOSE_SELECTORS) {
      const found = el.closest(sel);
      if (found) return found;
    }
    return null;
  }

  function getBody(compose) {
    const editor = compose.querySelector('[contenteditable="true"][role="textbox"]') ||
                   compose.querySelector('[contenteditable="true"]');
    return editor ? editor.innerText.trim() : '';
  }

  function getSubject(compose) {
    const sub = compose.querySelector('input[name="subjectbox"], input[aria-label*="ubject"]');
    return sub ? sub.value : '';
  }

  // A19: Scope recipients to To/Cc/Bcc containers only
  function getRecipients(compose) {
    const selectors = [
      '[aria-label*="To"] [email]',
      '[aria-label*="Cc"] [email]',
      '[aria-label*="Bcc"] [email]',
      '[name="to"] [email]',
      '[name="cc"] [email]',
      '[name="bcc"] [email]',
    ];
    const emails = new Set();
    for (const sel of selectors) {
      for (const el of compose.querySelectorAll(sel)) {
        const addr = el.getAttribute('email');
        if (addr) emails.add(addr);
      }
    }
    return [...emails];
  }

  // A5: Fallback selectors for attachments
  function getAttachments(compose) {
    const sels = [
      'div[command="Files"]',
      'div[role="listitem"] [aria-label*="ttach"]',
      'div.dXiKIc',
      'div[data-chip-action="ATTACHMENT"]',
    ];
    const results = [];
    for (const sel of sels) {
      for (const el of compose.querySelectorAll(sel)) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').slice(0, 256);
        if (name) results.push({ name });
      }
    }
    return results;
  }

  // A5: Send button detection with fallback chain + telemetry
  const SEND_SELECTORS = [
    '.IZ .Up div > div[role=button]:not([aria-haspopup=true])',
    'div[data-tooltip^="Send" i][role="button"]',
    'div[aria-label^="Send" i][role="button"]',
  ];

  function isSendButton(el) {
    if (!el || !el.matches) return false;
    if (el.dataset && el.dataset.auroSend === 'recursing') return false;
    for (let i = 0; i < SEND_SELECTORS.length; i++) {
      if (el.matches(SEND_SELECTORS[i])) {
        if (i > 0) reportSelectorFallback(SEND_SELECTORS[i]);
        return true;
      }
    }
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const data = (el.getAttribute('data-tooltip') || '').toLowerCase();
    if (role === 'button' && (aria.startsWith('send') || data.startsWith('send') || aria.includes('send (ctrl') || aria.includes('send (\u2318'))) {
      reportSelectorFallback('aria-heuristic');
      return true;
    }
    return false;
  }

  function findSendButton(compose) {
    for (const sel of SEND_SELECTORS) {
      const btn = compose.querySelector(sel);
      if (btn) return btn;
    }
    return compose.querySelector('[role="button"][aria-label^="Send" i]') ||
           compose.querySelector('[role="button"][data-tooltip^="Send" i]');
  }

  function reportSelectorFallback(selector) {
    try {
      chrome.runtime.sendMessage({
        type: 'telemetry',
        payload: { event: 'selector_fallback', selector, url: location.href, ts: Date.now() }
      });
    } catch {}
  }

  // --- Paste / Drop hooks (A6: read HTML, files) ---
  document.addEventListener('paste', (e) => {
    if (!findCompose(e.target)) return;
    try {
      const cd = e.clipboardData;
      if (!cd) return;
      const html = cd.getData('text/html') || '';
      const text = cd.getData('text/plain') || '';
      const content = (text || stripTags(html)).slice(0, 50_000);

      const files = [];
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }

      if (content) {
        STATE.pasteBuffer.push({ ts: Date.now(), text: content });
        const cutoff = Date.now() - PASTE_WINDOW_MS;
        STATE.pasteBuffer = STATE.pasteBuffer.filter(p => p.ts > cutoff);
      }

      if (files.length) {
        inspectFiles(files);
      } else if (content) {
        requestInspect({ source: 'gmail.compose', kind: 'paste', content }, false);
      }
    } catch (err) {
      log.error('paste handler', err);
    }
  }, true);

  document.addEventListener('drop', (e) => {
    if (!findCompose(e.target)) return;
    try {
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files || []);
      if (files.length) {
        inspectFiles(files);
      }
    } catch (err) {
      log.error('drop handler', err);
    }
  }, true);

  function stripTags(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  function inspectFiles(files) {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('source', 'gmail.compose');
      formData.append('kind', 'file');
      chrome.runtime.sendMessage({
        type: 'inspectFile',
        payload: { fileName: file.name, size: file.size }
      });
    }
  }

  // --- Send interception ---
  async function interceptSend(e, btn, compose) {
    if (compose.dataset.auroApproved === '1') return;
    e.stopImmediatePropagation();
    e.preventDefault();

    const snapshot = {
      source: 'gmail.compose',
      kind: 'send',
      url: location.href,
      content: getBody(compose),
      recipients: getRecipients(compose),
      files: getAttachments(compose).map(a => ({ name: a.name })),
      context: {
        subject: getSubject(compose),
        paste_count: STATE.pasteBuffer.length,
      },
    };

    showSpinner();
    let verdict;
    try {
      verdict = await requestInspect(snapshot, false);
    } catch (err) {
      verdict = { verdict: 'BLOCK', risk: 1, matches: [], warning_message: 'AURO-DLP error: ' + err.message };
    }
    hideSpinner();

    if (verdict.verdict === 'ALLOW') {
      compose.dataset.auroApproved = '1';
      reFireSend(btn, compose);
      return;
    }

    const decision = await renderModal(verdict);
    if (decision.action === 'approve' && verdict.verdict !== 'BLOCK_NO_OVERRIDE') {
      compose.dataset.auroApproved = '1';
      reFireSend(btn, compose);
    }
  }

  function safeClosest(target, sel) {
    if (!target) return null;
    const el = target.nodeType === 1 ? target : (target.parentElement || null);
    return el && typeof el.closest === 'function' ? el.closest(sel) : null;
  }

  document.addEventListener('click', async (e) => {
    const btn = safeClosest(e.target, '[role="button"]');
    if (!isSendButton(btn)) return;
    const compose = findCompose(btn);
    if (!compose) return;
    await interceptSend(e, btn, compose);
  }, true);

  document.addEventListener('mousedown', async (e) => {
    const btn = safeClosest(e.target, '[role="button"]');
    if (!isSendButton(btn)) return;
    const compose = findCompose(btn);
    if (!compose) return;
    if (compose.dataset.auroApproved === '1') return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  document.addEventListener('keydown', async (e) => {
    const isSendKey = (e.key === 'Enter') && (e.metaKey || e.ctrlKey);
    if (!isSendKey) return;
    const compose = findCompose(e.target) || findCompose(document.activeElement || document.body);
    if (!compose) return;
    if (compose.dataset.auroApproved === '1') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const btn = findSendButton(compose);
    if (!btn) return;
    await interceptSend({ stopImmediatePropagation() {}, preventDefault() {} }, btn, compose);
  }, true);

  // A2: No synthetic mouse events. Use approval flag + natural click propagation.
  function reFireSend(btn, compose) {
    // Set URL-scoped approval token for the XHR patch in MAIN world
    const token = JSON.stringify({
      op: 'send',
      exp: Date.now() + 5000,
      nonce: Math.random().toString(36).slice(2),
    });
    document.documentElement.dataset.auroXhrApproved = token;

    btn.dataset.auroSend = 'recursing';
    btn.click();
    requestAnimationFrame(() => {
      delete btn.dataset.auroSend;
      delete compose.dataset.auroApproved;
    });
  }

  // --- Agent comms ---
  function requestInspect(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'inspect', payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'inspect_failed'));
        resolve(res.verdict);
      });
    });
  }

  // --- UI: Shadow DOM host (A20 + A1 fixes) ---
  // WeakMap to store shadow root references for closed shadow roots
  const shadowRoots = new WeakMap();
  let hostEl = null;
  let savedActiveElement = null;

  function ensureHost() {
    if (hostEl && document.body.contains(hostEl)) return hostEl;
    hostEl = document.createElement('div');
    hostEl.id = 'auro-dlp-host';
    // A1: Zero-footprint host on document.body
    hostEl.style.cssText = 'width:0;height:0;position:fixed;top:0;left:0;contain:layout style;pointer-events:none;z-index:2147483647;overflow:visible;';
    document.body.appendChild(hostEl);
    // A20: Capture shadow root return value (closed roots have null .shadowRoot)
    const sr = hostEl.attachShadow({ mode: 'closed' });
    shadowRoots.set(hostEl, sr);
    return hostEl;
  }

  function getShadowRoot() {
    if (!hostEl) ensureHost();
    return shadowRoots.get(hostEl);
  }

  function showSpinner() {
    ensureHost();
    const sr = getShadowRoot();
    if (sr.querySelector('#auro-spin')) return;
    const el = document.createElement('div');
    el.id = 'auro-spin';
    el.innerHTML = `
      <style>
        #auro-spin .auro-spin-inner { position:fixed; bottom:24px; right:24px; pointer-events:auto;
          background:#0f172a; color:#fff; padding:10px 14px; border-radius:10px;
          font-family: Inter, system-ui, sans-serif; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,.2); display:flex; gap:10px; align-items:center;}
        .dot { width:8px; height:8px; border-radius:50%; background:#38bdf8; animation:auro-pulse 1s infinite ease-in-out; }
        @keyframes auro-pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
      </style>
      <div class="auro-spin-inner"><span class="dot"></span> AURO-DLP inspecting\u2026</div>`;
    sr.appendChild(el);
  }

  function hideSpinner() {
    const sr = getShadowRoot();
    sr?.querySelector('#auro-spin')?.remove();
  }

  // A15: Focus trap + scroll lock
  function renderModal(verdict) {
    return new Promise((resolve) => {
      ensureHost();
      const sr = getShadowRoot();
      const wrap = document.createElement('div');
      wrap.id = 'auro-modal-wrap';
      wrap.innerHTML = modalHtml(verdict);
      sr.appendChild(wrap);

      // A15: Lock body & trap focus
      savedActiveElement = document.activeElement;
      document.body.setAttribute('inert', '');

      const focusableEls = () => wrap.querySelectorAll('button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])');
      const focusFirst = () => { const els = focusableEls(); if (els.length) els[0].focus(); };
      requestAnimationFrame(focusFirst);

      // Tab trap
      wrap.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const els = focusableEls();
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });

      const close = (action, payload = {}) => {
        wrap.remove();
        document.body.removeAttribute('inert');
        if (savedActiveElement) { try { savedActiveElement.focus(); } catch {} }
        resolve({ action, ...payload });
      };

      wrap.querySelector('#auro-cancel')?.addEventListener('click', () => close('cancel'));

      // Escape key closes
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close('cancel');
      });

      const ackBox = wrap.querySelector('#auro-ack');
      const reasonInput = wrap.querySelector('#auro-reason');
      const approveBtn = wrap.querySelector('#auro-approve');
      const totpInput = wrap.querySelector('#auro-totp');

      const recompute = () => {
        if (!approveBtn) return;
        if (verdict.verdict === 'BLOCK') {
          approveBtn.disabled = !(totpInput?.value?.length === 6 && reasonInput?.value?.trim().length >= 8);
        } else if (verdict.verdict === 'WARN') {
          approveBtn.disabled = !(ackBox?.checked && reasonInput?.value?.trim().length >= 4);
        }
      };
      if (verdict.verdict === 'BLOCK_NO_OVERRIDE') {
        approveBtn?.remove();
      }
      ackBox?.addEventListener('change', recompute);
      reasonInput?.addEventListener('input', recompute);
      totpInput?.addEventListener('input', recompute);
      recompute();

      approveBtn?.addEventListener('click', () => {
        if (verdict.verdict === 'BLOCK') {
          chrome.runtime.sendMessage({
            type: 'override',
            payload: { incident_id: verdict.incident_id, totp: totpInput.value, reason: reasonInput.value }
          }, (r) => {
            if (r?.ok && r.body?.approved) close('approve', { override_id: r.body.override_id });
            else {
              const err = wrap.querySelector('#auro-err');
              if (err) err.textContent = 'Override rejected. Contact security.';
            }
          });
        } else {
          close('approve', { reason: reasonInput?.value });
        }
      });
    });
  }

  function modalHtml(v) {
    const isHard = v.verdict === 'BLOCK_NO_OVERRIDE';
    const isBlock = v.verdict === 'BLOCK';
    const isWarn = v.verdict === 'WARN';
    const tone = (isBlock || isHard) ? '#dc2626' : isWarn ? '#d97706' : '#16a34a';
    const reasons = (v.matches || []).map(m => `<li><code>${m.rule_id}</code> \u00d7 ${m.count}</li>`).join('');
    const cats = (v.categories || []).map(c => `<span class="tag">${c}</span>`).join('');
    const title = isHard ? 'Sending blocked \u2014 non-overridable' :
                  isBlock ? 'Sending blocked' :
                  isWarn ? 'Sensitive content detected' : 'Cleared';
    return `
      <style>
        * { box-sizing: border-box; }
        .auro-mask { position:fixed; inset:0; pointer-events:auto; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; font-family: Inter, system-ui, sans-serif; z-index:2147483647; }
        .card { width:540px; max-width:92vw; background:#fff; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); overflow:hidden; }
        .head { padding:18px 22px; color:#fff; background:${tone}; display:flex; align-items:center; gap:10px;}
        .head h2 { margin:0; font-size:18px; font-weight:700; color:#fff; font-family:inherit; }
        .body { padding:18px 22px; color:#0f172a; font-size:14px; line-height:1.5;}
        .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:#f1f5f9; color:#0f172a; font-size:12px; margin-right:6px;}
        .reasons { margin:8px 0 14px 0; padding-left:18px; color:#334155; font-size:13px; }
        .reasons code { background:#f1f5f9; padding:1px 4px; border-radius:4px; font-family: ui-monospace, SFMono-Regular, monospace;}
        textarea, input[type="text"], input[inputmode="numeric"] { font-family:inherit; font-size:13px; color:#0f172a; width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; margin-top:6px; outline:none; }
        textarea:focus, input:focus { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.2); }
        label { display:block; margin-top:10px; font-size:12px; color:#475569; font-weight:600; }
        .row { display:flex; gap:10px; align-items:center; margin-top:10px; }
        .row input[type=checkbox] { width:16px; height:16px; accent-color:${tone}; }
        .foot { padding:14px 22px; background:#f8fafc; display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #e2e8f0;}
        button { padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; border:none; font-family:inherit; }
        .btn-cancel { background:#e2e8f0; color:#0f172a; }
        .btn-cancel:hover { background:#cbd5e1; }
        .btn-approve { background:${tone}; color:#fff; }
        .btn-approve:hover:not([disabled]) { filter:brightness(1.1); }
        .btn-approve[disabled] { background:#cbd5e1; color:#64748b; cursor:not-allowed; }
        .err { color:#dc2626; font-size:12px; margin-top:6px; min-height:14px; }
      </style>
      <div class="auro-mask">
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="auro-title">
          <div class="head">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
            <h2 id="auro-title">${title}</h2>
          </div>
          <div class="body">
            <div>${cats}</div>
            <p style="margin:10px 0 4px 0;">${v.warning_message || 'This message contains data that may not be sent externally.'}</p>
            <ul class="reasons">${reasons || '<li>Composite risk score elevated.</li>'}</ul>
            ${(isWarn || isBlock) ? `
              <label>Business reason${isBlock ? ' (required)' : ''}</label>
              <textarea id="auro-reason" rows="3" placeholder="Why must this leave the hospital network?"></textarea>
            ` : ''}
            ${isWarn ? `
              <div class="row"><input type="checkbox" id="auro-ack"/> <span>I acknowledge that I am personally responsible for this transmission.</span></div>
            ` : ''}
            ${isBlock ? `
              <label>Admin override TOTP</label>
              <input id="auro-totp" inputmode="numeric" pattern="[0-9]{6}" placeholder="6-digit code from security on-call"/>
              <div class="err" id="auro-err"></div>
            ` : ''}
          </div>
          <div class="foot">
            <button class="btn-cancel" id="auro-cancel">${v.verdict === 'ALLOW' ? 'Close' : (isHard ? 'Acknowledge' : 'Cancel send')}</button>
            ${(isWarn || isBlock) ? `<button class="btn-approve" id="auro-approve" disabled>${isBlock ? 'Submit override' : 'Send anyway'}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  log.info('content script attached on', location.href);
})();
