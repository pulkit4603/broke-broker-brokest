(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const nf = (v, d = 2) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const api = async (p, o) => { const r = await fetch(p, o); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status }); return j; };

/* ---------- presets ---------- */
const PRESETS = {
  in_idx: { type: "quotes", title: "Indian indices", size: "l", symbols: [["^BSESN", "SENSEX"], ["^NSEI", "NIFTY 50"], ["^NSEBANK", "NIFTY BANK"], ["^CNXIT", "NIFTY IT"], ["^INDIAVIX", "INDIA VIX"]] },
  cmdty: { type: "quotes", title: "Commodities", size: "m", symbols: [["CL=F", "Crude oil (WTI)"], ["BZ=F", "Brent crude"], ["GC=F", "Gold"], ["SI=F", "Silver"], ["NG=F", "Natural gas"]] },
  fx: { type: "quotes", title: "Currencies & crypto", size: "s", symbols: [["INR=X", "USD / INR"], ["EURINR=X", "EUR / INR"], ["GBPINR=X", "GBP / INR"], ["BTC-INR", "Bitcoin (INR)"]] },
  glob: { type: "quotes", title: "Global markets", size: "m", symbols: [["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^DJI", "Dow Jones"], ["^N225", "Nikkei 225"], ["^FTSE", "FTSE 100"], ["^HSI", "Hang Seng"]] },
  watch: { type: "quotes", title: "My watchlist", size: "m", symbols: [["RELIANCE.NS", "Reliance"], ["HDFCBANK.NS", "HDFC Bank"], ["TCS.NS", "TCS"], ["INFY.NS", "Infosys"]] },
  movers: { type: "movers", title: "NIFTY 50 movers", size: "m", list: "nifty50", n: 5 },
  movers_us: { type: "movers", title: "US mega-cap movers", size: "m", list: "us_megacap", n: 5 },
  news: { type: "news", title: "Market headlines", size: "m", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", n: 8 },
  term: { type: "term", title: "Term of the day", size: "s" },
  explain: { type: "explain", title: "What moved today", size: "m" },
  ask: { type: "ask", title: "Ask about markets", size: "m" },
  clock: { type: "clock", title: "Market sessions", size: "m" },
};
const CATALOG = [
  ["Price boards", [["in_idx", "Indian indices", "SENSEX, NIFTY 50, Bank, IT, VIX"], ["cmdty", "Commodities", "Crude, Brent, gold, silver, gas"], ["fx", "Currencies & crypto", "USD/INR, EUR/INR, Bitcoin"], ["glob", "Global markets", "US, Japan, UK, Hong Kong"], ["watch", "Watchlist", "Search and add any stock, ETF, index or future"]]],
  ["Market internals", [["movers", "Top gainers & losers (NIFTY 50)", "Top N movers plus advance/decline breadth"], ["movers_us", "Top movers (US mega caps)", "Same, for the largest US stocks"], ["news", "Headlines", "Any RSS feed: ET, Moneycontrol, Mint, CNBC"]]],
  ["Learn", [["term", "Term of the day", "One concept a day with an Indian example"], ["explain", "What moved today", "Claude explains the moves on your boards (needs API key)"], ["ask", "Ask about markets", "Ask Claude how anything works (needs API key)"], ["clock", "Market sessions", "NSE, NYSE, LSE and Tokyo hours"]]],
];
function fromPreset(k) { const p = JSON.parse(JSON.stringify(PRESETS[k])); p.id = uid(); if (p.symbols) p.symbols = p.symbols.map(([sym, label]) => ({ sym, label })); return p; }
const DEFAULT_LAYOUT = () => ({ v: 2, live: true, widgets: ["in_idx", "clock", "cmdty", "fx", "movers", "term", "glob", "watch", "news", "explain", "ask"].map(fromPreset) });

/* ---------- state ---------- */
let layout = DEFAULT_LAYOUT();
const data = { quotes: {}, movers: {}, news: {} };
let cfg = { claude: false, lists: {}, feeds: [] };
let editing = false, busy = false, lastOk = 0, lastErr = "";
const LS = "dalal-desk-local-v2";
try { const s = JSON.parse(localStorage.getItem(LS) || "null"); if (s && s.widgets) layout = s; } catch {}
let saveT;
function persist() {
  try { localStorage.setItem(LS, JSON.stringify(layout)); } catch {}
  clearTimeout(saveT); saveT = setTimeout(() => api("/api/layout", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(layout) }).catch(() => {}), 800);
}

