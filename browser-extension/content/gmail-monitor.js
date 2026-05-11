// AURO-DLP — Gmail compose monitor (content script)
// Strategy:
//  1. Observe DOM for compose dialogs (role="dialog" with a Send button matching aria-label).
//  2. Attach capture-phase click handler on Send buttons.
//  3. On click: snapshot body + attachments + recipients; ask agent.
//  4. Pause the click; render warning modal in a closed shadow root.
//  5. On approval, programmatically re-fire send.

(function () {
  'use strict';

  // Same-frame guard — refuse to operate if iframed by something other than mail.google.com top.
  if (window.top !== window.self && location.origin !== 'https://mail.google.com') {
    return;
  }

  const STATE = {
    pasteBuffer: [],     // last 60s of paste events {ts, text}
    lastSnapshotAt: 0,
  };
  const PASTE_WINDOW_MS = 60_000;

  // ---------- Utilities ----------
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function findCompose(target) {
    if (!target) return null;
    const el = target.nodeType === 1 ? target : (target.parentElement || null);
    if (!el || typeof el.closest !== 'function') return null;
    return el.closest('[role="dialog"], div.M9, div[aria-label*="essage"], div[gh="cm"]') || null;
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
  function getRecipients(compose) {
    // Gmail uses spans with email='' attribute for chips
    return $all('[email]', compose).map(el => el.getAttribute('email')).filter(Boolean);
  }
  function getAttachments(compose) {
    // Visible attachment chips after upload completes
    return $all('div[command="Files"], div[role="listitem"] [aria-label*="ttach"], div.dXiKIc', compose)
      .map(el => ({
        name: (el.getAttribute('aria-label') || el.textContent || '').slice(0, 256),
      }))
      .filter(a => a.name);
  }
  function isSendButton(el) {
    if (!el || !el.matches) return false;
    if (el.dataset && el.dataset.auroSend === 'recursing') return false;
    // InboxSDK-proven stable selector. .IZ .Up is the compose-toolbar
    // container Gmail has used since 2018. .Uo marks Send-and-archive,
    // [aria-haspopup=true] marks the Schedule-send dropdown chevron.
    if (el.matches('.IZ .Up div > div[role=button]:not([aria-haspopup=true])')) return true;
    // Fallback: aria/data-tooltip text match for builds where the class
    // selector misses (older Gmail, A/B variants).
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const data = (el.getAttribute('data-tooltip') || '').toLowerCase();
    return (
      role === 'button' &&
      (aria.startsWith('send') || aria === 'send' || data.startsWith('send') || aria.includes('send (ctrl') || aria.includes('send (\u2318'))
    );
  }
  function findSendButton(compose) {
    return (
      compose.querySelector('.IZ .Up div > div[role=button]:not([aria-haspopup=true])') ||
      compose.querySelector('[role="button"][aria-label^="Send" i]') ||
      compose.querySelector('[role="button"][data-tooltip^="Send" i]')
    );
  }

  // ---------- Paste / Drop hooks ----------
  document.addEventListener('paste', (e) => {
    if (!findCompose(e.target)) return;
    try {
      const text = (e.clipboardData?.getData('text/plain') || '').slice(0, 50_000);
      if (!text) return;
      STATE.pasteBuffer.push({ ts: Date.now(), text });
      // Keep only recent
      const cutoff = Date.now() - PASTE_WINDOW_MS;
      STATE.pasteBuffer = STATE.pasteBuffer.filter(p => p.ts > cutoff);
      // Inline lightweight inspect for highly-sensitive paste
      requestInspect({ source: 'gmail.compose', kind: 'paste', content: text }, /* render */ false);
    } catch {}
  }, true);

  document.addEventListener('drop', (e) => {
    if (!findCompose(e.target)) return;
    try {
      const items = Array.from(e.dataTransfer?.items || []);
      const fileNames = items.filter(i => i.kind === 'file').map(i => i.getAsFile()?.name).filter(Boolean);
      if (fileNames.length) {
        requestInspect({ source: 'gmail.compose', kind: 'drop', content: '', files: fileNames.map(n => ({ path: n })) }, false);
      }
    } catch {}
  }, true);

  // ---------- Send capture (click + mousedown + keyboard shortcut) ----------
  // Three layers of interception so Gmail cannot bypass via:
  //   - keyboard shortcut Cmd+Enter / Ctrl+Enter
  //   - mousedown-driven send (some Gmail builds fire on mousedown, not click)
  //   - normal mouse click on the Send button
  // All registered in capture phase so we run before Gmail's own delegated handlers.

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

    showSpinner(compose);
    let verdict;
    try {
      verdict = await requestInspect(snapshot, false);
    } catch (err) {
      verdict = { verdict: 'BLOCK', risk: 1, matches: [], warning_message: 'AURO-DLP error: ' + err.message };
    }
    hideSpinner(compose);

    if (verdict.verdict === 'ALLOW') {
      compose.dataset.auroApproved = '1';
      reFireSend(btn);
      return;
    }

    const decision = await renderModal(verdict, snapshot);
    if (decision.action === 'approve' && verdict.verdict !== 'BLOCK_NO_OVERRIDE') {
      compose.dataset.auroApproved = '1';
      reFireSend(btn);
    }
  }

  // Layer 1: click (capture)
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

  // Layer 3: keyboard shortcut (Cmd+Enter on macOS, Ctrl+Enter on Win/Linux).
  // Gmail listens at document/window level; capture phase ensures we run first.
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

  function reFireSend(btn) {
    // Set the page-world XHR backstop's one-shot approval flag IMMEDIATELY
    // before dispatching the click. Gmail's XHR fires synchronously inside
    // the click handler, so the flag must be on the DOM before any event
    // is dispatched.
    document.documentElement.dataset.auroXhrApproved = '1';
    btn.dataset.auroSend = 'recursing';
    // Use initMouseEvent (legacy API) per InboxSDK — Gmail's delegated
    // handler reads coordinates and synthetic events from `new MouseEvent()`
    // sometimes fail to flow through. Add mouseleave+mouseout+blur to
    // commit any unsaved chip/input state before send.
    const x = btn.offsetLeft, y = btn.offsetTop;
    for (const name of ['mousedown', 'mouseup', 'click', 'mouseleave', 'mouseout']) {
      const ev = document.createEvent('MouseEvents');
      ev.initMouseEvent(name, true, true, window, 0, x, y, x, y, false, false, false, false, 0, null);
      btn.dispatchEvent(ev);
    }
    btn.blur();
    requestAnimationFrame(() => { delete btn.dataset.auroSend; });
  }

  // ---------- Agent comms ----------
  function requestInspect(payload, render = false) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'inspect', payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'inspect_failed'));
        resolve(res.verdict);
      });
    });
  }

  // ---------- UI: spinner + modal in shadow DOM ----------
  let host;
  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = 'auro-dlp-host';
    host.style.cssText = 'all:initial; position:fixed; inset:0; pointer-events:none; z-index:2147483647;';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'closed' });
    return host;
  }

  function showSpinner(compose) {
    const h = ensureHost();
    const sr = h.shadowRoot;
    if (!sr.querySelector('#spin')) {
      const el = document.createElement('div');
      el.id = 'spin';
      el.innerHTML = `
        <style>
          .auro-spin { all:initial; position:fixed; bottom:24px; right:24px; pointer-events:auto;
            background:#0f172a; color:#fff; padding:10px 14px; border-radius:10px;
            font-family: Inter, system-ui, sans-serif; font-size:13px; box-shadow:0 8px 24px rgba(0,0,0,.2); display:flex; gap:10px; align-items:center;}
          .dot { width:8px; height:8px; border-radius:50%; background:#38bdf8; animation:p 1s infinite ease-in-out; }
          @keyframes p { 0%,100%{opacity:.3} 50%{opacity:1} }
        </style>
        <div class="auro-spin"><span class="dot"></span> AURO-DLP inspecting…</div>`;
      sr.appendChild(el);
    }
  }
  function hideSpinner() {
    const sr = host?.shadowRoot;
    sr?.querySelector('#spin')?.remove();
  }

  function renderModal(verdict, snapshot) {
    return new Promise((resolve) => {
      const h = ensureHost();
      const sr = h.shadowRoot;
      const wrap = document.createElement('div');
      wrap.innerHTML = modalHtml(verdict);
      sr.appendChild(wrap);

      const close = (action, payload = {}) => { wrap.remove(); resolve({ action, ...payload }); };

      wrap.querySelector('#auro-cancel')?.addEventListener('click', () => close('cancel'));

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

      approveBtn?.addEventListener('click', async () => {
        if (verdict.verdict === 'BLOCK') {
          // Verify TOTP via agent → server
          chrome.runtime.sendMessage({ type: 'override',
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
    const reasons = (v.matches || []).map(m => `<li><code>${m.rule_id}</code> &times; ${m.count}</li>`).join('');
    const cats = (v.categories || []).map(c => `<span class="tag">${c}</span>`).join('');
    const title = isHard ? 'Sending blocked — non-overridable' :
                  isBlock ? 'Sending blocked' :
                  isWarn ? 'Sensitive content detected' : 'Cleared';
    return `
      <style>
        :host, .auro-mask { all: initial; }
        .auro-mask { position:fixed; inset:0; pointer-events:auto; background:rgba(15,23,42,.55); display:flex; align-items:center; justify-content:center; font-family: Inter, system-ui, sans-serif; }
        .card { width:540px; max-width:92vw; background:#fff; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); overflow:hidden; }
        .head { padding:18px 22px; color:#fff; background:${tone}; display:flex; align-items:center; gap:10px;}
        .head h2 { all:initial; font-family:inherit; font-size:18px; font-weight:700; color:#fff; }
        .body { padding:18px 22px; color:#0f172a; font-size:14px; line-height:1.5;}
        .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:#f1f5f9; color:#0f172a; font-size:12px; margin-right:6px;}
        .reasons { margin:8px 0 14px 0; padding-left:18px; color:#334155; font-size:13px; }
        .reasons code { background:#f1f5f9; padding:1px 4px; border-radius:4px; font-family: ui-monospace, SFMono-Regular, monospace;}
        textarea, input { all:initial; font-family:inherit; font-size:13px; color:#0f172a; width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; margin-top:6px;}
        label { display:block; margin-top:10px; font-size:12px; color:#475569; font-weight:600; }
        .row { display:flex; gap:10px; align-items:center; margin-top:10px; }
        .row input[type=checkbox] { width:16px; height:16px; }
        .foot { padding:14px 22px; background:#f8fafc; display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #e2e8f0;}
        button { all:initial; font-family:inherit; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; }
        .btn-cancel { background:#e2e8f0; color:#0f172a; }
        .btn-approve { background:${tone}; color:#fff; }
        .btn-approve[disabled] { background:#cbd5e1; color:#64748b; cursor:not-allowed; }
        .err { color:#dc2626; font-size:12px; margin-top:6px; min-height:14px; }
      </style>
      <div class="auro-mask">
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="t">
          <div class="head">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
            <h2 id="t">${title}</h2>
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

  // Surface to console so QA can verify load.
  // eslint-disable-next-line no-console
  console.log('[AURO-DLP] content script attached on', location.href);
})();
