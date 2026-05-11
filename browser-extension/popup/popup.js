(async function () {
  const $ = (id) => document.getElementById(id);
  const DEFAULT_AGENT_REST = 'http://127.0.0.1:7443/v1';

  function setStatus(ok, label) {
    const s = $('status');
    s.textContent = label;
    s.classList.toggle('ok', ok);
    s.classList.toggle('bad', !ok);
  }
  try {
    const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'getConfig' }, r));
    const cfg = res?.config || {};
    $('endpoint').textContent = cfg.endpointId || '(unenrolled)';
    $('strict').textContent = cfg.strictMode ? 'on' : 'off';
    const resp = await fetch((cfg.agentRest || DEFAULT_AGENT_REST) + '/healthz').catch(() => null);
    if (resp && resp.ok) {
      const j = await resp.json();
      $('policy').textContent = j.policy || 'unknown';
      setStatus(true, 'connected');
    } else {
      setStatus(false, 'agent down');
      $('policy').textContent = '(agent unreachable)';
    }
  } catch (e) {
    setStatus(false, 'error');
  }
  const last = (await new Promise(r => chrome.storage.local.get(['lastIncident'], r))).lastIncident;
  $('last').textContent = last ? new Date(last).toLocaleString() : '\u2014';
})();
