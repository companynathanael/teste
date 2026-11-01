/* =========================================================
   Asafe · Permissões de execução
   Todo pedido de um agente para outro (ex.: Horácio → Miquéias)
   passa por aqui antes de ser entregue. A política decide sozinha
   (permitir/recusar) ou pergunta ao Sr. Nathanael, que aceita ou recusa.
   ========================================================= */
(function () {
  const { $, esc, h, toast, timeAgo, fmtDate, initials } = UI;
  const WAIT = 60000;
  const pending = new Map(); // id -> { env, path, resolve, expires }
  const listeners = new Set();
  let baseTitle = document.title;

  const nameOf = id => {
    if (id === 'asafe') return 'Asafe';
    const r = window.Bus && Bus.roster.find(a => a.id === id);
    if (r) return r.name;
    const a = Store.agentBySlug(id);
    return a ? a.name : id;
  };
  const kindOf = id => (Store.agentBySlug(id) || {}).kind || 'ia';
  const descOf = (to, action) => {
    const r = window.Bus && Bus.roster.find(a => a.id === to);
    const a = r && r.actions.find(x => x.name === action);
    return a ? a.desc : '';
  };
  const sdkOf = id => { const r = window.Bus && Bus.roster.find(a => a.id === id); return r && r.sdk; };

  function preview(env) {
    const p = env.payload || {};
    const text = p.prompt || p.query || p.text;
    let out = text ? String(text) : JSON.stringify(p, null, 1);
    if (text && Object.keys(p).length > 1) {
      const rest = Object.assign({}, p); delete rest.prompt; delete rest.query; delete rest.text;
      out += '\n' + JSON.stringify(rest);
    }
    return out.length > 500 ? out.slice(0, 500) + '…' : out;
  }

  const emit = () => listeners.forEach(fn => fn());

  /* ---------------- decisão ---------------- */
  function record(env, allow, by, extra = {}) {
    try {
      Store.logDecision(Object.assign({
        from: env.from, to: env.to, action: env.action, allow, by,
        preview: preview(env).slice(0, 160)
      }, extra));
    } catch (e) { /* armazenamento cheio */ }
  }

  /** Usado pelo roteador do navegador: aplica a política e, se preciso, pergunta. */
  function authorize(env, path) {
    const d = AsafeRouter.decide(Store.state.permissions, env);
    if (d.decision === 'allow') {
      if (!AsafeRouter.isExempt(env)) record(env, true, 'regra', { rule: d.rule ? ruleLabel(d.rule) : 'padrão: permitir tudo' });
      return Promise.resolve({ allow: true });
    }
    if (d.decision === 'deny') {
      record(env, false, 'regra', { rule: d.rule ? ruleLabel(d.rule) : 'padrão: recusar tudo' });
      return Promise.resolve({ allow: false, code: 'denied', message: `O Asafe recusou "${env.action}" por uma regra de permissão.` });
    }
    return prompt(env, path);
  }

  /** Mostra o pedido e espera o Sr. Nathanael aceitar ou recusar. */
  function prompt(env, path, wait = WAIT) {
    return new Promise(resolve => {
      const item = { env, path, expires: Date.now() + wait, resolve };
      item.timer = setTimeout(() => finish(env.id, false, 'once', true), wait);
      pending.set(env.id, item);
      render();
      emit();
      toast(`${nameOf(env.from)} pede permissão para executar ${env.action} em ${nameOf(env.to)}`);
    });
  }

  function finish(id, allow, remember = 'once', expired = false) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    const { env } = item;
    if (!expired && remember !== 'once') {
      const action = remember === 'action' ? env.action : remember === 'prefix' ? env.action.split('.')[0] + '.*' : '*';
      try { Store.addRule({ from: env.from, to: env.to, action, decision: allow ? 'allow' : 'deny' }); } catch (e) { toast(e.message, 'err'); }
    }
    record(env, allow, expired ? 'tempo' : 'sr. nathanael');
    item.resolve(allow
      ? { allow: true, waited: true }
      : expired
        ? { allow: false, code: 'permission_timeout', message: `Ninguém respondeu no Asafe a tempo ao pedido "${env.action}".` }
        : { allow: false, code: 'denied', message: `O Sr. Nathanael recusou no Asafe a execução de "${env.action}".` });
    if (expired) toast(`Pedido ${env.action} de ${nameOf(env.from)} expirou e foi recusado`, 'err');
    render();
    emit();
  }

  /** Fecha um pedido decidido em outra janela (modo servidor). */
  function close(id) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    item.resolve(null);
    render();
    emit();
  }

  /* ---------------- render ---------------- */
  function ruleLabel(r) {
    const n = v => (!v || v === '*' ? 'qualquer' : nameOf(v));
    return `${r.decision === 'allow' ? 'permitir' : 'recusar'} ${r.action === '*' ? 'tudo' : r.action} · ${n(r.from)} → ${n(r.to)}`;
  }

  function card(item, compact) {
    const { env } = item;
    const desc = descOf(env.to, env.action);
    const old = sdkOf(env.from) && sdkOf(env.from) < 2;
    const prefix = env.action.includes('.') ? env.action.split('.')[0] + '.*' : null;
    const el = h(`
      <article class="perm-card ${compact ? 'compact' : ''}" data-id="${esc(env.id)}">
        <header>
          <span class="avatar sm ${kindOf(env.from)}">${esc(initials(nameOf(env.from)))}</span>
          <b>${esc(nameOf(env.from))}</b><i class="arrow">→</i><b>${esc(nameOf(env.to))}</b>
          <span class="perm-timer mono"></span>
        </header>
        <div class="perm-action"><code class="mono">${esc(env.action)}</code>${desc ? `<span>${esc(desc)}</span>` : ''}</div>
        <pre class="perm-payload mono">${esc(preview(env))}</pre>
        ${old ? `<p class="perm-warn">${esc(nameOf(env.from))} usa uma versão antiga do asafe-link.js: o pedido pode expirar lá antes da sua decisão.</p>` : ''}
        <footer>
          <select class="perm-remember" aria-label="Lembrar decisão">
            <option value="once">Só desta vez</option>
            <option value="action">Sempre para ${esc(env.action)}</option>
            ${prefix && prefix !== env.action ? `<option value="prefix">Sempre para ${esc(prefix)}</option>` : ''}
            <option value="pair">Tudo de ${esc(nameOf(env.from))} → ${esc(nameOf(env.to))}</option>
          </select>
          <button class="btn danger" data-allow="0">Recusar</button>
          <button class="btn primary" data-allow="1">Aceitar</button>
        </footer>
        <i class="perm-bar"></i>
      </article>`);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-allow]');
      if (!b) return;
      el.classList.add('leaving');
      finish(env.id, b.dataset.allow === '1', el.querySelector('.perm-remember').value);
    });
    return el;
  }

  function renderPending() {
    const box = $('#permPending');
    const items = [...pending.values()];
    $('#permCount').textContent = items.length;
    box.innerHTML = '';
    if (!items.length) {
      box.appendChild(h(`<div class="empty perm-empty">
        <img src="assets/asafe-mark-red.png" alt="" />
        <p>Nenhum pedido aguardando.</p>
        <small>Quando o Horácio ou o Miquéias pedirem para executar algo em outro agente, o pedido aparece aqui para você aceitar ou recusar.</small>
      </div>`));
    }
    items.forEach(it => box.appendChild(card(it, false)));

    const dock = $('#permDock');
    dock.innerHTML = '';
    const onTab = $('#view-perms').classList.contains('is-active');
    if (!onTab) items.slice(-2).forEach(it => dock.appendChild(card(it, true)));
    if (!onTab && items.length > 2) {
      const more = h(`<button class="perm-more">+${items.length - 2} pedidos aguardando</button>`);
      more.addEventListener('click', () => App.setTab('perms'));
      dock.appendChild(more);
    }

    const badge = $('#permBadge');
    badge.textContent = items.length;
    badge.hidden = !items.length;
    document.title = items.length ? `(${items.length}) ${baseTitle}` : baseTitle;
    tick();
  }

  function renderPolicy() {
    const p = Store.state.permissions;
    document.querySelectorAll('#permDefault input').forEach(i => { i.checked = i.value === p.default; });
    const list = $('#permRules');
    list.innerHTML = '';
    if (!p.rules.length) list.appendChild(h('<li class="empty-mini">Nenhuma regra. Use "Sempre…" ao decidir um pedido ou crie uma abaixo.</li>'));
    p.rules.forEach(r => {
      const li = h(`<li class="rule ${r.decision}">
        <span class="rule-tag">${r.decision === 'allow' ? 'permitir' : 'recusar'}</span>
        <span class="rule-main"><code class="mono">${esc(r.action === '*' ? 'tudo' : r.action)}</code><small>${esc(r.from === '*' ? 'qualquer' : nameOf(r.from))} → ${esc(r.to === '*' ? 'qualquer' : nameOf(r.to))}</small></span>
        <button class="icon-btn sm danger" title="Remover regra"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </li>`);
      li.querySelector('button').addEventListener('click', () => Store.removeRule(r.id));
      list.appendChild(li);
    });

    // selects do formulário de regra
    const opts = ['*', ...Store.state.agents.map(a => Store.slug(a.name))];
    ['#ruleFrom', '#ruleTo'].forEach(sel => {
      const el = $(sel), cur = el.value || '*';
      el.innerHTML = opts.map(o => `<option value="${esc(o)}">${o === '*' ? 'qualquer agente' : esc(nameOf(o))}</option>`).join('');
      el.value = opts.includes(cur) ? cur : '*';
    });
    const acts = new Set();
    (window.Bus ? Bus.roster : []).forEach(r => r.actions.forEach(a => { acts.add(a.name); if (a.name.includes('.')) acts.add(a.name.split('.')[0] + '.*'); }));
    $('#ruleActions').innerHTML = [...acts].sort().map(a => `<option value="${esc(a)}">`).join('');
  }

  function renderHistory() {
    const list = $('#permHistory');
    const hist = Store.state.permissions.history;
    list.innerHTML = '';
    if (!hist.length) list.appendChild(h('<li class="empty-mini">Nenhuma decisão ainda.</li>'));
    hist.slice(0, 40).forEach((x, i) => list.appendChild(h(`
      <li class="${x.allow ? 'ok' : 'no'}" style="--i:${Math.min(i, 12)}">
        <span class="hist-dot"></span>
        <span class="hist-main"><b>${x.allow ? 'Permitido' : 'Recusado'}</b> ${esc(nameOf(x.from))} → ${esc(nameOf(x.to))} · <code class="mono">${esc(x.action)}</code>
          <small>${esc(x.by === 'regra' ? 'automático · ' + (x.rule || 'regra') : x.by === 'tempo' ? 'expirou sem resposta' : 'decidido por você')}${x.preview ? ' · ' + esc(x.preview.replace(/\s+/g, ' ').slice(0, 90)) : ''}</small></span>
        <time class="mono dim" title="${fmtDate(x.t)}">${timeAgo(x.t)}</time>
      </li>`)));
  }

  function render() { renderPending(); }
  function renderAll() { renderPending(); renderPolicy(); renderHistory(); }

  function tick() {
    const now = Date.now();
    document.querySelectorAll('.perm-card').forEach(el => {
      const it = pending.get(el.dataset.id);
      if (!it) return;
      const left = Math.max(0, it.expires - now);
      el.querySelector('.perm-timer').textContent = Math.ceil(left / 1000) + 's';
      el.querySelector('.perm-bar').style.transform = `scaleX(${left / WAIT})`;
      el.classList.toggle('urgent', left < 10000);
    });
  }

  function init() {
    baseTitle = document.title;
    document.querySelectorAll('#permDefault input').forEach(i => i.addEventListener('change', () => Store.setPermissionDefault(i.value)));
    $('#ruleForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      try {
        Store.addRule({ from: f.from.value, to: f.to.value, action: f.action.value.trim() || '*', decision: f.decision.value });
        f.action.value = '';
        toast('Regra criada');
      } catch (err) { toast(err.message, 'err'); }
    });
    $('#btnClearHistory').addEventListener('click', async () => {
      if (await UI.confirmBox('Limpar histórico', 'Apagar o histórico de decisões de permissão?', 'Limpar')) Store.clearHistory();
    });
    setInterval(tick, 250);
    Store.on(() => { renderPolicy(); renderHistory(); });
    renderAll();
  }

  window.Perms = {
    init, authorize, prompt, close, render: renderAll,
    get count() { return pending.size; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
})();