/* ---------- theme ---------- */
const THEME = "dalal-desk-theme";
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
try { applyTheme(localStorage.getItem(THEME)); } catch {}
$("#theme").onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const t = dark ? "light" : "dark"; applyTheme(t); try { localStorage.setItem(THEME, t); } catch {}
};

/* ---------- sessions ---------- */
const MKTS = [
  { nm: "NSE / BSE", tz: "Asia/Kolkata", pre: [540, 555], open: [555, 930] },
  { nm: "NYSE / Nasdaq", tz: "America/New_York", pre: [240, 570], open: [570, 960] },
  { nm: "London (LSE)", tz: "Europe/London", pre: [470, 480], open: [480, 990] },
  { nm: "Tokyo (TSE)", tz: "Asia/Tokyo", pre: [480, 540], open: [540, 930] },
];
function tzParts(tz) { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); const g = t => p.find(x => x.type === t)?.value; return { wd: g("weekday"), t: +g("hour") * 60 + +g("minute") }; }
function mktState(m) { const { wd, t } = tzParts(m.tz); if (wd === "Sat" || wd === "Sun") return "closed"; if (t >= m.open[0] && t < m.open[1]) return "open"; if (t >= m.pre[0] && t < m.pre[1]) return "pre"; return "closed"; }
const LBL = { open: "Open", pre: "Pre-open", closed: "Closed" };
const hm = x => Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0");
const istTime = () => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
function renderSessions() {
  $("#today").textContent = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date()) + " IST";
  $("#sessions").innerHTML = MKTS.slice(0, 3).map(m => { const s = mktState(m); return `<div class="sess ${s}"><span class="dot"></span><b>${m.nm}</b><span class="t">${LBL[s]}</span></div>`; }).join("");
  document.querySelectorAll("[data-clock]").forEach(el => el.innerHTML = clockHTML());
}
function clockHTML() {
  return `<div class="clk">${MKTS.map(m => { const s = mktState(m); const t = new Intl.DateTimeFormat("en-IN", { timeZone: m.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    return `<div class="ck ${s}"><div class="nm">${m.nm}</div><div class="tm">${t}</div><div class="st">${LBL[s]} · ${hm(m.open[0])}–${hm(m.open[1])} local</div></div>`; }).join("")}</div>
  <p class="wf" style="padding:10px 0 0">NSE equity: pre-open 9:00–9:15, normal session 9:15–15:30 IST, Monday to Friday.</p>`;
}

/* ---------- render helpers ---------- */
const dir = v => v > 0 ? "up" : v < 0 ? "down" : "flat";
function rangeBar(l, lo, hi, v) { if (lo == null || hi == null || v == null || hi <= lo) return ""; const p = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  return `<div class="rr" title="${l}: ${nf(lo)} to ${nf(hi)}"><span>${l}</span><div class="bar"><i style="left:calc(${p.toFixed(1)}% - 1.5px)"></i></div><div class="ends"><span>${nf(lo)}</span><span>${nf(hi)}</span></div></div>`; }
function spark(h, d, prev) {
  if (!h || h.length < 2) return ""; const ys = h.map(x => x[1]); if (prev != null) ys.push(prev);
  const mn = Math.min(...ys), mx = Math.max(...ys), W = 200, H = 30, r = mx - mn || 1, Y = v => H - 3 - (v - mn) / r * (H - 6);
  const pts = h.map((x, i) => [i / (h.length - 1) * W, Y(x[1])]); const line = pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ");
  const col = d === "down" ? "var(--down)" : d === "up" ? "var(--up)" : "var(--muted)"; const last = pts[pts.length - 1];
  const base = prev != null ? `<line x1="0" x2="${W}" y1="${Y(prev).toFixed(1)}" y2="${Y(prev).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".6"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Today's intraday price">${base}<polygon points="0,${H} ${line} ${W},${H}" fill="${col}" fill-opacity=".12"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="${col}"/></svg>`;
}
function ago(t) { if (!t) return ""; const s = (Date.now() - t) / 1000; if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }
const qtime = t => t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST" : "";
const signed = v => (v > 0 ? "+" : "") + nf(v);

