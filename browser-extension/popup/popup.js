(async function () {
  const $ = (id) => document.getElementById(id);
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
    // Health check via REST
    const resp = await fetch((cfg.agentRest || 'https://127.0.0.1:7443/v1') + '/healthz').catch(() => null);
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
  // Last incident from local storage
  const last = (await new Promise(r => chrome.storage.local.get(['lastIncident'], r))).lastIncident;
  $('last').textContent = last ? new Date(last).toLocaleString() : '—';
})();
