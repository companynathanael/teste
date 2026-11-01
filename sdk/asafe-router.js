/* =========================================================
   Asafe · Roteador (núcleo das linhas de servidor)
   Mesmo código roda no navegador (página do Asafe) e no
   servidor Node (server/asafe-server.js).
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AsafeRouter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const CORE = 'asafe';
  const TYPES = ['hello', 'bye', 'request', 'response', 'progress', 'event'];

  const uid = () => 'msg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);

  function slug(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function validate(env) {
    if (!env || typeof env !== 'object') return 'envelope vazio';
    if (env.asafe !== VERSION) return 'versão de protocolo inválida (esperado asafe: 1)';
    if (!TYPES.includes(env.type)) return 'tipo desconhecido: ' + env.type;
    if (!env.id || !env.from) return 'envelope sem id ou from';
    if (env.type !== 'hello' && env.type !== 'bye' && !env.to) return 'envelope sem destino (to)';
    if (env.type === 'request' && !env.action) return 'request sem action';
    return null;
  }

  /** Caminho entre dois nós pelas linhas de servidor (BFS). */
  function findPath(topology, from, to) {
    const adj = new Map();
    const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (const [a, b] of topology.links || []) { add(a, b); add(b, a); }
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const c = q.shift();
      if (c === to) break;
      for (const n of adj.get(c) || []) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(to)) return null;
    const path = [];
    for (let c = to; c != null; c = prev.get(c)) path.unshift(c);
    return path;
  }

  /**
   * Cria um roteador.
   * @param {object} o
   * @param {() => {agents:{id,name,kind}[], links:[string,string][]}} o.topology
   * @param {(env:object) => void} o.deliver  entrega um envelope ao agente env.to
   * @param {(env:object, info:object) => void} [o.onTraffic]  observador (UI/log)
   */
  function createRouter({ topology, deliver, onTraffic = () => {} }) {
    const online = new Map(); // id -> { name, role, kind, actions, since, seen }

    const reply = (req, ok, payload, error) => ({
      asafe: VERSION, id: uid(), type: 'response', from: CORE, to: req.from,
      replyTo: req.id, action: req.action, ok, payload: ok ? payload : undefined,
      error: ok ? undefined : error, ts: Date.now(), via: CORE
    });

    function fail(env, code, message) {
      if (env.type !== 'request') return { ok: false, code, message };
      const r = reply(env, false, null, { code, message });
      deliver(r);
      onTraffic(r, { status: 'error', code, route: [CORE, env.from] });
      return { ok: false, code, message };
    }

    function roster() {
      const topo = topology();
      return topo.agents.map(a => {
        const p = online.get(a.id);
        return {
          id: a.id, name: (p && p.name) || a.name, kind: a.kind,
          online: !!p, actions: p ? p.actions : [],
          route: findPath(topo, a.id, CORE)
        };
      });
    }

    function handleCore(env) {
      if (env.type !== 'request') return { ok: true };
      let payload;
      if (env.action === 'ping') payload = { pong: true, ts: Date.now() };
      else if (env.action === 'roster') payload = { agents: roster() };
      else return fail(env, 'unknown_action', `O Asafe não conhece a ação "${env.action}".`);
      const r = reply(env, true, payload);
      deliver(r);
      onTraffic(env, { status: 'ok', route: [env.from, CORE] });
      return { ok: true };
    }

    function route(env) {
      const err = validate(env);
      if (err) return fail(env, 'invalid', err);
      const topo = topology();
      const known = id => id === CORE || topo.agents.some(a => a.id === id);

      if (env.type === 'hello') {
        if (!known(env.from)) return fail(env, 'unknown_agent', `"${env.from}" não está cadastrado no Asafe.`);
        const p = env.payload || {};
        online.set(env.from, {
          name: p.name || env.from, role: p.role || '', kind: p.kind || 'ia',
          actions: Array.isArray(p.actions) ? p.actions : [], since: online.get(env.from)?.since || Date.now(), seen: Date.now()
        });
        onTraffic(env, { status: 'presence' });
        return { ok: true };
      }
      if (env.type === 'bye') {
        online.delete(env.from);
        onTraffic(env, { status: 'presence' });
        return { ok: true };
      }
      if (online.has(env.from)) online.get(env.from).seen = Date.now();

      if (!known(env.from)) return fail(env, 'unknown_agent', `"${env.from}" não está cadastrado no Asafe.`);
      if (env.to === CORE) return handleCore(env);
      if (!known(env.to)) return fail(env, 'unknown_agent', `"${env.to}" não está cadastrado no Asafe.`);

      // As duas pontas precisam alcançar o Asafe e estar ligadas entre si pelas linhas de servidor.
      if (!findPath(topo, env.from, CORE)) return fail(env, 'no_route', `${env.from} não tem linha até o Asafe.`);
      if (!findPath(topo, env.to, CORE)) return fail(env, 'no_route', `${env.to} não tem linha até o Asafe.`);
      const path = findPath(topo, env.from, env.to);
      if (!path) return fail(env, 'no_route', `Não existe linha de servidor entre ${env.from} e ${env.to}.`);
      if (!online.has(env.to)) return fail(env, 'offline', `${env.to} está desconectado do Asafe agora (abra a interface dele).`);

      const out = Object.assign({}, env, { via: CORE, route: path });
      deliver(out);
      onTraffic(out, { status: 'ok', route: path });
      return { ok: true, route: path };
    }

    /** Remove agentes que pararam de mandar sinal (heartbeat). */
    function sweep(maxAge = 15000) {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of online) if (now - p.seen > maxAge) { online.delete(id); changed = true; }
      return changed;
    }

    return { route, roster, sweep, online, findPath: (a, b) => findPath(topology(), a, b) };
  }

  return { VERSION, CORE, uid, slug, validate, findPath, createRouter };
});
