/* =========================================================
   AsafeUI · deixa um agente ser operado pelo Horácio via Asafe
   Implementa as ações ui.* de docs/CONTROLE.md em qualquer página.
   Sem dependências. Inclua depois do asafe-link.js e chame:

   AsafeUI.attach(link, {
     app: "Miquéias",
     mainInput: "#input",                       // caixa de mensagem principal
     screen: () => "chat",                       // nome da tela atual (opcional)
     isBusy: () => false,                        // true enquanto o agente responde
     protected: [                                // exigem confirmação do Sr. Nathanael
       { selector: '[data-action="logout"]', reason: "Sair da conta" },
       { selector: "#s-key", reason: "Chave de API" }
     ]
   });

   Origem: companynathanael/Hor-cio-Jarvis, integrations/asafe-ui.js (commit 7cd4932),
   o mesmo código usado em companynathanael/miqu-ias (js/asafe-ui.js, commit f16afde).
   Ajustes do Miquéias na revisão:
   - o aviso "está operando" e o cursor aparecem sempre na primeira ação ui.*,
     mesmo sem um ui.control antes (nada de controle invisível);
   - um elemento só conta como visível se nenhum ancestral estiver transparente
     ou invisível (menus fechados e a janela de configurações fechada somem).
   ========================================================= */