function quotesBody(w) {
  let h = "";
  if (editing) h += `<div class="form"><div class="sr"><input class="in" id="srch-${w.id}" data-search="${w.id}" placeholder="Search a stock, index, ETF, future… e.g. Infosys, ^NSEI, GOLDBEES" autocomplete="off"><div class="sres" id="sres-${w.id}" hidden></div></div><span class="wf" style="padding:0">Yahoo symbols: NSE stocks end in .NS, BSE in .BO, futures in =F, FX pairs in =X.</span></div>`;
  if (!w.symbols.length) return h + `<p class="empty">No symbols yet. Turn on Customize to add some.</p>`;
  return h + `<div class="qgrid">` + w.symbols.map((s, i) => {
    const q = data.quotes[s.sym];
    const x = `<button class="ib danger x" data-rmsym="${w.id}:${i}" aria-label="Remove ${esc(s.label)}">✕</button>`;
    if (!q || q.price == null) return `<div class="q err">${x}<div class="lab"><span>${esc(s.label)}</span><span>${esc(s.sym)}</span></div><div class="px num">${q && q.error ? "Unavailable" : "Loading…"}</div><div class="asof">${q && q.error ? esc(q.error) : ""}</div></div>`;
    const d = dir(q.change);
    return `<div class="q ${d}" title="${esc(q.name)} · ${esc(q.exchange || "")}">${x}<div class="lab"><span>${esc(s.label)}</span><span>${esc(q.ccy || "")}</span></div>
      <div class="px num">${nf(q.price)}</div>
      <div class="chg num"><span class="abs">${signed(q.change)}</span><span class="pill">${signed(q.pct)}%</span></div>
      ${spark(q.spark, d, q.prev)}
      <div class="rng">${rangeBar("Day", q.dayLow, q.dayHigh, q.price)}${rangeBar("52w", q.yLow, q.yHigh, q.price)}</div>
      <div class="asof">${qtime(q.time)}</div></div>`;
  }).join("") + `</div>`;
}
function moversTable(rows, ccy) {
  if (!rows || !rows.length) return `<p class="empty">No data.</p>`;
  return `<div class="tbl"><table><thead><tr><th>Stock</th><th class="n">Price</th><th class="n">Change</th></tr></thead><tbody>${rows.map(r => `<tr><td title="${esc(r.name)}">${esc(r.symbol.replace(/\.(NS|BO)$/, ""))}</td><td class="n">${nf(r.price)}</td><td class="n ${r.pct > 0 ? "pos" : r.pct < 0 ? "neg" : ""}">${signed(r.pct)}%</td></tr>`).join("")}</tbody></table></div>`;
}
function moversBody(w) {
  let h = "";
  if (editing) h += `<form class="form" data-mvcfg="${w.id}"><div class="row"><label class="f" style="flex:1">List<select class="in" name="list" id="mvl-${w.id}">${Object.entries(cfg.lists).map(([k, v]) => `<option value="${k}" ${k === w.list ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label><label class="f" style="width:90px">How many<input class="in" type="number" min="1" max="15" name="n" id="mvn-${w.id}" value="${w.n}"></label></div><div class="row"><button class="btn" type="submit">Apply</button><span class="wf" style="padding:0;align-self:center">Edit lists in config.json.</span></div></form>`;
  const m = data.movers[w.id];
  if (!m) return h + `<p class="empty">Loading movers…</p>`;
  if (m.error) return h + `<p class="empty">Couldn't load movers: ${esc(m.error)}</p>`;
  const t = m.count || 1;
  return h + `<div class="breadth" title="Advances ${m.advances}, declines ${m.declines}"><i style="width:${m.advances / t * 100}%;background:var(--up)"></i><i style="width:${m.unchanged / t * 100}%;background:var(--muted)"></i><i style="width:${m.declines / t * 100}%;background:var(--down)"></i></div>
    <div class="bl"><span>${m.advances} advancing</span><span>${m.list} breadth</span><span>${m.declines} declining</span></div>
    <div class="two"><div><h5>Top ${w.n} gainers</h5>${moversTable(m.gainers)}</div><div><h5>Top ${w.n} losers</h5>${moversTable(m.losers)}</div></div>`;
}
function newsBody(w) {
  let h = "";
  if (editing) h += `<form class="form" data-newscfg="${w.id}"><label class="f">Feed<select class="in" name="pick" id="nfp-${w.id}"><option value="">Custom URL…</option>${cfg.feeds.map(f => `<option value="${esc(f.url)}" ${f.url === w.url ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label><label class="f">RSS URL<input class="in" name="url" id="nfu-${w.id}" value="${esc(w.url)}"></label><div class="row"><label class="f" style="width:90px">Items<input class="in" type="number" min="3" max="30" name="n" id="nfn-${w.id}" value="${w.n}"></label><label class="f" style="flex:1">Title<input class="in" name="title" id="nft-${w.id}" value="${esc(w.title)}"></label></div><div class="row"><button class="btn" type="submit">Apply</button></div></form>`;
  const n = data.news[w.id];
  if (!n) return h + `<p class="empty">Loading headlines…</p>`;
  if (n.error) return h + `<p class="empty">Couldn't load this feed: ${esc(n.error)}</p>`;
  return h + `<ul class="news">${n.items.map(i => `<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a>${i.time ? `<time>${ago(i.time)}</time>` : ""}</li>`).join("")}</ul><p class="wf" style="padding:6px 0 0">${esc(n.source)}</p>`;
}
let termIdx = null;
function termBody() {
  const G = window.GLOSSARY || []; if (!G.length) return `<p class="empty">No glossary loaded.</p>`;
  if (termIdx == null) { const d = new Date(); termIdx = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5) % G.length; }
  const t = G[termIdx];
  return `<div class="term"><h3>${esc(t.term)}</h3><p class="short">${esc(t.short)}</p><div class="prose"><p>${esc(t.explain)}</p>${t.example ? `<p><b>In India:</b> ${esc(t.example)}</p>` : ""}</div>
    <div class="chips">${(t.related || []).map(r => `<button class="chip" data-related="${esc(r)}">${esc(r)}</button>`).join("")}</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-term="prev">Previous</button><button class="btn" data-term="next">Next term</button></div></div>`;
}
const NO_KEY = `<p class="empty">This needs Claude. Add <code>ANTHROPIC_API_KEY</code> to a <code>.env</code> file next to server.js and restart.</p>`;
let explainText = "";
function explainBody() {
  if (!cfg.claude) return NO_KEY;
  const n = Object.values(data.quotes).filter(q => q.price != null).length;
  return `${explainText ? `<div class="prose">${explainText.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join("")}</div>` : `<p class="empty">Claude reads the ${n} prices and movers on your desk and explains what moved and how the pieces connect: crude and the rupee, US tech and Indian IT, VIX and fear.</p>`}
    <div class="row"><button class="btn" data-explain="1" ${n ? "" : "disabled"}>${explainText ? "Explain again" : "Explain today's moves"}</button></div>`;
}
const chats = {};
function askBody(w) {
  if (!cfg.claude) return NO_KEY;
  const c = chats[w.id] || [];
  return `<div class="chat" id="chat-${w.id}">${c.length ? c.map(m => `<div class="msg ${m.role === "user" ? "u" : "a"}">${esc(m.content)}</div>`).join("") : `<p class="empty">Ask anything about how markets work. Try one of these:</p><div class="chips">${["What is a P/E ratio and what's normal for NIFTY?", "Why does crude oil affect the rupee?", "How do F&O expiries move the market?", "What are FII and DII flows?"].map(q => `<button class="chip" data-q="${w.id}" data-text="${esc(q)}">${esc(q)}</button>`).join("")}</div>`}</div>
    <form class="row" data-ask="${w.id}"><input class="in" name="q" id="q-${w.id}" placeholder="Ask a question" autocomplete="off" required><button class="btn primary" type="submit">Ask</button></form>`;
}
const KIND = { quotes: "Prices", movers: "Movers", news: "News", term: "Learn", explain: "Learn", ask: "Learn", clock: "Sessions" };
function body(w) { return { quotes: quotesBody, movers: moversBody, news: newsBody, term: termBody, explain: explainBody, ask: askBody, clock: () => `<div data-clock>${clockHTML()}</div>` }[w.type]?.(w) || ""; }

function render() {
  const focus = document.activeElement?.id, val = focus && document.activeElement.value;
  document.body.classList.toggle("editing", editing);
  $("#edit").textContent = editing ? "Done" : "Customize";
  $("#grid").innerHTML = layout.widgets.length ? layout.widgets.map((w, i) => `<section class="w ${w.size}" data-w="${w.id}"><div class="wh"><h2>${esc(w.title)}</h2><span class="kind">${KIND[w.type] || ""}</span>
      <div class="tools"><button class="ib" data-mv="${i}:-1" aria-label="Move up">↑</button><button class="ib" data-mv="${i}:1" aria-label="Move down">↓</button><button class="ib" data-sz="${i}" aria-label="Change size">${w.size.toUpperCase()}</button><button class="ib" data-ren="${i}" aria-label="Rename">Rename</button><button class="ib danger" data-rm="${i}">Remove</button></div></div><div class="wb">${body(w)}</div></section>`).join("")
    : `<div class="w l"><div class="wb"><p class="empty">Your desk is empty. Add a widget to start.</p></div></div>`;
  renderTape();
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (val != null && "value" in el) el.value = val; } }
}
function updateQuotesOnly() {
  // Re-render only price widgets so typing elsewhere isn't interrupted.
  layout.widgets.forEach(w => { if (w.type === "quotes" || w.type === "movers") { const el = document.querySelector(`[data-w="${w.id}"] .wb`); if (el && !el.contains(document.activeElement)) el.innerHTML = body(w); } });
  renderTape();
}
function renderTape() {
  const seen = new Set(), items = [];
  layout.widgets.filter(w => w.type === "quotes").forEach(w => w.symbols.forEach(s => { const q = data.quotes[s.sym]; if (q && q.price != null && !seen.has(s.sym)) { seen.add(s.sym); items.push(`<span class="tk ${dir(q.pct)}"><span class="n">${esc(s.label)}</span><span class="num">${nf(q.price)}</span><span class="num abs">${q.pct > 0 ? "▲" : q.pct < 0 ? "▼" : ""} ${nf(Math.abs(q.pct))}%</span></span>`); } }));
  $("#tape").hidden = items.length < 3; if (items.length >= 3) $("#tapeIn").innerHTML = items.join("") + items.join("");
}
function setStatus() {
  const el = $("#status");
  el.className = "status" + (Date.now() - lastOk > 120e3 ? " stale" : "");
  el.innerHTML = lastOk ? `<span class="livedot"></span>Prices updated ${new Date(lastOk).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST${layout.live ? " · live" : ""}${lastErr ? ` · ${esc(lastErr)}` : ""}` : (lastErr ? esc(lastErr) : "Loading prices…");
}
function banner(html) { const b = $("#banner"); b.hidden = !html; if (html) b.innerHTML = html; }

