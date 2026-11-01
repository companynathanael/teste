/* =========================================================
   Asafe · App (boot, abas, status, backup)
   ========================================================= */
(function () {
  const { $, $$, fmtBytes, toast } = UI;
  let current = 'data';

  function setTab(name) {
    current = name;
    $$('.tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
    moveIndicator();
    FlowView.setActive(name === 'flow');
    if (window.Perms) Perms.render();
    try { localStorage.setItem('asafe.tab', name); } catch (e) { /* ignore */ }
  }

  function moveIndicator() {
    const t = $(`.tab[data-tab="${current}"]`);
    const ind = $('#tabIndicator');
    ind.style.width = t.offsetWidth + 'px';
    ind.style.transform = `translateX(${t.offsetLeft}px)`;
  }

  function stats() {
    const s = Store.state;
    $('#statNodes').textContent = s.agents.length + 1;
    $('#statLinks').textContent = s.links.length;
    $('#statData').textContent = fmtBytes(Store.totalUsage());
  }

  function coreStatus() {
    const el = $('#coreStatus');
    const on = Bus.roster.filter(r => r.online).length;
    const m = Bus.mode;
    el.classList.toggle('server', m === 'server');
    $('#coreStatusText').textContent = m === 'server' ? `servidor · ${on} ao vivo` : m === 'local' ? `núcleo · ${on} ao vivo` : 'núcleo online';
    el.title = m === 'server' ? `Servidor do Asafe em ${Bus.server}` : 'Roteando as linhas dentro do navegador';
  }

  function clock() {
    $('#clock').textContent = new Date().toLocaleTimeString('pt-BR');
  }

  function boot() {
    const el = $('#boot');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const steps = ['inicializando núcleo de servidores', 'montando servidores das IAs', 'estabelecendo linhas de conexão', 'asafe online'];
    let i = 0;
    const timer = setInterval(() => { i = Math.min(steps.length - 1, i + 1); $('#bootText').textContent = steps[i]; }, 420);
    const done = () => {
      clearInterval(timer);
      el.classList.add('done');
      document.body.classList.add('ready');
      setTimeout(() => el.remove(), 700);
    };
    el.addEventListener('click', done, { once: true });
    setTimeout(done, reduce ? 200 : 1900);
  }

  function init() {
    Store.load();
    DataView.init();
    FlowView.init();

    Perms.init();
    Store.on(() => { DataView.render(); FlowView.render(); stats(); });

    $$('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
    window.addEventListener('resize', moveIndicator);

    $('#btnExport').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `asafe-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('Backup do Asafe exportado');
    });
    $('#btnImport').addEventListener('click', () => $('#importInput').click());
    $('#importInput').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const ok = await UI.confirmBox('Importar backup', 'Substituir todos os dados atuais do Asafe pelo backup selecionado?', 'Importar');
      if (!ok) return;
      try { Store.importJSON(await f.text()); toast('Backup importado'); FlowView.fit(); }
      catch (err) { toast(err.message, 'err'); }
    });

    Bus.on('change', () => { FlowView.render(); DataView.renderServers(); coreStatus(); });
    Bus.on('traffic', ({ env, info }) => {
      if (env.type === 'request' || env.type === 'event') FlowView.pulseRoute(info.route, info.status === 'error' ? 'err' : 'req');
      else if (env.type === 'response') {
        if (info.status === 'error') {
          FlowView.pulseRoute([env.from, env.to], 'err');
          if (env.error && env.error.code === 'blocked') toast(env.error.message.replace('A consciência do Asafe recusou automaticamente', 'Consciência bloqueou'), 'err');
          else if (!env.error || !['denied', 'permission_timeout'].includes(env.error.code)) toast(`Linha recusada: ${env.error && env.error.message}`, 'err');
        } else FlowView.pulseRoute(info.route, 'res');
      }
    });
    Bus.start();

    let saved = 'data';
    try { saved = localStorage.getItem('asafe.tab') || 'data'; } catch (e) { /* ignore */ }
    setTab(['flow', 'perms'].includes(saved) ? saved : 'data');
    stats();
    clock(); setInterval(clock, 1000);
    boot();
    if (document.fonts) document.fonts.ready.then(moveIndicator);
  }

  window.App = {
    openData(agentId) { DataView.open(agentId, null); setTab('data'); },
    setTab
  };

  document.addEventListener('DOMContentLoaded', init);
})();
