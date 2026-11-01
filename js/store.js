/* =========================================================
   Asafe · Store
   Camada de dados do agente de servidores. Hoje persiste no
   navegador (localStorage); a interface é isolada aqui para
   que depois possa ser trocada por um backend real.
   ========================================================= */
(function () {
  const KEY = 'asafe.core.v1';
  const CORE_ID = 'asafe';
  const DEFAULT_FOLDERS = ['Memória', 'Conversas', 'Logs', 'Configurações'];

  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const now = () => Date.now();

  const listeners = new Set();
  let state = null;

  function emptyState() {
    return { version: 1, agents: [], links: [], folders: [], files: [], activity: [], core: { x: 0, y: 0 } };
  }

  function seed() {
    const s = emptyState();
    const horacio = mkAgent({ name: 'Horácio', role: 'Agente principal', kind: 'principal', x: 0, y: -260 });
    const miqueias = mkAgent({ name: 'Miquéias', role: 'IA auxiliar', kind: 'ia', x: 320, y: 120 });
    s.agents.push(horacio, miqueias);
    for (const a of s.agents) {
      const f = mkDefaultFolders(a.id);
      s.folders.push(...f);
      const cfg = f.find(x => x.name === 'Configurações');
      s.files.push(mkFile({
        agentId: a.id, folderId: cfg.id, name: 'perfil.json', mime: 'application/json',
        content: JSON.stringify({ nome: a.name, funcao: a.role, tipo: a.kind, servidor: 'asafe://' + slug(a.name) }, null, 2)
      }));
    }
    s.activity.push({ t: now(), msg: 'Núcleo Asafe inicializado' });
    return s;
  }

  function slug(str) {
    return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function mkAgent({ name, role = '', kind = 'ia', x = 0, y = 0 }) {
    return { id: uid('ag'), name: name.trim(), role: role.trim(), kind, x, y, createdAt: now() };
  }
  function mkDefaultFolders(agentId) {
    return DEFAULT_FOLDERS.map(name => ({ id: uid('fd'), agentId, parentId: null, name, createdAt: now() }));
  }
  function mkFile({ agentId, folderId, name, mime = 'text/plain', content = '', size }) {
    return {
      id: uid('fl'), agentId, folderId, name, mime, content,
      size: size != null ? size : new Blob([content]).size,
      createdAt: now(), updatedAt: now()
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? Object.assign(emptyState(), JSON.parse(raw)) : seed();
    } catch (e) {
      state = seed();
    }
    if (!raw()) persist();
  }
  function raw() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('Asafe: falha ao persistir', e);
      return false;
    }
  }

  function commit(change, msg) {
    const snapshot = JSON.stringify(state);
    change();
    if (msg) {
      state.activity.unshift({ t: now(), msg });
      state.activity = state.activity.slice(0, 80);
    }
    if (!persist()) {
      state = JSON.parse(snapshot);
      throw new Error('Armazenamento cheio: libere espaço no Asafe antes de guardar mais dados.');
    }
    listeners.forEach(fn => fn(state));
  }

  /* ---------- consultas ---------- */
  const agent = id => state.agents.find(a => a.id === id);
  const nameOf = id => id === CORE_ID ? 'Asafe' : (agent(id) || {}).name || '?';

  function neighbors(id) {
    return state.links.filter(l => l.from === id || l.to === id).map(l => (l.from === id ? l.to : l.from));
  }

  /** Caminho (lista de ids) do nó até o Asafe, ou null se não houver rota. */
  function routeToCore(id) {
    if (id === CORE_ID) return [CORE_ID];
    const prev = new Map([[id, null]]);
    const q = [id];
    while (q.length) {
      const cur = q.shift();
      if (cur === CORE_ID) break;
      for (const n of neighbors(cur)) if (!prev.has(n)) { prev.set(n, cur); q.push(n); }
    }
    if (!prev.has(CORE_ID)) return null;
    const path = [];
    for (let c = CORE_ID; c != null; c = prev.get(c)) path.unshift(c);
    return path;
  }

  function linkExists(a, b) {
    return state.links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  }

  function agentUsage(agentId) {
    return state.files.filter(f => f.agentId === agentId).reduce((s, f) => s + (f.size || 0), 0);
  }
  function totalUsage() { return state.files.reduce((s, f) => s + (f.size || 0), 0); }
  function bytesStored() { const r = raw(); return r ? r.length * 2 : 0; }

  function folderPath(folderId) {
    const out = [];
    let f = state.folders.find(x => x.id === folderId);
    while (f) { out.unshift(f); f = state.folders.find(x => x.id === f.parentId); }
    return out;
  }

  function descendantFolderIds(folderId) {
    const ids = [folderId];
    for (let i = 0; i < ids.length; i++) {
      state.folders.filter(f => f.parentId === ids[i]).forEach(f => ids.push(f.id));
    }
    return ids;
  }

  /* ---------- mutações ---------- */
  const api = {
    CORE_ID, uid, slug,
    get state() { return state; },
    load, persist,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    agent, nameOf, neighbors, routeToCore, linkExists, agentUsage, totalUsage, bytesStored, folderPath, descendantFolderIds,

    addAgent(data) {
      const name = (data.name || '').trim();
      if (!name) throw new Error('Dê um nome à IA.');
      if (state.agents.some(a => a.name.toLowerCase() === name.toLowerCase())) throw new Error('Já existe uma IA chamada "' + name + '".');
      const a = mkAgent(data);
      commit(() => {
        state.agents.push(a);
        state.folders.push(...mkDefaultFolders(a.id));
        if (data.autolink) state.links.push({ id: uid('ln'), from: CORE_ID, to: a.id, createdAt: now() });
      }, `IA ${a.name} adicionada à rede`);
      return a;
    },
    updateAgent(id, patch, silent) {
      commit(() => Object.assign(agent(id), patch), silent ? null : `IA ${nameOf(id)} atualizada`);
    },
    moveNode(id, x, y) {
      // posição muda com frequência: persiste sem log
      if (id === CORE_ID) { state.core.x = x; state.core.y = y; }
      else { const a = agent(id); if (a) { a.x = x; a.y = y; } }
    },
    flushPositions() { persist(); },
    removeAgent(id) {
      const name = nameOf(id);
      commit(() => {
        state.agents = state.agents.filter(a => a.id !== id);
        state.links = state.links.filter(l => l.from !== id && l.to !== id);
        state.folders = state.folders.filter(f => f.agentId !== id);
        state.files = state.files.filter(f => f.agentId !== id);
      }, `IA ${name} removida (servidor e dados apagados)`);
    },

    addLink(from, to) {
      if (from === to) throw new Error('Um nó não pode se conectar a si mesmo.');
      if (linkExists(from, to)) throw new Error('Essa linha já existe.');
      const l = { id: uid('ln'), from, to, createdAt: now() };
      commit(() => state.links.push(l), `Linha ${nameOf(from)} ⇄ ${nameOf(to)} estabelecida`);
      return l;
    },
    removeLink(id) {
      const l = state.links.find(x => x.id === id);
      if (!l) return;
      commit(() => { state.links = state.links.filter(x => x.id !== id); }, `Linha ${nameOf(l.from)} ⇄ ${nameOf(l.to)} desligada`);
    },

    addFolder(agentId, parentId, name) {
      name = (name || '').trim();
      if (!name) throw new Error('Dê um nome à pasta.');
      if (state.folders.some(f => f.agentId === agentId && f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase()))
        throw new Error('Já existe uma pasta com esse nome aqui.');
      const f = { id: uid('fd'), agentId, parentId, name, createdAt: now() };
      commit(() => state.folders.push(f), `Pasta "${name}" criada em ${nameOf(agentId)}`);
      return f;
    },
    renameFolder(id, name) {
      const f = state.folders.find(x => x.id === id);
      commit(() => { f.name = name.trim(); }, `Pasta renomeada para "${name.trim()}"`);
    },
    removeFolder(id) {
      const ids = descendantFolderIds(id);
      const f = state.folders.find(x => x.id === id);
      commit(() => {
        state.folders = state.folders.filter(x => !ids.includes(x.id));
        state.files = state.files.filter(x => !ids.includes(x.folderId));
      }, `Pasta "${f.name}" apagada de ${nameOf(f.agentId)}`);
    },

    addFile(data) {
      const f = mkFile(data);
      commit(() => state.files.push(f), `"${f.name}" armazenado em ${nameOf(f.agentId)}`);
      return f;
    },
    updateFile(id, patch) {
      const f = state.files.find(x => x.id === id);
      commit(() => {
        Object.assign(f, patch, { updatedAt: now() });
        if ('content' in patch) f.size = new Blob([f.content]).size;
      }, `"${f.name}" atualizado`);
    },
    removeFile(id) {
      const f = state.files.find(x => x.id === id);
      commit(() => { state.files = state.files.filter(x => x.id !== id); }, `"${f.name}" apagado de ${nameOf(f.agentId)}`);
    },

    agentBySlug(sl) { return state.agents.find(a => slug(a.name) === sl); },

    /** Acrescenta uma linha a um arquivo de texto do servidor da IA (cria pasta/arquivo se precisar). */
    appendLine(agentId, folderName, fileName, line, activity) {
      commit(() => {
        let folder = state.folders.find(f => f.agentId === agentId && !f.parentId && f.name === folderName);
        if (!folder) { folder = { id: uid('fd'), agentId, parentId: null, name: folderName, createdAt: now() }; state.folders.push(folder); }
        let file = state.files.find(f => f.agentId === agentId && f.folderId === folder.id && f.name === fileName);
        if (!file) { file = mkFile({ agentId, folderId: folder.id, name: fileName, mime: 'text/plain', content: '' }); state.files.push(file); }
        file.content += line + '\n';
        file.size = new Blob([file.content]).size;
        file.updatedAt = now();
      }, activity || null);
    },

    exportJSON() { return JSON.stringify(state, null, 2); },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.agents) || !Array.isArray(data.links)) throw new Error('Arquivo de backup inválido.');
      commit(() => { state = Object.assign(emptyState(), data); }, 'Backup importado');
    }
  };

  window.Store = api;
})();
