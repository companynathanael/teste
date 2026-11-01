/* =========================================================
   AsafeLink · SDK de conexão de um agente ao Asafe
   Arquivo único, sem dependências. Inclua com <script> (ou cole
   dentro do HTML de arquivo único) e use window.AsafeLink.

   const link = AsafeLink.connect({
     id: 'miqueias', name: 'Miquéias', role: 'IA auxiliar', kind: 'ia',
     actions: {
       'chat.ask': { desc: 'Faz uma pergunta', handler: async (payload, ctx) => ({ reply: '...' }) }
     }
   });
   const r = await link.request('miqueias', 'chat.ask', { prompt: 'Olá' });

   Transporte:
   - "server": servidor Asafe (node server/asafe-server.js), padrão http://localhost:7300
   - "local":  mesmo navegador, via BroadcastChannel; a página do Asafe precisa estar aberta
   Protocolo completo: protocol/PROTOCOLO.md
   ========================================================= */
(function (root) {
  const VERSION = 1;
  const CORE = 'asafe';
  const CHANNEL = 'asafe-bus';
  const DEFAULT_SERVER = 'http://localhost:7300';
  const HEARTBEAT = 5000;

  const uid = () => 'msg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);

  function connect(opts) {
    if (!opts || !opts.id) throw new Error('AsafeLink: informe o id do agente (ex.: "horacio").');
    const me = {
      id: opts.id, name: opts.name || opts.id, role: opts.role || '', kind: opts.kind || 'ia'
    };
    const actions = opts.actions || {};
    const listeners = { status: new Set(), event: new Set(), message: new Set() };
    const pending = new Map(); // id -> { resolve, reject, timer, onProgress }
    const seen = new Set();

    let status = 'connecting';
    let mode = null;
    let bc = null, es = null, server = null;
    let lastCore = 0, hbTimer = null, watchTimer = null, closed = false;

    const emit = (k, v) => listeners[k].forEach(fn => { try { fn(v); } catch (e) { console.error(e); } });
    const setStatus = s => { if (s !== status) { status = s; emit('status', { status, mode }); } };

    const envelope = (type, to, action, payload, extra) => Object.assign({
      asafe: VERSION, id: uid(), type, from: me.id, to, action, payload, ts: Date.now()
    }, extra || {});

    const hello = () => envelope('hello', CORE, null, {
      name: me.name, role: me.role, kind: me.kind,
      actions: Object.keys(actions).map(name => ({ name, desc: actions[name].desc || '' }))
    });

    /* ---------- envio ---------- */
    function post(env) {
      if (mode === 'local') { bc.postMessage({ dir: 'up', env }); return Promise.resolve(); }
      if (mode === 'server') {
        return fetch(server + '/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env)
        }).then(r => r.json()).then(res => {
          if (!res.ok && env.type === 'request') settle(env.id, false, null, { code: res.code, message: res.message });
        }).catch(() => {
          if (env.type === 'request') settle(env.id, false, null, { code: 'offline', message: 'Servidor do Asafe indisponível.' });
        });
      }
      return Promise.reject(new Error('AsafeLink ainda não conectado.'));
    }

    function settle(id, ok, payload, error) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (ok) p.resolve(payload);
      else {
        const e = new Error((error && error.message) || 'Falha na linha de servidor.');
        e.code = (error && error.code) || 'error';
        p.reject(e);
      }
    }

    /* ---------- recebimento ---------- */
    async function receive(env) {
      if (!env || env.to !== me.id && env.to !== '*') return;
      if (seen.has(env.id)) return;
      seen.add(env.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      emit('message', env);

      if (env.type === 'response') return settle(env.replyTo, env.ok !== false, env.payload, env.error);
      if (env.type === 'progress') {
        const p = pending.get(env.replyTo);
        if (p && p.onProgress) try { p.onProgress(env.payload); } catch (e) { console.error(e); }
        return;
      }
      if (env.type === 'event') return emit('event', env);
      if (env.type !== 'request') return;

      const respond = (ok, payload, error) => post(envelope('response', env.from, env.action, ok ? payload : undefined,
        { replyTo: env.id, ok, error: ok ? undefined : error }));
      const act = actions[env.action];
      if (!act) return respond(false, null, { code: 'unknown_action', message: `${me.name} não conhece a ação "${env.action}".` });
      const ctx = {
        from: env.from, id: env.id,
        progress: data => post(envelope('progress', env.from, env.action, data, { replyTo: env.id }))
      };
      try {
        const out = await act.handler(env.payload || {}, ctx);
        respond(true, out === undefined ? {} : out);
      } catch (e) {
        respond(false, null, { code: e.code || 'handler_error', message: e.message || String(e) });
      }
    }

    /* ---------- transportes ---------- */
    function startLocal() {
      mode = 'local';
      if (typeof BroadcastChannel === 'undefined') { setStatus('offline'); return; }
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = e => {
        const m = e.data || {};
        if (m.dir !== 'down' || !m.env) return;
        if (m.env.from === CORE && m.env.action === 'core.heartbeat') {
          const first = Date.now() - lastCore > HEARTBEAT * 2;
          lastCore = Date.now();
          if (first) post(hello());
          setStatus('online');
          return;
        }
        receive(m.env);
      };
      post(hello());
      watchTimer = setInterval(() => setStatus(Date.now() - lastCore < HEARTBEAT * 2 ? 'online' : 'waiting'), 2000);
      setStatus('waiting');
    }

    function startServer(url) {
      mode = 'server';
      server = url.replace(/\/$/, '');
      es = new EventSource(`${server}/stream?agent=${encodeURIComponent(me.id)}`);
      es.onopen = () => { post(hello()); setStatus('online'); };
      es.onerror = () => setStatus('waiting');
      es.onmessage = e => { try { receive(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
    }

    async function probe(url) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 900);
        const r = await fetch(url.replace(/\/$/, '') + '/status', { signal: ctrl.signal });
        clearTimeout(t);
        const j = await r.json();
        return j && j.asafe === VERSION;
      } catch (e) { return false; }
    }

    (async () => {
      const url = opts.server === undefined ? DEFAULT_SERVER : opts.server;
      if (url && opts.transport !== 'local' && await probe(url)) startServer(url);
      else startLocal();
      if (closed) return;
      hbTimer = setInterval(() => post(hello()).catch(() => {}), HEARTBEAT);
      emit('status', { status, mode });
    })();

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => api.close());
    }

    /* ---------- API ---------- */
    const api = {
      get id() { return me.id; },
      get status() { return status; },
      get mode() { return mode; },

      /** Pede para outro agente executar uma ação. Resolve com o payload da resposta. */
      request(to, action, payload = {}, { timeout = 90000, onProgress } = {}) {
        return new Promise((resolve, reject) => {
          const env = envelope('request', to, action, payload);
          const timer = setTimeout(() => settle(env.id, false, null, {
            code: 'timeout',
            message: mode === 'local'
              ? 'Sem resposta. Confira se o Asafe e o agente de destino estão abertos.'
              : 'Sem resposta do agente de destino.'
          }), timeout);
          pending.set(env.id, { resolve, reject, timer, onProgress });
          const go = () => post(env).catch(e => settle(env.id, false, null, { code: 'offline', message: e.message }));
          if (mode) go(); else { const off = api.on('status', () => { if (mode) { off(); go(); } }); }
        });
      },
      /** Envia um evento sem esperar resposta. */
      emit(to, action, payload = {}) { return post(envelope('event', to, action, payload)); },
      /** Lista os agentes do Asafe, quem está online e as ações de cada um. */
      roster() { return api.request(CORE, 'roster', {}, { timeout: 8000 }).then(r => r.agents); },
      /** Registra mais uma ação depois de conectado. */
      handle(name, handler, desc = '') { actions[name] = { handler, desc }; if (mode) post(hello()); },
      on(kind, fn) { listeners[kind].add(fn); return () => listeners[kind].delete(fn); },
      close() {
        if (closed) return;
        closed = true;
        try { post(envelope('bye', CORE)); } catch (e) { /* ignore */ }
        clearInterval(hbTimer); clearInterval(watchTimer);
        if (es) es.close();
        if (bc) setTimeout(() => bc.close(), 50);
        setStatus('offline');
      }
    };
    return api;
  }

  root.AsafeLink = { connect, VERSION, CORE };
})(typeof window !== 'undefined' ? window : globalThis);
