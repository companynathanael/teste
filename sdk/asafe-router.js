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

  /* ---------- permissões de execução ---------- */
  // Pedidos que nunca precisam de aprovação: só leitura de estado ou desligar um controle.
  function isExempt(env) {
    if (env.action === 'ping') return true;
    if (env.action === 'ui.control' && env.payload && env.payload.on === false) return true;
    return false;
  }

  function ruleMatches(rule, env) {
    const m = (pat, v) => !pat || pat === '*' || pat === v || (pat.endsWith('.*') && String(v).startsWith(pat.slice(0, -1)));
    return m(rule.from, env.from) && m(rule.to, env.to) && m(rule.action, env.action);
  }

  /**
   * Decide pela política guardada: 'allow', 'deny' ou 'ask'.
   * policy = { default: 'ask'|'allow'|'deny', rules: [{ from, to, action, decision }] }
   * A regra mais específica vence (menos curingas).
   */
  function decide(policy, env) {
    if (isExempt(env)) return { decision: 'allow', reason: 'isento' };
    const rules = ((policy && policy.rules) || []).filter(r => ruleMatches(r, env));
    if (rules.length) {
      const score = r => ['from', 'to', 'action'].reduce((n, k) => n + (r[k] && r[k] !== '*' ? (String(r[k]).endsWith('.*') ? 1 : 2) : 0), 0);
      rules.sort((a, b) => score(b) - score(a));
      return { decision: rules[0].decision, rule: rules[0] };
    }
    return { decision: (policy && policy.default) || 'ask', reason: 'padrão' };
  }

  /* ---------- escopos (permissões pedidas pelo agente, ver PERMISSOES.md do Horácio) ---------- */
  const SCOPES = {
    conversa: { label: 'conversar com', patterns: ['chat.*'] },
    pesquisa: { label: 'pesquisar na web pelo', patterns: ['research.run'] },
    'trade.leitura': { label: 'ver e estudar o trade do', patterns: ['trade.status', 'trade.study'] },
    'trade.piloto': { label: 'ligar ou desligar o piloto automático do', patterns: ['trade.autopilot'] },
    controle: { label: 'operar a tela do', patterns: ['ui.*'] },
    configuracao: { label: 'mudar as configurações do', patterns: ['settings.*'] },
    outros: { label: 'usar outras funções do', patterns: [] }
  };
  function scopeOf(action) {
    if (/^chat\./.test(action)) return 'conversa';
    if (action === 'research.run') return 'pesquisa';
    if (action === 'trade.status' || action === 'trade.study') return 'trade.leitura';
    if (action === 'trade.autopilot') return 'trade.piloto';
    if (/^ui\./.test(action)) return 'controle';
    if (/^settings\./.test(action)) return 'configuracao';
    return 'outros';
  }
  /** Padrões de ação que um escopo cobre (para regras); "outros" usa as ações pedidas. */
  function scopePatterns(scope, actions) {
    const s = SCOPES[scope];
    return s && s.patterns.length ? s.patterns : (actions && actions.length ? actions : ['*']);
  }

  /**
   * Cria um roteador.
   * @param {object} o
   * @param {() => {agents:{id,name,kind}[], links:[string,string][]}} o.topology
   * @param {(env:object) => void} o.deliver  entrega um envelope ao agente env.to
   * @param {(env:object, info:object) => void} [o.onTraffic]  observador (UI/log)
   * @param {(env:object, path:string[]) => Promise<{allow:boolean, message?:string, code?:string}>} [o.authorize]
   *        permissão de execução: chamada para cada request entre agentes; sem ela, tudo é entregue
   * @param {number} [o.permissionWait]  quanto tempo (ms) o remetente deve esperar pela decisão
   * @param {() => object} [o.policy]  política atual { default, rules }
   * @param {(env:object) => Promise<{allow:boolean, message?:string}>} [o.ask]  pergunta ao Sr. Nathanael (permission.request)
   * @param {() => void} [o.onGrants]  avisado quando as permissões ativas mudam
   */
  function createRouter({ topology, deliver, onTraffic = () => {}, authorize = null, permissionWait = 60000, policy = () => null, ask = null, onGrants = () => {} }) {
    const online = new Map(); // id -> { name, role, kind, actions, since, seen }
    let grants = []; // { grantId, from, to, scope, actions, reason, createdAt, expiresAt }
    const validGrant = g => !g.expiresAt || g.expiresAt > Date.now();
    const findGrant = (from, to, scope) => grants.find(g => g.from === from && g.to === to && g.scope === scope && validGrant(g));

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
          online: !!p, actions: p ? p.actions : [], sdk: p ? p.sdk : null,
          route: findPath(topo, a.id, CORE)
        };
      });
    }

    /* ---------- permissões por escopo (permission.*) ---------- */
    function grant(from, to, scope, actions, reason) {
      const g = { grantId: uid().replace('msg_', 'grant_'), from, to, scope, actions: actions || [], reason: reason || '', createdAt: Date.now(), expiresAt: null };
      grants = grants.filter(x => !(x.from === from && x.to === to && x.scope === scope)).concat(g);
      onGrants();
      return g;
    }

    async function permissionRequest(env) {
      const p = env.payload || {};
      const to = String(p.to || ''), scope = String(p.scope || '');
      const topo = topology();
      if (!topo.agents.some(a => a.id === to)) throw Object.assign(new Error(`"${to}" não está cadastrado no Asafe.`), { code: 'unknown_agent' });
      if (!SCOPES[scope]) throw Object.assign(new Error(`Escopo desconhecido: "${scope}".`), { code: 'bad_request' });
      const existing = findGrant(env.from, to, scope);
      const answer = g => ({ granted: true, to, scope, grantId: g.grantId, expiresAt: g.expiresAt || undefined });
      if (existing) return answer(existing);

      // a política decide pelos padrões do escopo: todos permitidos → concede; algum recusado → nega
      const pats = scopePatterns(scope, p.actions);
      const ds = pats.map(a => decide(policy(), { from: env.from, to, action: a }).decision);
      let allow;
      if (ds.includes('deny')) allow = false;
      else if (ds.every(d => d === 'allow')) allow = true;
      else if (!ask) allow = false;
      else {
        const res = await ask({
          asafe: VERSION, id: env.id, type: 'request', kind: 'permission', from: env.from, to,
          action: 'permission:' + scope, payload: { scope, actions: p.actions || [], reason: p.reason || '' }, ts: Date.now()
        });
        if (res === null) return null; // decidido em outro lugar
        allow = !!(res && res.allow);
        if (!allow) throw Object.assign(new Error((res && res.message) || `O Sr. Nathanael recusou a permissão de ${scope}.`), { code: (res && res.code) || 'denied' });
      }
      if (!allow) throw Object.assign(new Error(`O Asafe recusou a permissão de ${scope} por uma regra.`), { code: 'denied' });
      return answer(grant(env.from, to, scope, p.actions, p.reason));
    }

    function release(from, to, scope) {
      const before = grants.length;
      grants = grants.filter(g => !(g.from === from && (!to || g.to === to) && (!scope || g.scope === scope)));
      const n = before - grants.length;
      if (n) onGrants();
      return n;
    }

    /** O Sr. Nathanael retira uma permissão: avisa o agente com permission.revoked. */
    function revoke(grantId) {
      const g = grants.find(x => x.grantId === grantId);
      if (!g) return false;
      grants = grants.filter(x => x !== g);
      onGrants();
      const ev = { asafe: VERSION, id: uid(), type: 'event', from: CORE, to: g.from, action: 'permission.revoked', payload: { to: g.to, scope: g.scope }, ts: Date.now(), via: CORE };
      deliver(ev);
      onTraffic(ev, { status: 'ok', route: [CORE, g.from] });
      return true;
    }

    const CORE_ACTIONS = {
      ping: () => ({ pong: true, ts: Date.now() }),
      roster: () => ({ agents: roster() }),
      'permission.request': permissionRequest,
      'permission.release': env => ({ released: release(env.from, (env.payload || {}).to, (env.payload || {}).scope) }),
      'permission.list': env => ({ grants: grants.filter(g => g.from === env.from && validGrant(g)).map(g => ({ to: g.to, scope: g.scope, grantId: g.grantId, expiresAt: g.expiresAt || undefined })) })
    };

    function handleCore(env) {
      if (env.type !== 'request') return { ok: true };
      const fn = CORE_ACTIONS[env.action];
      if (!fn) return fail(env, 'unknown_action', `O Asafe não conhece a ação "${env.action}".`);
      Promise.resolve().then(() => fn(env)).then(payload => {
        if (payload === null) return;
        deliver(reply(env, true, payload));
        onTraffic(env, { status: 'ok', route: [env.from, CORE] });
      }).catch(e => fail(env, e.code || 'error', e.message || String(e)));
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
          name: p.name || env.from, role: p.role || '', kind: p.kind || 'ia', sdk: p.sdk || 1,
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

      // permissão ativa do escopo (pedida antes com permission.request): passa direto
      if (env.type === 'request' && findGrant(env.from, env.to, scopeOf(env.action))) return forward(env, path);
      if (env.type === 'request' && authorize) return gate(env, path);
      return forward(env, path);
    }

    function forward(env, path) {
      const out = Object.assign({}, env, { via: CORE, route: path });
      deliver(out);
      onTraffic(out, { status: 'ok', route: path });
      return { ok: true, route: path };
    }

    /** Segura o pedido até a permissão de execução ser dada ou negada. */
    function gate(env, path) {
      let answered = false;
      const notice = state => deliver({
        asafe: VERSION, id: uid(), type: 'progress', from: CORE, to: env.from, replyTo: env.id, action: env.action,
        payload: { asafe: 'permission', state, timeoutMs: permissionWait }, ts: Date.now(), via: CORE
      });
      const pendingTimer = setTimeout(() => { if (!answered) notice('pending'); }, 0);
      Promise.resolve()
        .then(() => authorize(env, path))
        .catch(e => ({ allow: false, message: e.message || 'Falha ao decidir a permissão.' }))
        .then(res => {
          answered = true;
          clearTimeout(pendingTimer);
          res = res || { allow: false };
          if (!res.allow) {
            onTraffic(env, { status: 'denied', route: path });
            return fail(env, res.code || 'denied', res.message || `O Asafe recusou a execução de "${env.action}".`);
          }
          if (!online.has(env.to)) return fail(env, 'offline', `${env.to} se desconectou enquanto o pedido esperava permissão.`);
          if (res.waited) notice('granted');
          forward(env, path);
        });
      return { ok: true, pending: true, route: path };
    }

    /** Remove agentes que pararam de mandar sinal (heartbeat). */
    function sweep(maxAge = 15000) {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of online) if (now - p.seen > maxAge) { online.delete(id); changed = true; }
      return changed;
    }

    return {
      route, roster, sweep, online, revoke, release,
      get grants() { return grants.filter(validGrant); },
      findPath: (a, b) => findPath(topology(), a, b)
    };
  }

  return { VERSION, CORE, uid, slug, validate, findPath, createRouter, decide, isExempt, ruleMatches, SCOPES, scopeOf, scopePatterns };
});