/* ---------- data loading ---------- */
async function loadQuotes() {
  const syms = [...new Set(layout.widgets.filter(w => w.type === "quotes").flatMap(w => w.symbols.map(s => s.sym)))];
  if (!syms.length) return;
  const r = await api("/api/quotes?symbols=" + syms.map(encodeURIComponent).join(","));
  let ok = 0;
  for (const q of r.quotes) { if (!q) continue; if (q.error) { data.quotes[q.symbol] = data.quotes[q.symbol]?.price != null ? data.quotes[q.symbol] : q; } else { data.quotes[q.symbol] = q; ok++; } }
  if (!ok && syms.length) throw new Error(r.quotes[0]?.error || "no prices returned");
}
async function loadMovers() {
  await Promise.all(layout.widgets.filter(w => w.type === "movers").map(async w => {
    try { data.movers[w.id] = await api(`/api/movers?list=${encodeURIComponent(w.list)}&n=${w.n}`); } catch (e) { data.movers[w.id] = data.movers[w.id]?.gainers ? data.movers[w.id] : { error: e.message }; }
  }));
}
async function loadNews(force) {
  await Promise.all(layout.widgets.filter(w => w.type === "news" && w.url).map(async w => {
    if (!force && data.news[w.id] && Date.now() - (data.news[w.id].at || 0) < 300e3) return;
    try { data.news[w.id] = { ...(await api(`/api/news?url=${encodeURIComponent(w.url)}&n=${w.n}`)), at: Date.now() }; } catch (e) { data.news[w.id] = { error: e.message, at: Date.now() }; }
  }));
}
let tick = 0;
async function refresh(full) {
  if (busy) return; busy = true; $("#refresh").disabled = true;
  try {
    await loadQuotes(); lastOk = Date.now(); lastErr = ""; banner("");
  } catch (e) {
    lastErr = "Couldn't reach Yahoo Finance: " + e.message;
    if (!lastOk) banner(`<div><b>No prices yet.</b> The server couldn't fetch from Yahoo Finance (${esc(e.message)}). Check your internet connection or proxy, then press Refresh.</div>`);
  }
  if (full || tick % 2 === 0) await loadMovers();
  if (full || tick % 10 === 0) await loadNews(full);
  tick++; busy = false; $("#refresh").disabled = false;
  if (full) render(); else { updateQuotesOnly(); layout.widgets.filter(w => w.type === "news").forEach(w => { const el = document.querySelector(`[data-w="${w.id}"] .wb`); if (el && !el.contains(document.activeElement)) el.innerHTML = body(w); }); }
  setStatus();
}

