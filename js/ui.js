/* =========================================================
   Asafe · UI helpers (toasts, modais, formatação)
   ========================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i];
  }

  function fmtDate(t) {
    const d = new Date(t);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'agora';
    const m = Math.round(s / 60);
    if (m < 60) return `há ${m} min`;
    const hh = Math.round(m / 60);
    if (hh < 24) return `há ${hh} h`;
    return `há ${Math.round(hh / 24)} d`;
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  /* ---------- toasts ---------- */
  function toast(msg, type = 'ok') {
    const el = h(`<div class="toast ${type}"><i></i><span>${esc(msg)}</span></div>`);
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, type === 'err' ? 4200 : 2600);
  }

  /* ---------- modal ---------- */
  let modalResolve = null;
  let lastFocus = null;

  function modal({ title, body, actions = [], wide = false }) {
    const m = $('#modal');
    lastFocus = document.activeElement;
    $('#modalTitle').textContent = title;
    const b = $('#modalBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    const f = $('#modalFoot');
    f.innerHTML = '';
    m.querySelector('.modal-card').classList.toggle('wide', wide);
    return new Promise(resolve => {
      modalResolve = resolve;
      actions.forEach(a => {
        const btn = h(`<button class="btn ${a.kind || 'ghost'}">${esc(a.label)}</button>`);
        btn.addEventListener('click', () => {
          const v = a.value !== undefined ? (typeof a.value === 'function' ? a.value(b) : a.value) : a.label;
          if (v === false && a.keepOpen) return;
          closeModal(v);
        });
        f.appendChild(btn);
      });
      f.hidden = !actions.length;
      m.hidden = false;
      requestAnimationFrame(() => {
        m.classList.add('open');
        const first = b.querySelector('input, textarea, select') || f.querySelector('.btn.primary, .btn.danger');
        if (first) first.focus();
      });
    });
  }

  function closeModal(value = null) {
    const m = $('#modal');
    m.classList.remove('open');
    setTimeout(() => { m.hidden = true; }, 220);
    if (modalResolve) { const r = modalResolve; modalResolve = null; r(value); }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(null); });
  document.addEventListener('keydown', e => {
    const m = $('#modal');
    if (m.hidden) return;
    if (e.key === 'Escape') closeModal(null);
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      const p = $('#modalFoot .btn.primary'); if (p) p.click();
    }
  });

  function confirmBox(title, text, label = 'Apagar') {
    return modal({
      title,
      body: `<p class="modal-text">${text}</p>`,
      actions: [{ label: 'Cancelar', value: false }, { label, kind: 'danger', value: true }]
    });
  }

  function promptBox(title, label, value = '', okLabel = 'Salvar') {
    const body = h(`<div class="form"><label>${esc(label)}<input value="${esc(value)}" maxlength="64" /></label></div>`);
    return modal({
      title, body,
      actions: [{ label: 'Cancelar', value: null }, { label: okLabel, kind: 'primary', value: b => b.querySelector('input').value.trim() || null }]
    });
  }

  window.UI = { $, $$, esc, h, fmtBytes, fmtDate, timeAgo, initials, toast, modal, closeModal, confirmBox, promptBox };
})();
