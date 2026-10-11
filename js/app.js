(() => {
  const API = window.APP_CONFIG.API_URL.replace(/\/$/, "");
  const CATEGORIES = ["Books and notes", "Electronics", "ID and cards", "Keys", "Bags",
    "Wallet and money", "Clothing", "Bottle and lunch box", "Other"];
  const EMOJI = { "Books and notes": "📚", "Electronics": "🎧", "ID and cards": "🪪", "Keys": "🔑", "Bags": "🎒",
    "Wallet and money": "👛", "Clothing": "🧥", "Bottle and lunch box": "🥤", "Other": "🔎" };
  const TYPE = { LOST: "Lost", FOUND: "Found" };
  const STATUS = { OPEN: "Open", IN_PROGRESS: "Someone replied", CLOSED: "Returned" };

  const $app = document.getElementById("app");
  const $nav = document.getElementById("nav");
  const $toast = document.getElementById("toast");
  let session = JSON.parse(localStorage.getItem("session") || "null");   // { token, name, email }
  let notice = null;                                                       // toast shown after the next render
  let poll = null, current = null;                                         // live refresh of the open item
  const active = {};                                                       // which conversation is open, per item
  const drafts = {};                                                       // unsent text, so refreshes never wipe it

  /* ---------- helpers ---------- */
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const first = (n) => String(n || "").split(" ")[0];

  function setSession(s) {
    session = s;
    if (s) localStorage.setItem("session", JSON.stringify(s)); else localStorage.removeItem("session");
  }

  function toast(text, kind = "ok") {
    $toast.textContent = text;
    $toast.className = "show " + kind;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.className = ""; }, 4500);
  }

  async function api(path, { method = "GET", body, form } = {}) {
    const headers = {};
    if (session) headers.Authorization = "Bearer " + session.token;
    let payload;
    if (form) payload = form;
    else if (body) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: payload });
    } catch {
      throw { error: "Cannot reach the server. If it was idle, wait a few seconds and try again." };
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && session && !path.startsWith("/api/auth/")) {
      setSession(null);
      notice = { kind: "error", text: "Your session expired. Log in again." };
      location.hash = "#/login";
    }
    if (!res.ok) throw { status: res.status, ...(data || { error: "Something went wrong." }) };
    return data;
  }

  const show = (html) => { $app.innerHTML = html; };
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const emptyState = (icon, title, text, extra = "") =>
    `<div class="empty-state"><div class="big">${icon}</div><h2>${title}</h2><p>${text}</p>${extra}</div>`;

  function loading() {
    show(`<div class="wrap"><div class="grid">${'<div class="skel"></div>'.repeat(3)}</div>
      <p class="wake" hidden>The server may be waking up. The first load can take up to a minute.</p></div>`);
    setTimeout(() => { const w = document.querySelector(".wake"); if (w) w.hidden = false; }, 4000);
  }

  function renderNav() {
    $nav.innerHTML =
      `<a class="btn btn-lost" href="#/new?type=LOST">Report lost</a>
       <a class="btn btn-found" href="#/new?type=FOUND">Report found</a>` +
      (session
        ? `<a href="#/mine">My cases</a><button class="link" id="logout" type="button">Log out (${esc(first(session.name))})</button>`
        : `<a href="#/login">Log in</a><a href="#/register">Sign up</a>`);
    const out = document.getElementById("logout");
    if (out) out.onclick = () => { setSession(null); notice = { kind: "ok", text: "Logged out." }; go("#/"); };
  }

  const card = (i) => {
    const t = i.type.toLowerCase();
    const media = i.hasImage
      ? `<img src="${API}/api/items/${i.id}/image" alt="" loading="lazy">`
      : `<span class="ph">${EMOJI[i.category] || "🔎"}</span>`;
    return `
      <a class="card ${i.status === "CLOSED" ? "is-closed" : ""}" href="#/item/${i.id}">
        <div class="media m-${t}">${media}
          <span class="badge b-${t}">${TYPE[i.type]}</span>
          <span class="pill s-${i.status.toLowerCase()}">${STATUS[i.status]}</span>
        </div>
        <div class="card-body">
          <h3>${esc(i.title)}</h3>
          <p class="meta">${I.pin}<span>${esc(i.location)}</span></p>
          <p class="meta">${I.cal}<span>${day(i.eventDate)}</span></p>
        </div>
        <div class="card-foot"><span>by ${esc(first(i.reporterName))}</span><span>${i.responseCount} ${i.responseCount === 1 ? "reply" : "replies"}</span></div>
      </a>`;
  };

  function showFormError(form, e) {
    const box = form.querySelector(".error");
    if (box) { box.textContent = e.error || "Something went wrong."; box.hidden = false; }
    form.querySelectorAll("[data-err]").forEach((el) => { el.textContent = (e.errors && e.errors[el.dataset.err]) || ""; });
  }

  function onSubmit(form, handler) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try { await handler(); } catch (e) { showFormError(form, e); } finally { btn.disabled = false; }
    });
  }

  /* ---------- home ---------- */
  async function home(p) {
    loading();
    const all = await api("/api/items");
    const q = (p.get("q") || "").trim(), type = p.get("type") || "", status = p.get("status") || "";
    const needle = q.toLowerCase();
    const items = all.filter((i) => (!type || i.type === type) && (!status || i.status === status) &&
      (!needle || [i.title, i.description, i.location, i.category].some((s) => (s || "").toLowerCase().includes(needle))));
    const stat = {
      lost: all.filter((i) => i.type === "LOST" && i.status !== "CLOSED").length,
      found: all.filter((i) => i.type === "FOUND" && i.status !== "CLOSED").length,
      back: all.filter((i) => i.status === "CLOSED").length,
    };
    const href = (o) => "#/?" + new URLSearchParams({ q, ...o }).toString();
    const chips = [["All", {}, !type && !status], ["Lost", { type: "LOST" }, type === "LOST"],
      ["Found", { type: "FOUND" }, type === "FOUND"], ["Returned", { status: "CLOSED" }, status === "CLOSED"]];

    show(`
      <section class="hero"><div class="hero-in">
        <h1>Lost it? Found it? Let's get it home.</h1>
        <p class="lead">Every report on campus lives on this board. Spot your item, start a private chat with whoever has it, and close the case once it is back in your hands.</p>
        <form class="search" id="search">
          <input type="search" name="q" value="${esc(q)}" placeholder="Try: black umbrella, ID card, Block C" aria-label="Search">
          <input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="status" value="${esc(status)}">
          <button class="btn btn-sun" type="submit">Search</button>
        </form>
        <div class="stats">
          <div class="stat"><b>${stat.lost}</b><span>still lost</span></div>
          <div class="stat"><b>${stat.found}</b><span>waiting for owners</span></div>
          <div class="stat"><b>${stat.back}</b><span>returned</span></div>
        </div>
      </div></section>
      <nav class="chips" aria-label="Filter">${chips.map(([n, o, on]) => `<a class="chip ${on ? "on" : ""}" href="${href(o)}">${n}</a>`).join("")}</nav>
      <div class="wrap">${items.length
        ? `<div class="grid">${items.map(card).join("")}</div>`
        : emptyState("🔎", "Nothing matches", "Try a different word, or post a report so others can help.",
            `<a class="btn btn-solid" href="#/new?type=LOST">Report a lost item</a>`)}</div>`);

    document.getElementById("search").addEventListener("submit", (ev) => {
      ev.preventDefault();
      go("#/?" + new URLSearchParams(new FormData(ev.target)).toString());
    });
  }

  /* ---------- item + private conversation ---------- */
  const signature = (d) => JSON.stringify([d.item.status, d.canRespond,
    d.threads.map((t) => [t.id, t.messages.length, t.ownerConfirmed, t.finderConfirmed])]);

  async function sync(id) {
    const n = await api(`/api/items/${id}`);
    if (!current || current.id !== id) return;
    if (n.item.status !== current.d.item.status) { route(); return; }     // case just closed: redraw the page
    const s = signature(n);
    if (s !== current.sig) { current.d = n; current.sig = s; renderConv(n); }
  }

  async function detail(id) {
    loading();
    const d = await api(`/api/items/${id}`);
    const i = d.item, t = i.type.toLowerCase();
    const media = i.hasImage
      ? `<img src="${API}/api/items/${i.id}/image" alt="Photo of the item">`
      : `<span class="ph">${EMOJI[i.category] || "🔎"}</span>`;
    show(`<div class="wrap">
      <a class="back" href="#/">&larr; Back to the board</a>
      <div class="detail">
        <article class="item-card">
          <div class="media item-media m-${t}">${media}
            <span class="badge b-${t}">${TYPE[i.type]}</span>
            <span class="pill s-${i.status.toLowerCase()}">${STATUS[i.status]}</span>
          </div>
          <div class="item-body">
            <h1>${esc(i.title)}</h1>
            <div class="facts">
              <p class="fact">${I.pin}<span><b>${i.type === "LOST" ? "Lost at" : "Found at"}</b> ${esc(i.location)}</span></p>
              <p class="fact">${I.cal}<span>${day(i.eventDate)}</span></p>
              <p class="fact">${I.user}<span>Posted by ${esc(i.reporterName)}</span></p>
            </div>
            <span class="tagline">${esc(i.category)}</span>
            ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
            ${!d.reporter && i.responseCount ? `<p class="meta-line">${i.responseCount === 1 ? "1 person has" : i.responseCount + " people have"} started a chat about this item.</p>` : ""}
          </div>
        </article>
        <section class="conv" id="conv"></section>
      </div></div>`);
    current = { id, d, sig: signature(d) };
    renderConv(d);
    poll = setInterval(() => { if (!document.hidden) sync(id).catch(() => {}); }, 6000);
  }

  function chatHtml(d, t) {
    const i = d.item, closed = i.status === "CLOSED";
    const step = t.completed ? 3 : (t.ownerConfirmed || t.finderConfirmed) ? 2 : 1;
    const steps = ["Chat", "Handover", "Closed"].map((n, k) =>
      `<li data-n="${k + 1}" class="${t.completed || k + 1 < step ? "done" : k + 1 === step ? "on" : ""}">${n}</li>`).join("");
    const tabs = d.reporter && d.threads.length > 1
      ? `<div class="tabs">${d.threads.map((x) => `<button type="button" class="tab ${x.id === t.id ? "on" : ""}" data-tid="${x.id}">${esc(first(x.otherName))}${x.completed ? " ✓" : ""}</button>`).join("")}</div>` : "";
    const sub = d.reporter
      ? esc(t.otherEmail || "") + (t.otherPhone ? ", " + esc(t.otherPhone) : "")
      : "Posted this report";
    const msgs = t.messages.map((m) => `
      <div class="bubble ${m.mine ? "me" : "them"}"><p>${esc(m.text)}</p>
        <small>${m.mine ? "You" : esc(first(m.senderName))}, ${when(m.createdAt)}</small></div>`).join("");

    let bottom;
    if (closed) {
      bottom = t.completed
        ? `<div class="banner-ok">${I.check} Case closed. The item was handed over and this conversation has ended.</div>`
        : `<div class="banner-ok neutral">This case was closed through another conversation.</div>`;
    } else {
      const owner = t.myRole === "OWNER";
      bottom = `
        <div class="handover">
          <div class="confirms">
            <span class="cchip ${t.ownerConfirmed ? "done" : ""}">${t.ownerConfirmed ? I.check : "○"} Owner got the item</span>
            <span class="cchip ${t.finderConfirmed ? "done" : ""}">${t.finderConfirmed ? I.check : "○"} Finder handed it over</span>
          </div>
          ${t.iConfirmed
            ? `<p class="hint">You confirmed. Waiting for the ${owner ? "finder" : "owner"} to confirm. The chat closes when both of you have.</p>`
            : `<p class="hint">${t.otherConfirmed ? "The other person has confirmed. " : ""}Confirm only after the item has really changed hands. This cannot be undone.</p>
               <button class="btn" id="confirmBtn" type="button" data-tid="${t.id}" data-role="${t.myRole}">${owner ? "I got my item back" : "I handed it over"}</button>`}
        </div>
        <form class="composer" id="msgForm" data-tid="${t.id}">
          <textarea data-key="t${t.id}" rows="1" maxlength="500" placeholder="Write a message" aria-label="Message"></textarea>
          <button class="send" type="submit" aria-label="Send">${I.send}</button>
        </form>`;
    }
    return `${tabs}
      <div class="chat-head"><span class="avatar">${esc((t.otherName || "?")[0].toUpperCase())}</span>
        <div><b>${esc(t.otherName)}</b><small>${sub}</small></div></div>
      <ol class="steps">${steps}</ol>
      <div class="msgs">${msgs}</div>${bottom}`;
  }

  function renderConv(d) {
    const el = document.getElementById("conv");
    if (!el) return;
    const i = d.item, lost = i.type === "LOST", closed = i.status === "CLOSED";

    const old = el.querySelector("textarea");                               // keep what the user was typing
    if (old && old.dataset.key) drafts[old.dataset.key] = old.value;
    const refocus = old && document.activeElement === old;

    let html;
    if (!session) {
      html = emptyState("💬", closed ? "This case is closed" : lost ? "Found this item?" : "Is this yours?",
        closed ? "The item has been handed back." : "Log in to start a private chat with the person who posted this.",
        closed ? "" : `<a class="btn btn-solid" href="#/login">Log in</a>`);
    } else if (d.canRespond) {
      html = `<div class="conv-start">
        <h2>${lost ? "Found this item?" : "Is this yours?"}</h2>
        <p>${lost ? "Tell the owner where you found it and who has it now. This opens a private chat between the two of you."
                  : "Describe something only the owner would know. This opens a private chat with the finder."}</p>
        <form id="startForm"><textarea data-key="new${i.id}" rows="4" maxlength="500" required aria-label="Message"
          placeholder="${lost ? "I found it near the library. It is with me right now." : "It has a green sticker on the back."}"></textarea>
          <button class="btn btn-solid" type="submit">${lost ? "I found it" : "This is mine"}</button></form></div>`;
    } else if (!d.threads.length) {
      html = emptyState(closed ? "✅" : "⏳", closed ? "This case is closed" : "No replies yet",
        closed ? "The item has been handed back." : "When someone replies, a private chat opens right here.");
    } else {
      const t = d.threads.find((x) => x.id === active[i.id]) || d.threads[0];
      active[i.id] = t.id;
      html = chatHtml(d, t);
    }
    el.innerHTML = html;
    wireConv(el, d);

    const msgs = el.querySelector(".msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    const ta = el.querySelector("textarea");
    if (ta) { ta.value = drafts[ta.dataset.key] || ""; if (refocus) ta.focus(); }
  }

  function bindText(form, enterSends, fn) {
    const ta = form.querySelector("textarea"), btn = form.querySelector("button[type=submit]");
    if (enterSends) ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      btn.disabled = true;
      try { await fn(text, ta); } catch (e) { toast(e.error || "Something went wrong.", "error"); } finally { btn.disabled = false; }
    });
  }

  function wireConv(el, d) {
    const id = d.item.id;
    el.querySelectorAll(".tab").forEach((b) => { b.onclick = () => { active[id] = Number(b.dataset.tid); renderConv(d); }; });

    const start = el.querySelector("#startForm");
    if (start) bindText(start, false, async (text) => {
      await api(`/api/items/${id}/respond`, { method: "POST", body: { message: text } });
      drafts["new" + id] = "";
      toast("Chat started. The other person will see your message.");
      await sync(id);
    });

    const msg = el.querySelector("#msgForm");
    if (msg) bindText(msg, true, async (text, ta) => {
      await api(`/api/threads/${msg.dataset.tid}/messages`, { method: "POST", body: { message: text } });
      ta.value = ""; drafts["t" + msg.dataset.tid] = "";
      await sync(id);
    });

    const cb = el.querySelector("#confirmBtn");
    if (cb) cb.onclick = async () => {
      const owner = cb.dataset.role === "OWNER";
      if (!window.confirm(owner ? "Confirm that you have your item back? This cannot be undone."
                                : "Confirm that you handed the item over? This cannot be undone.")) return;
      cb.disabled = true;
      try {
        await api(`/api/threads/${cb.dataset.tid}/confirm`, { method: "POST" });
        toast("Confirmed.");
        await sync(id);
      } catch (e) { toast(e.error || "Something went wrong.", "error"); cb.disabled = false; }
    };
  }

  /* ---------- report an item ---------- */
  function newItem(p) {
    if (!session) { notice = { kind: "error", text: "Log in to report an item." }; go("#/login"); return; }
    const type = p.get("type") === "FOUND" ? "FOUND" : "LOST";
    const today = new Date().toISOString().slice(0, 10);
    const err = (n) => `<small class="err" data-err="${n}"></small>`;
    show(`<div class="wrap narrow"><div class="form-card">
      <h1 class="page-title">Report an item</h1>
      <form class="form" id="itemForm">
        <div class="type-pick">
          <label class="tp"><input type="radio" name="type" value="LOST" ${type === "LOST" ? "checked" : ""}><span><b>I lost something</b><small>Post it so finders can reach you</small></span></label>
          <label class="tp"><input type="radio" name="type" value="FOUND" ${type === "FOUND" ? "checked" : ""}><span><b>I found something</b><small>Help it get back to its owner</small></span></label>
        </div>
        <label>Item <input type="text" name="title" placeholder="Blue Casio calculator">${err("title")}</label>
        <label>Category <select name="category"><option value="">Choose one</option>
          ${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select>${err("category")}</label>
        <label>Where <input type="text" name="location" placeholder="Block C, 2nd floor corridor">${err("location")}</label>
        <label>Date <input type="date" name="eventDate" value="${today}" max="${today}">${err("eventDate")}</label>
        <label>Details that identify it (colour, stickers, scratches). For found items, keep one detail back so you can verify the owner.
          <textarea name="description" rows="4"></textarea>${err("description")}</label>
        <label>Photo (optional, up to 5 MB) <input type="file" name="image" accept="image/*"></label>
        <img class="preview" id="preview" alt="" hidden>
        <p class="error" hidden></p>
        <button class="btn btn-solid" type="submit">Post report</button>
      </form></div></div>`);
    const form = document.getElementById("itemForm");
    form.image.addEventListener("change", () => {
      const f = form.image.files[0], pv = document.getElementById("preview");
      if (f) { pv.src = URL.createObjectURL(f); pv.hidden = false; } else pv.hidden = true;
    });
    onSubmit(form, async () => {
      const item = await api("/api/items", { method: "POST", form: new FormData(form) });
      notice = { kind: "ok", text: "Report posted." };
      go("#/item/" + item.id);
    });
  }

  /* ---------- my cases ---------- */
  async function mine() {
    if (!session) { go("#/login"); return; }
    loading();
    const d = await api("/api/me/items");
    show(`<div class="wrap">
      <h1 class="page-title">My cases</h1>
      <h2 class="section-title">Reports I posted</h2>
      ${d.reported.length ? `<div class="grid">${d.reported.map(card).join("")}</div>` : emptyState("📝", "Nothing posted yet", "Lost or found something? Post it on the board.")}
      <h2 class="section-title">Reports I replied to</h2>
      ${d.replied.length ? `<div class="grid">${d.replied.map(card).join("")}</div>` : emptyState("💬", "No chats yet", "When you reply to a report, it shows up here.")}
    </div>`);
  }

  /* ---------- log in / sign up ---------- */
  function authPage(mode) {
    const reg = mode === "register";
    const err = (n) => `<small class="err" data-err="${n}"></small>`;
    show(`<div class="wrap narrow"><div class="form-card">
      <h1 class="page-title">${reg ? "Create your account" : "Welcome back"}</h1>
      <p>${reg ? "You need an account to report items and start chats. Browsing is open to everyone." : "Log in to report items and chat with finders and owners."}</p>
      <form class="form" id="authForm">
        ${reg ? `<label>Full name <input type="text" name="name" autocomplete="name">${err("name")}</label>` : ""}
        <label>Email <input type="email" name="email" required autocomplete="email">${err("email")}</label>
        ${reg ? `<label>Phone (optional, shown only to people you chat with) <input type="tel" name="phone" autocomplete="tel">${err("phone")}</label>` : ""}
        <label>Password <input type="password" name="password" required autocomplete="${reg ? "new-password" : "current-password"}">${err("password")}</label>
        <p class="error" hidden></p>
        <button class="btn btn-solid" type="submit">${reg ? "Create account" : "Log in"}</button>
      </form>
      <p>${reg ? `Already registered? <a href="#/login">Log in</a>` : `New here? <a href="#/register">Create an account</a>`}</p>
    </div></div>`);
    const form = document.getElementById("authForm");
    onSubmit(form, async () => {
      const body = Object.fromEntries(new FormData(form));
      const r = await api(reg ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
      setSession({ token: r.token, name: r.name, email: r.email });
      notice = { kind: "ok", text: "Welcome, " + first(r.name) + "!" };
      go("#/");
    });
  }

  /* ---------- router ---------- */
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } current = null; }

  async function route() {
    stopPoll();
    renderNav();
    const [path, qs] = location.hash.slice(1).split("?");
    const p = new URLSearchParams(qs || "");
    try {
      if (!path || path === "/") await home(p);
      else if (path.startsWith("/item/")) await detail(path.split("/")[2]);
      else if (path === "/new") newItem(p);
      else if (path === "/mine") await mine();
      else if (path === "/login") authPage("login");
      else if (path === "/register") authPage("register");
      else show(`<div class="wrap">${emptyState("🧭", "Page not found", "That page does not exist.", `<a class="btn btn-solid" href="#/">Back to the board</a>`)}</div>`);
    } catch (e) {
      show(`<div class="wrap">${emptyState("😕", "Something went wrong", esc(e.error || "Please try again."), `<a class="btn btn-solid" href="#/">Back to the board</a>`)}</div>`);
    }
    if (notice) { toast(notice.text, notice.kind); notice = null; }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  route();
})();
