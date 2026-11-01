/* =========================================================
   Asafe · Aba "Dados de Servidores"
   Cada IA tem um servidor dentro do Asafe, com pastas e arquivos.
   ========================================================= */
(function () {
  const { $, esc, h, fmtBytes, fmtDate, timeAgo, initials, toast, modal, confirmBox, promptBox } = UI;
  const MAX_FILE = 2 * 1024 * 1024;
  const QUOTA = 5 * 1024 * 1024; // limite aproximado do armazenamento do navegador
  const TEXT_EXT = /\.(txt|md|json|csv|log|js|ts|py|html|css|xml|yml|yaml|ini|env|sql|sh)$/i;

  const view = { agentId: null, folderId: null, query: '', serverQuery: '' };

  const ICON = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/></svg>',
    json: '<svg viewBox="0 0 24 24"><path d="M8 4c-2 0-2 1.5-2 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 1.5 0 3 2 3M16 4c2 0 2 1.5 2 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 1.5 0 3-2 3"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>',
    server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>'
  };

  function iconFor(f) {
    if (f.mime.startsWith('image/')) return ICON.image;
    if (f.mime.includes('json')) return ICON.json;
    if (f.mime.startsWith('text/')) return ICON.text;
    return ICON.file;
  }
  const isText = f => f.mime.startsWith('text/') || f.mime.includes('json') || TEXT_EXT.test(f.name);

  function routeLabel(agentId) {
    const r = Store.routeToCore(agentId);
    if (!r) return { ok: false, text: 'sem rota até o Asafe' };
    if (r.length === 2) return { ok: true, text: 'conectado direto ao Asafe' };
    return { ok: true, text: 'via ' + r.slice(1, -1).map(Store.nameOf).join(' → ') };
  }

  /* ---------------- lista de servidores ---------------- */
  function renderServers() {
    const s = Store.state;
    const q = view.serverQuery.toLowerCase();
    const list = $('#serverList');
    $('#serverCount').textContent = s.agents.length;
    const total = Store.totalUsage();
    $('#coreSummary').textContent = `${s.agents.length} servidores · ${s.files.length} arquivos · ${fmtBytes(total)}`;
    $('#coreCard').classList.toggle('is-active', view.agentId === null);

    const agents = [...s.agents]
      .sort((a, b) => (a.kind === 'principal' ? -1 : 0) - (b.kind === 'principal' ? -1 : 0) || a.name.localeCompare(b.name))
      .filter(a => !q || a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q));

    list.innerHTML = '';
    if (!agents.length) {
      list.appendChild(h(`<li class="empty-mini">${s.agents.length ? 'Nenhuma IA encontrada.' : 'Nenhuma IA na rede ainda.'}</li>`));
    }
    agents.forEach((a, i) => {
      const used = Store.agentUsage(a.id);
      const files = s.files.filter(f => f.agentId === a.id).length;
      const r = routeLabel(a.id);
      const pct = total ? Math.max(4, Math.round(used / total * 100)) : 0;
      const li = h(`
        <li>
          <button class="server ${view.agentId === a.id ? 'is-active' : ''}" style="--i:${i}">
            <span class="avatar ${a.kind}">${esc(initials(a.name))}</span>
            <span class="server-main">
              <span class="server-name">${esc(a.name)} ${a.kind === 'principal' ? '<em class="badge">principal</em>' : ''}</span>
              <span class="server-route ${r.ok ? 'ok' : 'off'}"><i></i>${esc(r.text)}</span>
              <span class="server-bar"><i style="width:${pct}%"></i></span>
            </span>
            <span class="server-meta mono">${files}<small>arq.</small></span>
          </button>
        </li>`);
      li.querySelector('button').addEventListener('click', () => open(a.id, null));
      list.appendChild(li);
    });

    const stored = Store.bytesStored();
    $('#storageText').textContent = `${fmtBytes(stored)} / ${fmtBytes(QUOTA)}`;
    const bar = $('#storageBar');
    bar.style.width = Math.min(100, stored / QUOTA * 100) + '%';
    bar.classList.toggle('warn', stored / QUOTA > 0.8);
  }

  /* ---------------- breadcrumbs ---------------- */
  function renderCrumbs() {
    const c = $('#crumbs');
    c.innerHTML = '';
    const add = (label, fn, cls = '') => {
      const b = h(`<button class="crumb ${cls}">${label}</button>`);
      if (fn) b.addEventListener('click', fn); else b.disabled = true;
      c.appendChild(b);
    };
    add('<img src="assets/asafe-mark-red.png" alt="" /> asafe', view.agentId ? () => open(null, null) : null, 'root');
    if (view.agentId) {
      const a = Store.agent(view.agentId);
      add(esc(a.name), view.folderId ? () => open(a.id, null) : null);
      Store.folderPath(view.folderId).forEach((f, i, arr) => add(esc(f.name), i < arr.length - 1 ? () => open(a.id, f.id) : null));
    }
    const disabled = !view.agentId;
    ['#btnNewFolder', '#btnNewNote', '#btnUpload'].forEach(id => {
      $(id).disabled = disabled;
      $(id).title = disabled ? 'Abra o servidor de uma IA para armazenar dados' : '';
    });
  }

  /* ---------------- explorador ---------------- */
  function renderExplorer() {
    const body = $('#explorerBody');
    body.innerHTML = '';
    body.classList.remove('anim'); void body.offsetWidth; body.classList.add('anim');

    if (view.query) return renderSearch(body);
    if (!view.agentId) return renderCore(body);

    const a = Store.agent(view.agentId);
    const s = Store.state;
    const r = routeLabel(a.id);

    if (!view.folderId) {
      const used = Store.agentUsage(a.id);
      const files = s.files.filter(f => f.agentId === a.id).length;
      body.appendChild(h(`
        <div class="server-hero">
          <span class="avatar xl ${a.kind}">${esc(initials(a.name))}</span>
          <div class="hero-main">
            <h1>${esc(a.name)} ${a.kind === 'principal' ? '<em class="badge">agente principal</em>' : ''}</h1>
            <p>${esc(a.role || 'Sem função definida')}</p>
            <code class="mono">asafe://${esc(Store.slug(a.name))}</code>
          </div>
          <div class="hero-stats">
            <div><b>${files}</b><span>arquivos</span></div>
            <div><b>${fmtBytes(used)}</b><span>armazenado</span></div>
            <div class="route ${r.ok ? 'ok' : 'off'}"><b><i></i>${r.ok ? 'online' : 'isolado'}</b><span>${esc(r.text)}</span></div>
          </div>
        </div>`));
    }

    const folders = s.folders.filter(f => f.agentId === a.id && f.parentId === view.folderId).sort((x, y) => x.name.localeCompare(y.name));
    const files = s.files.filter(f => f.agentId === a.id && f.folderId === view.folderId).sort((x, y) => y.updatedAt - x.updatedAt);

    if (folders.length) {
      body.appendChild(h('<h3 class="section-title">Pastas</h3>'));
      const grid = h('<div class="folder-grid"></div>');
      folders.forEach((f, i) => grid.appendChild(folderTile(f, i)));
      body.appendChild(grid);
    }

    body.appendChild(h(`<h3 class="section-title">Arquivos <span class="mono">${files.length}</span></h3>`));
    if (!files.length) {
      body.appendChild(h(`<div class="empty">
        ${ICON.file}
        <p>Nenhum dado armazenado aqui.</p>
        <small>Arraste arquivos para cá, use <b>Enviar</b> ou crie um <b>Registro</b>.</small>
      </div>`));
    } else {
      body.appendChild(fileTable(files, false));
    }
  }

  function folderTile(f, i) {
    const ids = Store.descendantFolderIds(f.id);
    const items = Store.state.files.filter(x => ids.includes(x.folderId));
    const size = items.reduce((s, x) => s + x.size, 0);
    const el = h(`
      <div class="folder" style="--i:${i}" tabindex="0" role="button">
        <span class="folder-icon">${ICON.folder}</span>
        <span class="folder-name">${esc(f.name)}</span>
        <span class="folder-meta mono">${items.length} arq. · ${fmtBytes(size)}</span>
        <span class="folder-actions">
          <button class="icon-btn sm" data-act="rename" title="Renomear">${ICON.edit}</button>
          <button class="icon-btn sm danger" data-act="del" title="Apagar">${ICON.trash}</button>
        </span>
      </div>`);
    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]');
      if (!act) return open(f.agentId, f.id);
      e.stopPropagation();
      if (act.dataset.act === 'rename') {
        const name = await promptBox('Renomear pasta', 'Nome', f.name);
        if (name) safe(() => Store.renameFolder(f.id, name));
      } else {
        const ok = await confirmBox('Apagar pasta', `Apagar <b>${esc(f.name)}</b> e tudo que está dentro (${items.length} arquivos)?`);
        if (ok) safe(() => Store.removeFolder(f.id), 'Pasta apagada');
      }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) open(f.agentId, f.id); });
    return el;
  }

  function fileTable(files, showPath) {
    const t = h(`<div class="file-table">
      <div class="file-row head"><span>Nome</span>${showPath ? '<span>Local</span>' : ''}<span>Tamanho</span><span>Atualizado</span><span></span></div>
    </div>`);
    if (showPath) t.classList.add('with-path');
    files.forEach((f, i) => {
      const path = [Store.nameOf(f.agentId), ...Store.folderPath(f.folderId).map(x => x.name)].join(' / ');
      const row = h(`
        <div class="file-row" style="--i:${i}" tabindex="0">
          <span class="file-name"><i class="ficon">${iconFor(f)}</i><span>${esc(f.name)}</span></span>
          ${showPath ? `<span class="file-path">${esc(path)}</span>` : ''}
          <span class="mono">${fmtBytes(f.size)}</span>
          <span class="mono dim" title="${fmtDate(f.updatedAt)}">${timeAgo(f.updatedAt)}</span>
          <span class="row-actions">
            <button class="icon-btn sm" data-act="open" title="Abrir">${ICON.open}</button>
            <button class="icon-btn sm" data-act="down" title="Baixar">${ICON.down}</button>
            <button class="icon-btn sm danger" data-act="del" title="Apagar">${ICON.trash}</button>
          </span>
        </div>`);
      row.addEventListener('click', async e => {
        const act = (e.target.closest('[data-act]') || {}).dataset?.act || 'open';
        if (act === 'open') preview(f);
        else if (act === 'down') download(f);
        else {
          const ok = await confirmBox('Apagar arquivo', `Apagar <b>${esc(f.name)}</b> do servidor de ${esc(Store.nameOf(f.agentId))}?`);
          if (ok) safe(() => Store.removeFile(f.id), 'Arquivo apagado');
        }
      });
      row.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === row) preview(f); });
      t.appendChild(row);
    });
    return t;
  }

  function renderCore(body) {
    const s = Store.state;
    body.appendChild(h(`
      <div class="core-hero">
        <img src="assets/asafe-logo.png" alt="asafe" />
        <p>Central de dados de todas as IAs. Cada IA conectada possui um servidor próprio, organizado em pastas.</p>
      </div>`));
    body.appendChild(h('<h3 class="section-title">Servidores armazenados</h3>'));
    const grid = h('<div class="vault-grid"></div>');
    if (!s.agents.length) {
      grid.appendChild(h('<div class="empty"><p>Nenhuma IA ainda.</p><small>Adicione IAs na aba <b>Linhas de Conexão</b>.</small></div>'));
    }
    s.agents.forEach((a, i) => {
      const r = routeLabel(a.id);
      const folders = s.folders.filter(f => f.agentId === a.id && !f.parentId).length;
      const files = s.files.filter(f => f.agentId === a.id).length;
      const card = h(`
        <button class="vault" style="--i:${i}">
          <span class="vault-top">
            <span class="folder-icon big">${ICON.folder}</span>
            <span class="status-dot ${r.ok ? 'ok' : 'off'}" title="${esc(r.text)}"></span>
          </span>
          <strong>${esc(a.name)}</strong>
          <small>${esc(a.role || (a.kind === 'principal' ? 'Agente principal' : 'IA'))}</small>
          <span class="vault-meta mono">${folders} pastas · ${files} arq. · ${fmtBytes(Store.agentUsage(a.id))}</span>
        </button>`);
      card.addEventListener('click', () => open(a.id, null));
      grid.appendChild(card);
    });
    body.appendChild(grid);

    body.appendChild(h('<h3 class="section-title">Atividade do núcleo</h3>'));
    const log = h('<ol class="activity"></ol>');
    s.activity.slice(0, 12).forEach((ev, i) => log.appendChild(h(
      `<li style="--i:${i}"><time class="mono">${fmtDate(ev.t)}</time><span>${esc(ev.msg)}</span></li>`)));
    body.appendChild(log);
  }

  function renderSearch(body) {
    const q = view.query.toLowerCase();
    const scope = Store.state.files.filter(f => !view.agentId || f.agentId === view.agentId);
    const hits = scope.filter(f => f.name.toLowerCase().includes(q) || (isText(f) && f.content.toLowerCase().includes(q)));
    body.appendChild(h(`<h3 class="section-title">Resultados para “${esc(view.query)}” <span class="mono">${hits.length}</span></h3>`));
    if (!hits.length) body.appendChild(h(`<div class="empty">${ICON.file}<p>Nada encontrado ${view.agentId ? 'neste servidor' : 'no Asafe'}.</p></div>`));
    else body.appendChild(fileTable(hits, true));
  }

  /* ---------------- arquivos ---------------- */
  function preview(f) {
    const meta = `<div class="file-meta mono">${esc(f.mime)} · ${fmtBytes(f.size)} · ${fmtDate(f.updatedAt)}</div>`;
    if (isText(f)) {
      const body = h(`<div class="form">${meta}<label>Nome<input class="fname" value="${esc(f.name)}" /></label><textarea class="code" spellcheck="false"></textarea></div>`);
      body.querySelector('textarea').value = f.content;
      modal({
        title: f.name, body, wide: true,
        actions: [
          { label: 'Baixar', value: 'down' },
          { label: 'Salvar', kind: 'primary', value: b => ({ name: b.querySelector('.fname').value.trim() || f.name, content: b.querySelector('textarea').value }) }
        ]
      }).then(v => {
        if (v === 'down') download(f);
        else if (v && typeof v === 'object') safe(() => Store.updateFile(f.id, v), 'Registro salvo');
      });
    } else if (f.mime.startsWith('image/')) {
      modal({ title: f.name, wide: true, body: `${meta}<div class="img-preview"><img src="${f.content}" alt="" /></div>`, actions: [{ label: 'Baixar', kind: 'primary', value: 'down' }] })
        .then(v => v === 'down' && download(f));
    } else {
      modal({ title: f.name, body: `${meta}<p class="modal-text">Pré-visualização indisponível para este tipo de arquivo.</p>`, actions: [{ label: 'Baixar', kind: 'primary', value: 'down' }] })
        .then(v => v === 'down' && download(f));
    }
  }

  function download(f) {
    const a = document.createElement('a');
    a.href = f.content.startsWith('data:') ? f.content : URL.createObjectURL(new Blob([f.content], { type: f.mime }));
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      const text = file.type.startsWith('text/') || file.type.includes('json') || TEXT_EXT.test(file.name);
      r.onload = () => res({ content: r.result, mime: file.type || (text ? 'text/plain' : 'application/octet-stream') });
      r.onerror = () => rej(r.error);
      text ? r.readAsText(file) : r.readAsDataURL(file);
    });
  }

  async function ingest(fileList) {
    if (!view.agentId) return toast('Abra o servidor de uma IA antes de enviar dados.', 'err');
    let n = 0;
    for (const file of fileList) {
      if (file.size > MAX_FILE) { toast(`"${file.name}" excede 2 MB.`, 'err'); continue; }
      try {
        const { content, mime } = await readFile(file);
        Store.addFile({ agentId: view.agentId, folderId: view.folderId, name: file.name, mime, content, size: file.size });
        n++;
      } catch (e) { toast(e.message, 'err'); break; }
    }
    if (n) toast(`${n} arquivo${n > 1 ? 's' : ''} armazenado${n > 1 ? 's' : ''} em ${Store.nameOf(view.agentId)}`);
  }

  function safe(fn, okMsg) {
    try { fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- navegação ---------------- */
  function open(agentId, folderId) {
    view.agentId = agentId && Store.agent(agentId) ? agentId : null;
    view.folderId = view.agentId ? folderId : null;
    view.query = '';
    $('#fileSearch').value = '';
    render();
  }

  function render() {
    if (view.agentId && !Store.agent(view.agentId)) { view.agentId = null; view.folderId = null; }
    if (view.folderId && !Store.state.folders.some(f => f.id === view.folderId)) view.folderId = null;
    renderServers();
    renderCrumbs();
    renderExplorer();
  }

  function init() {
    $('#coreCard').addEventListener('click', () => open(null, null));
    $('#serverSearch').addEventListener('input', e => { view.serverQuery = e.target.value; renderServers(); });
    let t;
    $('#fileSearch').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { view.query = e.target.value.trim(); renderExplorer(); }, 120);
    });

    $('#btnNewFolder').addEventListener('click', async () => {
      const name = await promptBox('Nova pasta', 'Nome da pasta', '', 'Criar');
      if (name) safe(() => Store.addFolder(view.agentId, view.folderId, name), 'Pasta criada');
    });

    $('#btnNewNote').addEventListener('click', async () => {
      const body = h(`<div class="form">
        <label>Nome do registro<input class="fname" placeholder="ex.: memoria-sessao.md" /></label>
        <textarea class="code" placeholder="Conteúdo que o Asafe deve guardar…" spellcheck="false"></textarea>
      </div>`);
      const v = await modal({
        title: `Novo registro · ${Store.nameOf(view.agentId)}`, body, wide: true,
        actions: [{ label: 'Cancelar', value: null }, {
          label: 'Armazenar', kind: 'primary',
          value: b => ({ name: b.querySelector('.fname').value.trim(), content: b.querySelector('textarea').value })
        }]
      });
      if (!v) return;
      let name = v.name || `registro-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
      if (!/\.\w+$/.test(name)) name += '.txt';
      const mime = /\.json$/i.test(name) ? 'application/json' : /\.md$/i.test(name) ? 'text/markdown' : 'text/plain';
      safe(() => Store.addFile({ agentId: view.agentId, folderId: view.folderId, name, mime, content: v.content }), 'Registro armazenado');
    });

    $('#btnUpload').addEventListener('click', () => $('#uploadInput').click());
    $('#uploadInput').addEventListener('change', e => { ingest(e.target.files); e.target.value = ''; });

    const ex = $('.explorer'), dz = $('#dropzone');
    let depth = 0;
    ex.addEventListener('dragenter', e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth++; if (view.agentId) dz.classList.add('on'); });
    ex.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('on'); });
    ex.addEventListener('dragover', e => e.preventDefault());
    ex.addEventListener('drop', e => {
      e.preventDefault(); depth = 0; dz.classList.remove('on');
      if (e.dataTransfer.files.length) ingest(e.dataTransfer.files);
    });

    render();
  }

  window.DataView = { init, render, open };
})();