/* ---------- Claude ---------- */
const SYS = "You are a patient markets teacher for an Indian learner. Explain plainly, use Indian context (₹, NSE/BSE, SEBI, RBI) where it helps, and never give buy/sell recommendations or personal investment advice.";
async function explain(btn) {
  btn.disabled = true; btn.textContent = "Thinking…";
  const rows = []; const seen = new Set();
  layout.widgets.filter(w => w.type === "quotes").forEach(w => w.symbols.forEach(s => { const q = data.quotes[s.sym]; if (q && q.price != null && !seen.has(s.sym)) { seen.add(s.sym); rows.push(`${s.label}: ${q.price} ${q.ccy || ""} (${signed(q.pct)}%), day ${q.dayLow}–${q.dayHigh}, 52w ${q.yLow}–${q.yHigh}`); } }));
  const mv = layout.widgets.filter(w => w.type === "movers" && data.movers[w.id]?.gainers).map(w => { const m = data.movers[w.id]; return `${m.list}: ${m.advances} up / ${m.declines} down. Gainers: ${m.gainers.map(g => `${g.symbol} ${signed(g.pct)}%`).join(", ")}. Losers: ${m.losers.map(g => `${g.symbol} ${signed(g.pct)}%`).join(", ")}`; });
  const hl = layout.widgets.filter(w => w.type === "news" && data.news[w.id]?.items).flatMap(w => data.news[w.id].items.slice(0, 6).map(i => "- " + i.title));
  try {
    const r = await api("/api/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: SYS, max: 900, messages: [{ role: "user", content: `Snapshot of my dashboard at ${istTime()} IST:\n${rows.join("\n")}\n\n${mv.join("\n")}\n\nRecent headlines:\n${hl.join("\n") || "(none)"}\n\nIn 3–4 short paragraphs, no headings or bullets: say what moved most, connect related moves (crude and the rupee, US tech and Indian IT, VIX and risk appetite, breadth vs index), point out anything near a 52-week high or low, and end with one concept worth learning from today. Present causes as possibilities unless the headlines support them.` }] }) });
    explainText = r.text;
  } catch (e) { explainText = "Couldn't write an explanation: " + e.message; }
  render();
}
async function ask(wid, q) {
  const c = chats[wid] = chats[wid] || []; c.push({ role: "user", content: q }, { role: "assistant", content: "…" }); render();
  try { const r = await api("/api/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: SYS + " Keep answers under 200 words unless asked for more.", messages: c.slice(0, -1) }) }); c[c.length - 1].content = r.text; }
  catch (e) { c[c.length - 1].content = "Couldn't answer: " + e.message; }
  render(); const el = $(`#chat-${wid}`); if (el) el.scrollTop = el.scrollHeight; $(`#q-${wid}`)?.focus();
}

/* ---------- symbol search ---------- */
let sT;
document.addEventListener("input", e => {
  const id = e.target.dataset.search; if (!id) return;
  const q = e.target.value.trim(), box = $(`#sres-${id}`); clearTimeout(sT);
  if (q.length < 2) { box.hidden = true; return; }
  sT = setTimeout(async () => {
    let res = []; try { res = await api("/api/search?q=" + encodeURIComponent(q)); } catch {}
    const direct = `<button data-pick="${id}" data-sym="${esc(q.toUpperCase())}" data-label="${esc(q.toUpperCase())}"><span>Add “${esc(q.toUpperCase())}” as typed</span><small>exact symbol</small></button>`;
    box.innerHTML = res.map(r => `<button data-pick="${id}" data-sym="${esc(r.symbol)}" data-label="${esc(r.name)}"><span><b>${esc(r.symbol)}</b> ${esc(r.name)}</span><small>${esc(r.exchange || "")} ${esc(r.type || "")}</small></button>`).join("") + direct;
    box.hidden = false;
  }, 250);
});

/* ---------- drawer ---------- */
function openDrawer() {
  $("#panel").innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h2>Add a widget</h2><button class="btn ghost" data-close>Close</button></div><p class="wf" style="padding:0">New widgets go to the top. Use Customize to move, resize, rename or edit them.</p>` +
    CATALOG.map(([g, items]) => `<h4>${g}</h4><div class="cat">${items.map(([k, t, d]) => `<button class="ci" data-preset="${k}"><b>${t}</b><span>${d}</span></button>`).join("")}</div>`).join("") +
    `<h4>Layout</h4><div class="row"><button class="btn" data-export>Copy layout JSON</button><button class="btn" data-reset>Reset to default</button></div><textarea class="in" id="layoutJson" style="margin-top:8px" placeholder="Paste layout JSON here to import"></textarea><button class="btn" data-import style="margin-top:6px">Import</button>`;
  $("#drawer").hidden = false; $("#panel").querySelector("button").focus();
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) { document.querySelectorAll(".sres").forEach(b => { if (!b.parentElement.contains(e.target)) b.hidden = true; }); return; }
  const d = t.dataset;
  if (t.id === "refresh") return refresh(true);
  if (t.id === "add") return openDrawer();
  if (t.id === "edit") { editing = !editing; render(); return; }
  if (d.close !== undefined) { $("#drawer").hidden = true; return; }
  if (d.preset) { const w = fromPreset(d.preset); layout.widgets.unshift(w); $("#drawer").hidden = true; persist(); render(); refresh(true); return; }
  if (d.export !== undefined) { const s = JSON.stringify(layout); $("#layoutJson").value = s; navigator.clipboard?.writeText(s).then(() => t.textContent = "Copied", () => {}); return; }
  if (d.reset !== undefined) { if (t.dataset.armed) { layout = DEFAULT_LAYOUT(); persist(); $("#drawer").hidden = true; render(); refresh(true); } else { t.dataset.armed = 1; t.textContent = "Click again to reset"; } return; }
  if (d.import !== undefined) { try { const L = JSON.parse($("#layoutJson").value); if (!Array.isArray(L.widgets)) throw 0; layout = L; persist(); $("#drawer").hidden = true; render(); refresh(true); } catch { t.textContent = "Not valid layout JSON"; } return; }
  if (d.mv) { const [i, dl] = d.mv.split(":").map(Number), j = i + dl; if (j < 0 || j >= layout.widgets.length) return; const a = layout.widgets; [a[i], a[j]] = [a[j], a[i]]; persist(); render(); return; }
  if (d.sz) { const w = layout.widgets[+d.sz]; w.size = { s: "m", m: "l", l: "s" }[w.size]; persist(); render(); return; }
  if (d.ren) { const h = t.closest(".w").querySelector("h2"); const w = layout.widgets[+d.ren]; h.innerHTML = `<input class="in" id="ren-${w.id}" value="${esc(w.title)}">`; const inp = h.querySelector("input"); inp.focus(); inp.select();
    const done = () => { w.title = inp.value.trim() || w.title; persist(); render(); }; inp.onkeydown = ev => { if (ev.key === "Enter") done(); if (ev.key === "Escape") render(); }; inp.onblur = done; return; }
  if (d.rm) { if (!t.classList.contains("armed")) { t.classList.add("armed"); t.textContent = "Confirm"; setTimeout(() => { t.classList.remove("armed"); t.textContent = "Remove"; }, 3000); return; } layout.widgets.splice(+d.rm, 1); persist(); render(); return; }
  if (d.rmsym) { const [id, i] = d.rmsym.split(":"); layout.widgets.find(x => x.id === id).symbols.splice(+i, 1); persist(); render(); return; }
  if (d.pick) { const w = layout.widgets.find(x => x.id === d.pick); if (!w.symbols.some(s => s.sym === d.sym)) w.symbols.push({ sym: d.sym, label: d.label.length > 22 ? d.sym.replace(/\.(NS|BO)$/, "") : d.label }); persist(); render(); refresh(); $(`#srch-${w.id}`)?.focus(); return; }
  if (d.term) { const G = window.GLOSSARY; termIdx = (termIdx + (d.term === "next" ? 1 : G.length - 1)) % G.length; render(); return; }
  if (d.related) { const G = window.GLOSSARY, i = G.findIndex(g => g.term.toLowerCase() === d.related.toLowerCase()); if (i >= 0) { termIdx = i; render(); return; } const w = layout.widgets.find(x => x.type === "ask"); if (w && cfg.claude) { ask(w.id, `Explain "${d.related}" with an Indian market example.`); document.querySelector(`[data-w="${w.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
  if (d.explain) { explain(t); return; }
  if (d.q) { ask(d.q, d.text); return; }
});
$("#drawer").addEventListener("click", e => { if (e.target.id === "drawer") $("#drawer").hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") { $("#drawer").hidden = true; document.querySelectorAll(".sres").forEach(b => b.hidden = true); } });
document.addEventListener("change", e => { if (e.target.id?.startsWith("nfp-") && e.target.value) { const id = e.target.id.slice(4); $(`#nfu-${id}`).value = e.target.value; const opt = e.target.selectedOptions[0]; $(`#nft-${id}`).value = opt.textContent; } });
document.addEventListener("submit", e => {
  e.preventDefault(); const f = e.target, fd = new FormData(f);
  if (f.dataset.mvcfg) { const w = layout.widgets.find(x => x.id === f.dataset.mvcfg); w.list = fd.get("list"); w.n = Math.max(1, Math.min(15, +fd.get("n") || 5)); if (/movers/i.test(w.title)) w.title = `${cfg.lists[w.list] || w.list} movers`; delete data.movers[w.id]; persist(); render(); refresh(true); return; }
  if (f.dataset.newscfg) { const w = layout.widgets.find(x => x.id === f.dataset.newscfg); w.url = String(fd.get("url")).trim(); w.n = Math.max(3, Math.min(30, +fd.get("n") || 8)); w.title = String(fd.get("title")).trim() || "Headlines"; delete data.news[w.id]; persist(); render(); loadNews(true).then(render); return; }
  if (f.dataset.ask) { const q = String(fd.get("q")).trim(); if (q) ask(f.dataset.ask, q); }
});
$("#live").addEventListener("change", e => { layout.live = e.target.checked; persist(); setStatus(); });

/* ---------- boot ---------- */
(async () => {
  try { cfg = await api("/api/config"); } catch {}
  try { const L = await api("/api/layout"); if (L && Array.isArray(L.widgets)) layout = L; } catch {}
  $("#live").checked = layout.live !== false;
  renderSessions(); render(); setStatus();
  await refresh(true);
  setInterval(() => { renderSessions(); setStatus(); }, 15e3);
  setInterval(() => { if (layout.live !== false && document.visibilityState === "visible") refresh(); }, 30e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastOk > 30e3) refresh(); });
})();
})();