(function (root) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code, message) => Object.assign(new Error(message), { code });

  const SELECTOR = [
    "button", "a[href]", "input:not([type=hidden])", "textarea", "select", "summary",
    "[role=button]", "[role=tab]", "[role=menuitem]", "[role=link]", "[role=option]", "[role=switch]",
    "[contenteditable=true]", "[data-asafe-name]", "h1", "h2", "h3"
  ].join(",");

  function attach(link, opts = {}) {
    const cfg = Object.assign({ app: document.title, mainInput: "textarea, input[type=text]", protected: [], isBusy: () => false, screen: () => "" }, opts);
    const refs = new Map(); // ref -> element
    const ids = new WeakMap(); // element -> ref
    let seq = 0;
    let control = { on: false, by: null, stopped: false };

    /* ---------- leitura da tela ---------- */
    const visible = (el) => {
      if (el.closest("[data-asafe-ui]") || el.closest("[aria-hidden=true]") || el.closest("[hidden]") || el.closest("[inert]")) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) <= 0.02) return false;
      }
      return true;
    };
    const refOf = (el) => { let r = ids.get(el); if (!r) { r = "e" + ++seq; ids.set(el, r); } refs.set(r, el); return r; };
    const roleOf = (el) => {
      const r = el.getAttribute("role");
      if (r) return r === "switch" ? "toggle" : r;
      const t = el.tagName.toLowerCase();
      if (/^h[1-3]$/.test(t)) return "heading";
      if (t === "a") return "link";
      if (t === "textarea" || el.isContentEditable) return "textarea";
      if (t === "input") return el.type === "checkbox" || el.type === "radio" ? "toggle" : "input";
      if (t === "select") return "input";
      if (el.hasAttribute("aria-pressed")) return "toggle";
      return el.closest("nav, aside, [role=list], ul, ol") && t !== "button" ? "item" : "button";
    };
    const nameOf = (el) => {
      const lab = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const n = el.getAttribute("data-asafe-name") || el.getAttribute("aria-label") ||
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? (lab && lab.innerText) || el.placeholder || el.name : "") ||
        el.innerText || el.title || el.value || "";
      return n.replace(/\s+/g, " ").trim().slice(0, 80);
    };
    const protection = (el) => {
      if (el.type === "password") return "Campo de senha";
      for (const p of cfg.protected) if (el.matches(p.selector) || el.closest(p.selector)) return p.reason || "Elemento protegido";
      return null;
    };
    const stateOf = (el) => {
      const s = [];
      if (el.disabled || el.getAttribute("aria-disabled") === "true") s.push("disabled");
      if (el.getAttribute("aria-selected") === "true" || el.classList.contains("active")) s.push("selected");
      if (el.getAttribute("aria-pressed") === "true" || el.checked) s.push("pressed");
      if (el.getAttribute("aria-expanded") === "true") s.push("expanded");
      if (document.activeElement === el) s.push("focused");
      return s;
    };

    function collect() {
      const seen = new Set();
      const out = [];
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (!visible(el)) continue;
        // não repete um elemento que está dentro de outro já listado (ex.: <span> dentro de <button>)
        if ([...seen].some((p) => p !== el && p.contains(el) && roleOf(el) !== "input" && roleOf(el) !== "textarea")) continue;
        seen.add(el);
        const prot = protection(el);
        const item = { ref: refOf(el), role: roleOf(el), name: nameOf(el) };
        const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        if (isField && el.type !== "checkbox" && el.type !== "radio") item.value = prot ? "" : String(el.value || "").slice(0, 200);
        const st = stateOf(el); if (st.length) item.state = st;
        if (prot) item.protected = true;
        if (item.name || isField) out.push(item);
      }
      return out;
    }

    function find(p) {
      if (p.ref) {
        const el = refs.get(p.ref);
        if (!el || !el.isConnected || !visible(el)) throw fail("not_found", `O elemento ${p.ref} não está mais na tela. Leia a tela de novo.`);
        return el;
      }
      if (!p.name) throw fail("bad_request", "Informe ref ou name.");
      const want = norm(p.name);
      const els = collect().map((i) => ({ i, el: refs.get(i.ref), n: norm(i.name) })).filter((x) => x.n);
      for (const test of [(n) => n === want, (n) => n.startsWith(want), (n) => n.includes(want)]) {
        const hit = els.filter((x) => test(x.n));
        const uniq = [...new Set(hit.map((x) => x.el))];
        if (uniq.length === 1) return uniq[0];
        if (uniq.length > 1) {
          const exactActionable = hit.filter((x) => x.i.role !== "heading");
          if (exactActionable.length === 1) return exactActionable[0].el;
          throw fail("ambiguous", `Há ${uniq.length} elementos com "${p.name}": ${hit.slice(0, 5).map((x) => `${x.i.name} (${x.i.role}, ${x.i.ref})`).join("; ")}.`);
        }
      }
      throw fail("not_found", `Não encontrei "${p.name}" na tela de ${cfg.app}.`);
    }

    const describe = (el) => ({ ref: refOf(el), role: roleOf(el), name: nameOf(el) });

    /* ---------- aviso e cursor fantasma ---------- */
    let banner = null, cursor = null;
    function ensureUI() {
      if (banner) return;
      const st = document.createElement("style");
      st.setAttribute("data-asafe-ui", "");
      st.textContent = `
        .asafe-ui-banner{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:12px;
          padding:8px 8px 8px 14px;border-radius:14px;background:rgba(10,10,10,.82);color:#f5f5f5;border:1px solid rgba(255,255,255,.18);
          backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);font:500 13px/1.2 Inter,system-ui,sans-serif;box-shadow:0 12px 40px -12px rgba(0,0,0,.7)}
        .asafe-ui-banner i{width:8px;height:8px;border-radius:50%;background:#fff;animation:asafeP 1.4s infinite}
        .asafe-ui-banner button{font:inherit;font-size:12px;padding:6px 12px;border-radius:9px;border:0;background:#f5f5f5;color:#000;cursor:pointer}
        @keyframes asafeP{50%{opacity:.25}}
        .asafe-ui-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .45s cubic-bezier(.2,.8,.2,1);
          filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
        .asafe-ui-cursor.tap::after{content:"";position:absolute;left:-9px;top:-9px;width:40px;height:40px;border-radius:50%;border:2px solid #fff;animation:asafeT .45s ease-out forwards}
        @keyframes asafeT{from{transform:scale(.3);opacity:1}to{transform:scale(1.2);opacity:0}}
        .asafe-ui-ring{outline:2px solid #fff !important;outline-offset:3px !important;border-radius:8px}`;
      document.head.append(st);
      banner = document.createElement("div");
      banner.className = "asafe-ui-banner";
      banner.setAttribute("data-asafe-ui", "");
      banner.hidden = true;
      banner.innerHTML = `<i></i><span></span><button type="button">Parar</button>`;
      banner.querySelector("button").onclick = () => {
        control.stopped = true;
        hideUI();
        if (control.by) link.emit(control.by, "ui.stopped", { reason: "user" }).catch(() => {});
      };
      cursor = document.createElement("div");
      cursor.className = "asafe-ui-cursor";
      cursor.setAttribute("data-asafe-ui", "");
      cursor.hidden = true;
      cursor.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
      document.body.append(banner, cursor);
    }
    function showUI(by) {
      ensureUI();
      banner.querySelector("span").textContent = `${by === "horacio" ? "Horácio" : by} está operando`;
      banner.hidden = false; cursor.hidden = false;
      const r = document.documentElement;
      cursor.style.transform = `translate(${r.clientWidth / 2}px, ${r.clientHeight / 2}px)`;
    }
    function hideUI() { if (banner) { banner.hidden = true; cursor.hidden = true; } }

    async function point(el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await sleep(120);
      if (!control.on || !cursor) return;
      const r = el.getBoundingClientRect();
      cursor.style.transform = `translate(${r.left + Math.min(r.width / 2, 40)}px, ${r.top + r.height / 2}px)`;
      el.classList.add("asafe-ui-ring");
      await sleep(480);
      cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap");
      setTimeout(() => el.classList.remove("asafe-ui-ring"), 500);
    }

    /* ---------- guarda ---------- */
    function guard(p, el) {
      if (control.stopped) throw fail("stopped", `O Sr. Nathanael parou o controle no ${cfg.app}.`);
      if (el && (el.disabled || el.getAttribute("aria-disabled") === "true")) throw fail("disabled", `"${nameOf(el)}" está desativado.`);
      const prot = el && protection(el);
      if (prot && !p.confirm) throw fail("needs_confirmation", `${prot}: "${nameOf(el) || el.tagName.toLowerCase()}" no ${cfg.app} é protegido. Confirma esta ação?`);
    }

    const setValue = (el, text) => {
      if (el.isContentEditable) { el.textContent = text; }
      else {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(el, text);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const press = (el, key) => {
      const init = { key, code: key, bubbles: true, cancelable: true };
      const down = el.dispatchEvent(new KeyboardEvent("keydown", init));
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      // Enter sem tratamento numa caixa de formulário: envia o formulário
      if (down && key === "Enter" && el.form && el.tagName !== "TEXTAREA") el.form.requestSubmit();
    };
    const scroller = (from) => {
      let el = from;
      while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el; el = el.parentElement; }
      let best = document.scrollingElement, max = 0;
      for (const c of document.querySelectorAll("*")) {
        if (c.scrollHeight - c.clientHeight > max && /(auto|scroll)/.test(getComputedStyle(c).overflowY) && visible(c)) { max = c.scrollHeight - c.clientHeight; best = c; }
      }
      return best;
    };

    /* ---------- ações ---------- */
    const actions = {
      "ui.control": async (p, ctx) => {
        control = { on: !!p.on, by: p.by || ctx.from, stopped: false };
        if (control.on) showUI(control.by); else hideUI();
        return { on: control.on };
      },
      "ui.snapshot": async () => {
        guard({});
        const main = document.querySelector("main") || document.body;
        return { app: cfg.app, screen: cfg.screen() || "", elements: collect(), text: (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(-2000) };
      },
      "ui.click": async (p) => {
        const el = find(p); guard(p, el);
        await point(el);
        el.focus({ preventScroll: true });
        el.click();
        return { done: true, target: describe(el) };
      },
      "ui.type": async (p) => {
        if (typeof p.text !== "string") throw fail("bad_request", "Informe o texto em text.");
        const el = p.ref || p.name ? find(p) : document.querySelector(cfg.mainInput);
        if (!el) throw fail("not_found", `Não encontrei a caixa de mensagem do ${cfg.app}.`);
        guard(p, el);
        await point(el);
        el.focus({ preventScroll: true });
        const base = p.clear === false ? (el.isContentEditable ? el.textContent : el.value) : "";
        // digita aos poucos para o Sr. Nathanael acompanhar
        const step = Math.max(1, Math.ceil(p.text.length / 40));
        for (let i = step; i < p.text.length + step; i += step) { setValue(el, base + p.text.slice(0, i)); await sleep(18); }
        if (p.submit) press(el, "Enter");
        return { done: true, target: describe(el) };
      },
      "ui.key": async (p) => {
        guard(p);
        const el = p.ref || p.name ? find(p) : document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector(cfg.mainInput);
        if (!el) throw fail("not_found", "Nenhum elemento em foco.");
        guard(p, el);
        press(el, p.key || "Enter");
        return { done: true, target: describe(el) };
      },
      "ui.scroll": async (p) => {
        guard(p);
        const el = scroller(p.ref || p.name ? find(p) : document.querySelector(cfg.mainInput));
        const d = p.direction || "down";
        const top = d === "top" ? 0 : d === "bottom" ? el.scrollHeight : el.scrollTop + (d === "up" ? -1 : 1) * el.clientHeight * 0.8;
        el.scrollTo({ top, behavior: "smooth" });
        await sleep(350);
        return { done: true };
      },
      "ui.wait": async (p) => {
        guard(p);
        const limit = Date.now() + Math.min(p.timeout || 15000, 60000);
        if (p.idle) await sleep(600); // dá tempo de a resposta começar
        while (Date.now() < limit) {
          if (control.stopped) throw fail("stopped", `O Sr. Nathanael parou o controle no ${cfg.app}.`);
          if (p.text && norm(document.body.innerText).includes(norm(p.text))) return { found: true };
          if (p.idle && !cfg.isBusy()) return { found: true };
          await sleep(250);
        }
        throw fail("timeout", p.text ? `"${p.text}" não apareceu a tempo.` : `${cfg.app} ainda está respondendo.`);
      }
    };

    const desc = {
      "ui.control": "Liga/desliga o controle remoto e o aviso na tela. payload: { on, by }",
      "ui.snapshot": "Descreve a tela: elementos visíveis com ref, papel e nome",
      "ui.click": "Clica num elemento. payload: { ref | name, confirm? }",
      "ui.type": "Digita num campo (padrão: caixa de mensagem). payload: { text, ref | name?, clear?, submit?, confirm? }",
      "ui.key": "Pressiona uma tecla. payload: { key, ref? }",
      "ui.scroll": "Rola a tela. payload: { direction: up|down|top|bottom }",
      "ui.wait": "Espera um texto aparecer ou o agente terminar. payload: { text? , idle?, timeout? }"
    };
    // Toda ação ui.* acende o aviso com o botão Parar: o controle nunca fica invisível.
    const announced = (name, fn) => async (p, ctx) => {
      if (name !== "ui.control" && !control.on && !control.stopped) {
        control = { on: true, by: ctx.from, stopped: false };
        showUI(ctx.from);
      }
      return fn(p || {}, ctx);
    };
    for (const name of Object.keys(actions)) link.handle(name, announced(name, actions[name]), desc[name]);
    return { collect, find };
  }

  root.AsafeUI = { attach };
})(typeof window !== "undefined" ? window : globalThis);
