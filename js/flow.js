/* =========================================================
   Asafe · Aba "Linhas de Conexão" (fluxograma)
   O Asafe é o centro. IAs são nós; linhas de servidor ligam nós.
   ========================================================= */
(function () {
  const { $, esc, h, toast, initials, confirmBox, timeAgo } = UI;
  const CORE = Store.CORE_ID;

  const cam = { x: 0, y: 0, z: 1 };
  let selected = null; // { type: 'node'|'link', id }
  let active = false;
  let fitted = false;
  let raf = 0;

  const els = {};
  const nodeEls = new Map();
  const linkEls = new Map();
  let packets = [];

  /* ---------------- geometria ---------------- */
  function pos(id) {
    if (id === CORE) return { x: Store.state.core.x, y: Store.state.core.y };
    const a = Store.agent(id);
    return a ? { x: a.x, y: a.y } : { x: 0, y: 0 };
  }

  function curve(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const k = 0.45;
    let c1, c2;
    if (Math.abs(dx) > Math.abs(dy)) {
      c1 = { x: a.x + dx * k, y: a.y };
      c2 = { x: b.x - dx * k, y: b.y };
    } else {
      c1 = { x: a.x, y: a.y + dy * k };
      c2 = { x: b.x, y: b.y - dy * k };
    }
    return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
  }

  function toWorld(clientX, clientY) {
    const r = els.vp.getBoundingClientRect();
    return { x: (clientX - r.left - cam.x) / cam.z, y: (clientY - r.top - cam.y) / cam.z };
  }

  function applyCam() {
    els.world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    els.vp.style.setProperty('--grid', 32 * cam.z + 'px');
    els.vp.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    $('#zoomLabel').textContent = Math.round(cam.z * 100) + '%';
  }

  function zoomAt(factor, cx, cy) {
    const r = els.vp.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const nz = Math.min(2, Math.max(0.35, cam.z * factor));
    const wx = (cx - r.left - cam.x) / cam.z, wy = (cy - r.top - cam.y) / cam.z;
    cam.z = nz;
    cam.x = cx - r.left - wx * nz;
    cam.y = cy - r.top - wy * nz;
    applyCam();
  }

  function fit(animate = true) {
    const r = els.vp.getBoundingClientRect();
    if (!r.width) return;
    const pts = [pos(CORE), ...Store.state.agents.map(a => ({ x: a.x, y: a.y }))];
    const minX = Math.min(...pts.map(p => p.x)) - 160, maxX = Math.max(...pts.map(p => p.x)) + 160;
    const minY = Math.min(...pts.map(p => p.y)) - 120, maxY = Math.max(...pts.map(p => p.y)) + 120;
    const z = Math.min(1.15, Math.max(0.35, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    const target = { z, x: r.width / 2 - ((minX + maxX) / 2) * z, y: r.height / 2 - ((minY + maxY) / 2) * z };
    if (!animate) { Object.assign(cam, target); return applyCam(); }
    tween(cam, target, 500, applyCam);
  }

  function tween(obj, to, ms, onFrame, done) {
    const from = {}; for (const k in to) from[k] = obj[k];
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    (function step(now) {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      for (const k in to) obj[k] = from[k] + (to[k] - from[k]) * e;
      onFrame();
      if (t < 1) requestAnimationFrame(step); else if (done) done();
    })(t0);
  }

  /* ---------------- rede ---------------- */
  function depthMap() {
    const d = new Map([[CORE, 0]]);
    const q = [CORE];
    while (q.length) {
      const c = q.shift();
      for (const n of Store.neighbors(c)) if (!d.has(n)) { d.set(n, d.get(c) + 1); q.push(n); }
    }
    return d;
  }

  function freeSpot() {
    const c = pos(CORE);
    const others = [c, ...Store.state.agents];
    let best = null, bestScore = -1;
    for (const radius of [300, 520, 740]) {
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2 - Math.PI / 2;
        const p = { x: c.x + Math.cos(ang) * radius * 1.25, y: c.y + Math.sin(ang) * radius * 0.8 };
        const score = Math.min(...others.map(o => Math.hypot(o.x - p.x, o.y - p.y)));
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (bestScore > 240) break;
    }
    return { x: Math.round(best.x), y: Math.round(best.y) };
  }

  function autoLayout() {
    const d = depthMap();
    const c = pos(CORE);
    const levels = new Map();
    for (const a of Store.state.agents) {
      const lv = d.has(a.id) ? d.get(a.id) : 99;
      if (!levels.has(lv)) levels.set(lv, []);
      levels.get(lv).push(a);
    }
    const angle = new Map([[CORE, -Math.PI / 2]]);
    const targets = new Map();
    const keys = [...levels.keys()].sort((x, y) => x - y);
    keys.forEach((lv, idx) => {
      const ring = levels.get(lv);
      const radius = 300 + idx * 240;
      const place = (a, ang) => {
        angle.set(a.id, ang);
        targets.set(a.id, { x: c.x + Math.cos(ang) * radius * 1.3, y: c.y + Math.sin(ang) * radius * 0.85 });
      };
      if (lv === 1 || lv === 99) {
        // primeiro anel (ou nós isolados): distribuídos em volta do Asafe
        const n = ring.length;
        const startAng = -Math.PI / 2 + (n > 1 ? Math.PI / n : 0) + (lv === 99 ? Math.PI / 7 : 0);
        ring.forEach((a, i) => place(a, startAng + (i / n) * Math.PI * 2));
      } else {
        // anéis externos: cada nó segue o ângulo do seu pai, em leque
        const byParent = new Map();
        ring.forEach(a => {
          const p = Store.neighbors(a.id).find(n => d.get(n) === lv - 1);
          if (!byParent.has(p)) byParent.set(p, []);
          byParent.get(p).push(a);
        });
        for (const [p, kids] of byParent) {
          const base = angle.get(p) ?? 0;
          const spread = 0.5 / idx;
          kids.forEach((a, j) => place(a, base + (j - (kids.length - 1) / 2) * spread));
        }
      }
    });
    const start = new Map(Store.state.agents.map(a => [a.id, { x: a.x, y: a.y }]));
    const p = { t: 0 };
    tween(p, { t: 1 }, 650, () => {
      for (const a of Store.state.agents) {
        const s = start.get(a.id), t = targets.get(a.id);
        Store.moveNode(a.id, Math.round(s.x + (t.x - s.x) * p.t), Math.round(s.y + (t.y - s.y) * p.t));
      }
      updatePositions();
    }, () => { Store.flushPositions(); fit(); });
  }

  /* ---------------- render ---------------- */
  function nodeHTML(id) {
    if (id === CORE) {
      return `
        <div class="node core" data-id="${CORE}" tabindex="0">
          <div class="core-rings"><i></i><i></i><i></i></div>
          <div class="core-hex"><img src="assets/asafe-mark.png" alt="" draggable="false" /></div>
          <span class="core-label">ASAFE<small>núcleo de servidores</small></span>
          <button class="port" title="Arraste para conectar" aria-label="Conectar Asafe"></button>
        </div>`;
    }
    const a = Store.agent(id);
    return `
      <div class="node agent ${a.kind}" data-id="${a.id}" tabindex="0">
        <div class="node-card">
          <span class="avatar ${a.kind}">${esc(initials(a.name))}</span>
          <span class="node-text">
            <strong>${esc(a.name)}</strong>
            <small>${esc(a.role || (a.kind === 'principal' ? 'Agente principal' : 'IA'))}</small>
          </span>
          <span class="status-dot"></span>
        </div>
        ${a.kind === 'principal' ? '<em class="node-flag">principal</em>' : ''}
        <button class="port" title="Arraste para conectar" aria-label="Conectar ${esc(a.name)}"></button>
      </div>`;
  }

  function render() {
    const s = Store.state;
    const ids = [CORE, ...s.agents.map(a => a.id)];

    // nós
    for (const [id, el] of nodeEls) if (!ids.includes(id)) { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); nodeEls.delete(id); }
    for (const id of ids) {
      const html = nodeHTML(id);
      const old = nodeEls.get(id);
      if (old && old.dataset.html === html) continue;
      const el = h(html);
      el.dataset.html = html;
      if (old) { el.classList.add('no-enter'); old.replaceWith(el); } else els.nodes.appendChild(el);
      nodeEls.set(id, el);
    }

    // linhas
    const linkIds = s.links.map(l => l.id);
    for (const [id, g] of linkEls) if (!linkIds.includes(id)) { g.remove(); linkEls.delete(id); }
    for (const l of s.links) {
      if (linkEls.has(l.id)) continue;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'link entering');
      g.dataset.id = l.id;
      g.innerHTML = '<path class="hit"/><path class="base"/><path class="flow"/>';
      els.links.appendChild(g);
      linkEls.set(l.id, g);
      setTimeout(() => g.classList.remove('entering'), 900);
    }

    // estado online/offline
    const d = depthMap();
    for (const [id, el] of nodeEls) el.classList.toggle('offline', id !== CORE && !d.has(id));
    for (const l of s.links) linkEls.get(l.id).classList.toggle('offline', !d.has(l.from) || !d.has(l.to));

    buildPackets(d);
    updatePositions();
    applySelection();
    renderInspector();

    $('#flowHint').classList.toggle('hidden', s.links.length > 0);
    const online = s.agents.filter(a => d.has(a.id)).length;
    $('#routeChip').textContent = `${online}/${s.agents.length} online`;
  }

  function updatePositions() {
    for (const [id, el] of nodeEls) {
      const p = pos(id);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
    for (const l of Store.state.links) {
      const g = linkEls.get(l.id);
      if (!g) continue;
      const d = curve(pos(l.from), pos(l.to));
      g.querySelectorAll('path').forEach(p => p.setAttribute('d', d));
    }
  }

  function buildPackets(d) {
    els.packets.innerHTML = '';
    packets = [];
    for (const l of Store.state.links) {
      if (!d.has(l.from) || !d.has(l.to)) continue;
      // dados fluem em direção ao Asafe (armazenamento) e respostas voltam
      const inward = d.get(l.from) > d.get(l.to);
      const mk = (cls, toCore, offset, speed) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', cls === 'pk-in' ? 3.2 : 2.4);
        c.setAttribute('class', 'packet ' + cls);
        els.packets.appendChild(c);
        packets.push({ el: c, link: l.id, reverse: toCore ? !inward : inward, offset, speed });
      };
      const seed = (l.id.charCodeAt(4) % 10) / 10;
      mk('pk-in', true, seed, 0.22);
      mk('pk-in', true, (seed + 0.5) % 1, 0.22);
      mk('pk-out', false, (seed + 0.27) % 1, 0.16);
    }
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!active) return;
    const sec = t / 1000;
    for (const p of packets) {
      const g = linkEls.get(p.link);
      if (!g) continue;
      const path = g.querySelector('.base');
      const len = path.getTotalLength();
      if (!len) continue;
      let k = (sec * p.speed * (380 / Math.max(160, len)) + p.offset) % 1;
      if (p.reverse) k = 1 - k;
      const pt = path.getPointAtLength(k * len);
      p.el.setAttribute('cx', pt.x);
      p.el.setAttribute('cy', pt.y);
      p.el.setAttribute('opacity', Math.sin(k * Math.PI).toFixed(2));
    }
  }

  /* ---------------- seleção / inspector ---------------- */
  function select(sel) {
    selected = sel;
    applySelection();
    renderInspector();
  }

  function applySelection() {
    for (const [id, el] of nodeEls) el.classList.toggle('selected', !!selected && selected.type === 'node' && selected.id === id);
    for (const [id, g] of linkEls) g.classList.toggle('selected', !!selected && selected.type === 'link' && selected.id === id);
    // destaca a rota do nó selecionado até o Asafe
    const route = selected && selected.type === 'node' ? Store.routeToCore(selected.id) : null;
    const onRoute = new Set();
    if (route) for (let i = 0; i < route.length - 1; i++) {
      const l = Store.state.links.find(x => (x.from === route[i] && x.to === route[i + 1]) || (x.to === route[i] && x.from === route[i + 1]));
      if (l) onRoute.add(l.id);
    }
    for (const [id, g] of linkEls) g.classList.toggle('route', onRoute.has(id));
  }

  function chainHTML(route) {
    if (!route) return '<span class="chain off">sem rota até o Asafe — conecte este nó à rede</span>';
    return '<span class="chain">' + route.map(id =>
      `<b class="${id === CORE ? 'core' : ''}">${esc(Store.nameOf(id))}</b>`).join('<i>→</i>') + '</span>';
  }

  function renderInspector() {
    const box = $('#inspector');
    const s = Store.state;
    box.innerHTML = '';
    const sel = selected && (selected.type === 'link' ? s.links.find(l => l.id === selected.id) : (selected.id === CORE || Store.agent(selected.id)));
    if (!sel) selected = null;

    if (!selected) {
      $('#inspectorHead h2').textContent = 'Rede';
      const d = depthMap();
      box.appendChild(h(`<p class="muted">Selecione um nó ou linha. Clique duas vezes em uma IA para abrir os dados dela.</p>`));
      const ul = h('<ul class="net-list"></ul>');
      s.agents.forEach(a => {
        const li = h(`<li><button class="net-item">
          <span class="avatar sm ${a.kind}">${esc(initials(a.name))}</span>
          <span class="net-name">${esc(a.name)}</span>
          <span class="status-dot ${d.has(a.id) ? 'ok' : 'off'}"></span>
          <span class="mono dim">${d.has(a.id) ? d.get(a.id) + ' salto' + (d.get(a.id) > 1 ? 's' : '') : '—'}</span>
        </button></li>`);
        li.querySelector('button').addEventListener('click', () => { select({ type: 'node', id: a.id }); focusNode(a.id); });
        ul.appendChild(li);
      });
      if (!s.agents.length) ul.appendChild(h('<li class="empty-mini">Adicione a primeira IA acima.</li>'));
      box.appendChild(ul);
      box.appendChild(h(`<div class="legend">
        <span><i class="lg-in"></i>dados → Asafe</span>
        <span><i class="lg-out"></i>Asafe → IA</span>
        <span><i class="lg-off"></i>sem rota</span>
      </div>`));
      return;
    }

    if (selected.type === 'link') {
      const l = sel;
      $('#inspectorHead h2').textContent = 'Linha de servidor';
      const off = linkEls.get(l.id)?.classList.contains('offline');
      box.appendChild(h(`<div class="insp">
        <div class="link-ends"><b>${esc(Store.nameOf(l.from))}</b><i>⇄</i><b>${esc(Store.nameOf(l.to))}</b></div>
        <dl class="kv">
          <dt>Status</dt><dd><span class="status-dot ${off ? 'off' : 'ok'}"></span> ${off ? 'sem rota até o Asafe' : 'transmitindo'}</dd>
          <dt>Criada</dt><dd>${timeAgo(l.createdAt)}</dd>
          <dt>ID</dt><dd class="mono">${l.id}</dd>
        </dl>
        <button class="btn danger block" id="inspDelLink">Desligar linha</button>
      </div>`));
      $('#inspDelLink').addEventListener('click', () => { Store.removeLink(l.id); selected = null; toast('Linha desligada'); });
      return;
    }

    const id = selected.id;
    const isCore = id === CORE;
    const a = isCore ? null : Store.agent(id);
    $('#inspectorHead h2').textContent = isCore ? 'Núcleo' : 'IA';
    const neigh = Store.neighbors(id);
    const candidates = [CORE, ...s.agents.map(x => x.id)].filter(x => x !== id && !neigh.includes(x));

    const box2 = h(`<div class="insp">
      <div class="insp-head">
        ${isCore ? '<img class="insp-mark" src="assets/asafe-mark-red.png" alt="" />' : `<span class="avatar lg ${a.kind}">${esc(initials(a.name))}</span>`}
        <div>
          <strong>${isCore ? 'Asafe' : esc(a.name)}</strong>
          <small>${isCore ? 'Agente de servidores · centro da rede' : esc(a.role || (a.kind === 'principal' ? 'Agente principal' : 'IA'))}</small>
        </div>
      </div>
      ${isCore ? '' : `<div class="insp-block"><span class="label">Rota até o Asafe</span>${chainHTML(Store.routeToCore(id))}</div>`}
      <div class="insp-block">
        <span class="label">Conexões <span class="mono">${neigh.length}</span></span>
        <ul class="conn-list">${neigh.map(n => `<li><span>${esc(Store.nameOf(n))}</span><button class="icon-btn sm danger" data-unlink="${n}" title="Desligar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`).join('') || '<li class="empty-mini">Nenhuma linha.</li>'}</ul>
      </div>
      ${candidates.length ? `<div class="insp-block connect-row">
        <select id="connectTarget">${candidates.map(c => `<option value="${c}">${esc(Store.nameOf(c))}</option>`).join('')}</select>
        <button class="btn primary" id="connectBtn">Conectar</button>
      </div>` : ''}
      ${isCore ? '' : `<div class="insp-actions">
        <button class="btn ghost" id="inspOpen">Abrir dados</button>
        <button class="btn danger" id="inspDel">Remover</button>
      </div>`}
    </div>`);
    box.appendChild(box2);

    box2.querySelectorAll('[data-unlink]').forEach(b => b.addEventListener('click', () => {
      const other = b.dataset.unlink;
      const l = s.links.find(x => (x.from === id && x.to === other) || (x.to === id && x.from === other));
      if (l) { Store.removeLink(l.id); toast('Linha desligada'); }
    }));
    const cb = box2.querySelector('#connectBtn');
    if (cb) cb.addEventListener('click', () => connect(id, box2.querySelector('#connectTarget').value));
    if (!isCore) {
      box2.querySelector('#inspOpen').addEventListener('click', () => App.openData(id));
      box2.querySelector('#inspDel').addEventListener('click', () => removeAgent(id));
    }
  }

  async function removeAgent(id) {
    const a = Store.agent(id);
    const ok = await confirmBox('Remover IA', `Remover <b>${esc(a.name)}</b> da rede? As linhas e <b>todos os dados</b> do servidor dela no Asafe serão apagados.`, 'Remover');
    if (!ok) return;
    selected = null;
    Store.removeAgent(id);
    toast(`${a.name} removida`);
  }

  function connect(a, b) {
    try {
      Store.addLink(a, b);
      toast(`Linha ${Store.nameOf(a)} ⇄ ${Store.nameOf(b)} estabelecida`);
      const el = nodeEls.get(b);
      if (el) { el.classList.remove('pulse-once'); void el.offsetWidth; el.classList.add('pulse-once'); }
    } catch (e) { toast(e.message, 'err'); }
  }

  function focusNode(id) {
    const r = els.vp.getBoundingClientRect();
    const p = pos(id);
    tween(cam, { x: r.width / 2 - p.x * cam.z, y: r.height / 2 - p.y * cam.z }, 450, applyCam);
  }

  /* ---------------- interação ---------------- */
  function bindPointer() {
    let mode = null, start = null, nodeId = null, nodeStart = null, moved = false, lastTap = { id: null, t: 0 };

    els.vp.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const port = e.target.closest('.port');
      const node = e.target.closest('.node');
      const link = e.target.closest('.link');
      start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      moved = false;
      els.vp.setPointerCapture(e.pointerId);

      if (port && node) {
        mode = 'connect'; nodeId = node.dataset.id;
        els.vp.classList.add('connecting');
        node.classList.add('source');
      } else if (node) {
        mode = 'drag'; nodeId = node.dataset.id; nodeStart = pos(nodeId);
        node.classList.add('dragging');
      } else if (link) {
        mode = 'link'; nodeId = link.dataset.id;
      } else {
        mode = 'pan';
        els.vp.classList.add('panning');
      }
    });

    let hoverTarget = null;
    els.vp.addEventListener('pointermove', e => {
      if (!mode) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (mode === 'pan') {
        cam.x = start.cx + dx; cam.y = start.cy + dy; applyCam();
      } else if (mode === 'drag' && moved) {
        Store.moveNode(nodeId, Math.round(nodeStart.x + dx / cam.z), Math.round(nodeStart.y + dy / cam.z));
        updatePositions();
      } else if (mode === 'connect') {
        const a = pos(nodeId);
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const target = under && under.closest('.node');
        const tid = target && target.dataset.id !== nodeId ? target.dataset.id : null;
        if (hoverTarget !== tid) {
          if (hoverTarget) nodeEls.get(hoverTarget)?.classList.remove('target');
          hoverTarget = tid;
          if (tid) nodeEls.get(tid)?.classList.add('target');
        }
        const b = tid ? pos(tid) : toWorld(e.clientX, e.clientY);
        els.temp.setAttribute('d', curve(a, b));
        els.temp.classList.toggle('valid', !!tid && !Store.linkExists(nodeId, tid));
      }
    });

    const end = e => {
      if (!mode) return;
      if (mode === 'pan') {
        els.vp.classList.remove('panning');
        if (!moved) select(null);
      } else if (mode === 'drag') {
        nodeEls.get(nodeId)?.classList.remove('dragging');
        if (moved) Store.flushPositions();
        else {
          const nowT = performance.now();
          if (lastTap.id === nodeId && nowT - lastTap.t < 380) App.openData(nodeId === CORE ? null : nodeId);
          else select({ type: 'node', id: nodeId });
          lastTap = { id: nodeId, t: nowT };
        }
      } else if (mode === 'link') {
        if (!moved) select({ type: 'link', id: nodeId });
      } else if (mode === 'connect') {
        els.vp.classList.remove('connecting');
        nodeEls.get(nodeId)?.classList.remove('source');
        if (hoverTarget) { nodeEls.get(hoverTarget)?.classList.remove('target'); connect(nodeId, hoverTarget); }
        else if (!moved) select({ type: 'node', id: nodeId });
        hoverTarget = null;
        els.temp.setAttribute('d', '');
      }
      mode = null;
    };
    els.vp.addEventListener('pointerup', end);
    els.vp.addEventListener('pointercancel', end);

    els.vp.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (!active || !selected || !$('#modal').hidden) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selected.type === 'link') { Store.removeLink(selected.id); selected = null; toast('Linha desligada'); }
        else if (selected.id !== CORE) removeAgent(selected.id);
      }
      if (e.key === 'Escape') select(null);
    });
  }

  function init() {
    els.vp = $('#flowViewport');
    els.world = $('#flowWorld');
    els.nodes = $('#nodeLayer');
    els.links = $('#linkLayer');
    els.packets = $('#packetLayer');
    els.temp = $('#tempLink');

    bindPointer();
    $('#zoomIn').addEventListener('click', () => zoomAt(1.2));
    $('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.2));
    $('#zoomFit').addEventListener('click', () => fit());
    $('#autoLayout').addEventListener('click', autoLayout);

    $('#addAgentForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const data = { name: f.name.value, role: f.role.value, kind: f.kind.value, autolink: f.autolink.checked, ...freeSpot() };
      try {
        const a = Store.addAgent(data);
        f.reset();
        toast(`${a.name} adicionada à rede`);
        select({ type: 'node', id: a.id });
        focusNode(a.id);
      } catch (err) { toast(err.message, 'err'); }
    });

    window.addEventListener('resize', () => { if (active && !fitted) fit(false); });
    render();
    raf = requestAnimationFrame(loop);
  }

  function setActive(on) {
    active = on;
    if (on && !fitted) { fitted = true; requestAnimationFrame(() => fit(false)); }
  }

  window.FlowView = { init, render, setActive, fit };
})();
