/* =========================================================
   Asafe · Barramento das linhas de servidor
   - Com o servidor (node server/asafe-server.js) rodando: publica a
     topologia e observa o tráfego.
   - Sem servidor: esta página É o roteador, no próprio navegador
     (BroadcastChannel "asafe-bus").
   ========================================================= */
(function () {
  const { slug, createRouter, CORE } = AsafeRouter;
  const CHANNEL = 'asafe-bus';
  const SERVER_KEY = 'asafe.server';
  const DEFAULT_SERVER = 'http://localhost:7300';

  const listeners = { change: new Set(), traffic: new Set() };
  const emit = (k, v) => listeners[k].forEach(fn => fn(v));

  let mode = 'connecting';
  let server = null;
  let roster = [];
  let router = null;

  function serverUrl() {
    try { return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER; } catch (e) { return DEFAULT_SERVER; }
  }

  /** Topologia no formato do protocolo: ids = nome em minúsculas sem acento (horacio, miqueias). */
  function topology() {
    const s = Store.state;
    const idOf = id => id === CORE ? CORE : slug(Store.nameOf(id));
    return {
      agents: s.agents.map(a => ({ id: slug(a.name), name: a.name, kind: a.kind })),
      links: s.links.map(l => [idOf(l.from), idOf(l.to)])
    };
  }

  const onlineIds = () => new Set(roster.filter(a => a.online).map(a => a.id));

  /* ---------- registro do tráfego ---------- */
  const day = () => new Date().toISOString().slice(0, 10);
  const hhmm = t => new Date(t).toLocaleTimeString('pt-BR');
  const short = v => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t && t.length > 600 ? t.slice(0, 600) + '…' : t; };

  function record(env, info) {
    emit('traffic', { env, info });
    if (!['request', 'response', 'event'].includes(env.type)) return;
    // consultas ao próprio núcleo (roster/ping) não vão para o log, só recusas
    if ((env.to === CORE || env.from === CORE) && info.status !== 'error') return;
    if (info.status === 'denied') return; // a resposta de recusa já entra no log
    let line;
    if (info.status === 'error' && env.type === 'response') {
      line = `[${hhmm(env.ts)}] ✕ ${env.action} recusado para ${env.to}: ${env.error && env.error.message}`;
    } else if (env.type === 'response') {
      line = `[${hhmm(env.ts)}] ${env.from} → ${env.to} · resposta ${env.action} ${env.ok === false ? '✕ ' + short(env.error && env.error.message) : '✓ ' + short(env.payload)}`;
    } else {
      line = `[${hhmm(env.ts)}] ${env.from} → ${env.to} · ${env.type === 'event' ? 'evento' : 'pedido'} ${env.action} ${short(env.payload)}`;
    }
    const ids = [...new Set([env.from, env.to])].filter(id => id !== CORE);
    const agents = ids.map(id => Store.agentBySlug(id)).filter(Boolean);
    agents.forEach((a, i) => {
      const nm = id => (Store.agentBySlug(id) || { name: id }).name;
      const activity = i === 0 && env.type === 'request' && env.from !== CORE && env.to !== CORE
        ? `${nm(env.from)} → ${nm(env.to)} · ${env.action}`
        : null;
      try { Store.appendLine(a.id, 'Conversas', `linha-${day()}.log`, line, activity); } catch (e) { /* armazenamento cheio */ }
    });
  }

  /* ---------- modo servidor ---------- */
  let pushTimer = null;
  function pushTopology() {
    if (mode !== 'server') return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const { default: def, rules } = Store.state.permissions;
      const body = Object.assign(topology(), { policy: { default: def, rules } });
      fetch(server + '/topology', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .catch(() => {});
    }, 150);
  }

  function startServer(url) {
    mode = 'server';
    server = url;
    pushTopology();
    const es = new EventSource(server + '/observe');
    es.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.roster) { roster = m.roster; emit('change'); }
      if (m.kind === 'traffic') record(m.env, m.info);
      if (m.kind === 'permission') {
        // o servidor segurou o pedido: quem decide é você, aqui
        Perms.prompt(m.env, m.path, m.timeoutMs).then(res => {
          if (!res) return; // decidido em outra janela
          fetch(server + '/decision', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: m.env.id, allow: res.allow, code: res.code, message: res.message })
          }).catch(() => {});
        });
      }
      if (m.kind === 'permission-closed') Perms.close(m.id);
    };
    es.onerror = () => { roster = []; emit('change'); };
    es.onopen = () => { pushTopology(); emit('change'); };
  }

  /* ---------- modo navegador (esta página é o roteador) ---------- */
  function startLocal() {
    mode = 'local';
    if (typeof BroadcastChannel === 'undefined') { mode = 'off'; emit('change'); return; }
    const bc = new BroadcastChannel(CHANNEL);
    router = createRouter({
      topology,
      deliver: env => bc.postMessage({ dir: 'down', env }),
      authorize: (env, path) => Perms.authorize(env, path),
      onTraffic: (env, info) => {
        if (info.status === 'presence') { roster = router.roster(); emit('change'); return; }
        record(env, info);
      }
    });
    bc.onmessage = e => { const m = e.data || {}; if (m.dir === 'up' && m.env) router.route(m.env); };
    const beat = () => bc.postMessage({ dir: 'down', env: { asafe: 1, id: 'hb_' + Date.now(), type: 'event', from: CORE, to: '*', action: 'core.heartbeat', ts: Date.now() } });
    beat();
    setInterval(() => {
      beat();
      if (router.sweep(16000)) { roster = router.roster(); emit('change'); }
    }, 4000);
    roster = router.roster();
    emit('change');
  }

  async function start() {
    const url = serverUrl().replace(/\/$/, '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 900);
      const r = await fetch(url + '/status', { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.asafe === 1) return startServer(url);
    } catch (e) { /* sem servidor: modo navegador */ }
    startLocal();
  }

  Store.on(() => {
    if (mode === 'server') pushTopology();
    else if (router) { roster = router.roster(); emit('change'); }
  });

  window.Bus = {
    start,
    get mode() { return mode; },
    get server() { return server; },
    get roster() { return roster; },
    onlineIds,
    isOnline: agentId => onlineIds().has(slug(Store.nameOf(agentId))),
    slugOf: agentId => agentId === CORE ? CORE : slug(Store.nameOf(agentId)),
    on(k, fn) { listeners[k].add(fn); return () => listeners[k].delete(fn); }
  };
})();
