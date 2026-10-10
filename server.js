#!/usr/bin/env node
// Dalal Desk — local market dashboard server. Zero dependencies, Node 18+.
// Run: node server.js   then open http://localhost:8787
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Load .env if present (KEY=VALUE lines), without overriding real env vars.
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

/* ---------------- small cache ---------------- */
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (hit && hit.p) return hit.p;
  const p = fn().then(v => { cache.set(key, { t: Date.now(), v }); return v; })
               .catch(e => { if (hit && hit.v !== undefined) { cache.set(key, hit); return hit.v; } cache.delete(key); throw e; });
  cache.set(key, { ...(hit || {}), p });
  return p;
}

async function getJSON(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429) { last = new Error("rate limited by Yahoo (429)"); await sleep(600 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; }
  }
  throw last;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Yahoo Finance quotes ---------------- */
async function quote(sym) {
  return cached("q:" + sym, 20_000, async () => {
    const enc = encodeURIComponent(sym);
    let j;
    try { j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=1d&interval=5m&includePrePost=false`); }
    catch { j = await getJSON(`https://query2.finance.yahoo.com/v8/finance/chart/${enc}?range=1d&interval=5m&includePrePost=false`); }
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error(j?.chart?.error?.description || "no data");
    const m = res.meta || {};
    const closes = res.indicators?.quote?.[0]?.close || [];
    const ts = res.timestamp || [];
    const spark = [];
    for (let i = 0; i < ts.length; i++) if (closes[i] != null) spark.push([ts[i] * 1000, round(closes[i])]);
    const price = m.regularMarketPrice ?? (spark.length ? spark[spark.length - 1][1] : null);
    const prev = m.previousClose ?? m.chartPreviousClose ?? null;
    const change = price != null && prev != null ? price - prev : null;
    return {
      symbol: sym, name: m.shortName || m.longName || sym, price: round(price), prev: round(prev),
      change: round(change), pct: change != null && prev ? round((change / prev) * 100) : null,
      dayLow: round(m.regularMarketDayLow), dayHigh: round(m.regularMarketDayHigh),
      yLow: round(m.fiftyTwoWeekLow), yHigh: round(m.fiftyTwoWeekHigh),
      ccy: m.currency || null, exchange: m.fullExchangeName || m.exchangeName || null,
      time: m.regularMarketTime ? m.regularMarketTime * 1000 : null, tz: m.exchangeTimezoneName || null,
      spark: thin(spark, 80),
    };
  });
}
const round = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
function thin(a, n) { if (a.length <= n) return a; const s = a.length / n; const o = []; for (let i = 0; i < n; i++) o.push(a[Math.floor(i * s)]); o.push(a[a.length - 1]); return o; }

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { symbol: items[k], error: String(e.message || e) }; } }
  }));
  return out;
}

async function movers(listName, n) {
  const list = CONFIG.lists[listName];
  if (!list) throw new Error("unknown list " + listName);
  return cached(`mv:${listName}`, 60_000, async () => {
    const qs = (await pool(list.symbols, 8, quote)).filter(q => q && q.pct != null);
    qs.sort((a, b) => b.pct - a.pct);
    const slim = q => ({ symbol: q.symbol, name: q.name, price: q.price, change: q.change, pct: q.pct, ccy: q.ccy });
    const adv = qs.filter(q => q.pct > 0).length, dec = qs.filter(q => q.pct < 0).length;
    return { list: list.name, count: qs.length, advances: adv, declines: dec, unchanged: qs.length - adv - dec,
      gainers: qs.slice(0, 15).map(slim), losers: qs.slice(-15).reverse().map(slim), at: Date.now() };
  }).then(r => ({ ...r, gainers: r.gainers.slice(0, n), losers: r.losers.slice(0, n) }));
}

async function search(q) {
  return cached("s:" + q, 300_000, async () => {
    const j = await getJSON(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
    return (j.quotes || []).filter(x => x.symbol).map(x => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange, type: x.quoteType }));
  });
}

/* ---------------- RSS news ---------------- */
async function news(url, n) {
  if (!/^https?:\/\//i.test(url)) throw new Error("feed URL must start with http(s)://");
  return cached("n:" + url, 300_000, async () => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = await r.text();
    const items = [];
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    for (const b of blocks) {
      const g = tag => { const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? decode(m[1]) : ""; };
      let link = g("link"); if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ""; }
      const when = Date.parse(g("pubDate") || g("published") || g("updated") || g("dc:date")) || null;
      items.push({ title: g("title"), link, time: when });
    }
    const t = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { source: t ? decode(t[1]) : url, items: items.filter(i => i.title) };
  }).then(r => ({ ...r, items: r.items.slice(0, n) }));
}
function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).trim();
}

/* ---------------- Claude (optional) ---------------- */
async function claude(system, messages, max = 900) {
  const key = process.env.ANTHROPIC_API_KEY || ANTHROPIC_KEY;
  if (!key) { const e = new Error("Set ANTHROPIC_API_KEY to enable Claude features"); e.status = 501; throw e; }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || CLAUDE_MODEL, max_tokens: max, system, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Claude API HTTP ${r.status}`);
  return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
}

/* ---------------- layout persistence ---------------- */
const LAYOUT = path.join(DATA, "layout.json");
function readLayout() { try { return JSON.parse(fs.readFileSync(LAYOUT, "utf8")); } catch { return null; } }
function writeLayout(obj) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(LAYOUT, JSON.stringify(obj, null, 2)); }

/* ---------------- HTTP ---------------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, bad) => { let s = ""; req.on("data", c => { s += c; if (s.length > 1e6) { bad(new Error("too large")); req.destroy(); } }); req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } }); });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = u.pathname;
  try {
    if (p === "/api/config") return send(res, 200, { claude: !!(process.env.ANTHROPIC_API_KEY || ANTHROPIC_KEY), lists: Object.fromEntries(Object.entries(CONFIG.lists).map(([k, v]) => [k, v.name])), feeds: CONFIG.feeds });
    if (p === "/api/quotes") {
      const syms = (u.searchParams.get("symbols") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 80);
      return send(res, 200, { at: Date.now(), quotes: await pool(syms, 8, quote) });
    }
    if (p === "/api/movers") return send(res, 200, await movers(u.searchParams.get("list") || "nifty50", Math.min(15, +u.searchParams.get("n") || 5)));
    if (p === "/api/search") return send(res, 200, await search(u.searchParams.get("q") || ""));
    if (p === "/api/news") return send(res, 200, await news(u.searchParams.get("url") || "", Math.min(30, +u.searchParams.get("n") || 8)));
    if (p === "/api/layout" && req.method === "GET") return send(res, 200, readLayout() || {});
    if (p === "/api/layout" && req.method === "PUT") { writeLayout(await readBody(req)); return send(res, 200, { ok: true }); }
    if (p === "/api/claude" && req.method === "POST") {
      const b = await readBody(req);
      const msgs = (b.messages || []).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-20);
      if (!msgs.length) return send(res, 400, { error: "no messages" });
      return send(res, 200, { text: await claude(String(b.system || ""), msgs, Math.min(2000, +b.max || 900)) });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    // static
    const f = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : decodeURIComponent(p)));
    if (!f.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
    fs.readFile(f, (err, buf) => err ? send(res, 404, "not found", "text/plain") : send(res, 200, buf, TYPES[path.extname(f)] || "application/octet-stream"));
  } catch (e) {
    send(res, e.status || 502, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Dalal Desk running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  Claude features: ${process.env.ANTHROPIC_API_KEY ? "on" : "off (set ANTHROPIC_API_KEY to enable)"}\n`);
});
