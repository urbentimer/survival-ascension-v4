// Game log: what happened, where and when. Every entry is
//  1) kept in memory (last 1500, since the server started) for the /logs page, and
//  2) printed as one "[log] {...}" line, so Render keeps it in its log search even after a restart.
// Levels: "error" (something broke), "warn" (odd but handled), "info" (normal game events).
const MAX = 1500;
const entries = [];
let seq = 0;
export const startedAt = Date.now();
const NODE = typeof process !== "undefined" && !!process.versions?.node;   // the solo preview runs this file in the browser
const QUIET = !NODE || (typeof process !== "undefined" && process.env.SA_QUIET === "1");   // tests: no console spam
export const commit = ((NODE && process.env.RENDER_GIT_COMMIT) || "local").slice(0, 7);

export function log(level, kind, msg, ctx = {}) {
  const e = { id: ++seq, t: Date.now(), level, kind, msg: String(msg ?? "").slice(0, 1200) };
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined && v !== null && v !== "") e[k] = typeof v === "string" ? v.slice(0, 200) : v;
  entries.push(e); if (entries.length > MAX) entries.shift();
  if (!QUIET) console.log("[log] " + JSON.stringify(e));
  return e;
}
export function recent(after = 0) { return entries.filter(e => e.id > after); }

// Crashes outside a room (should never happen, but if it does we want the stack).
if (NODE) {
  process.on("uncaughtException", e => log("error", "server-crash", e?.stack || e));
  process.on("unhandledRejection", e => log("error", "server-promise", e?.stack || e));
}

// ---------- the /logs page (needs ?key=LOG_KEY; the key is an environment variable on Render) ----------
export function handleLogsRequest(req, res) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/logs")) return false;
  const key = process.env.LOG_KEY;
  if (!key || url.searchParams.get("key") !== key) { res.writeHead(403, { "content-type": "text/plain" }); res.end("Logs: wrong or missing key."); return true; }
  if (url.pathname === "/logs.json") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ startedAt, commit, now: Date.now(), entries: recent(Number(url.searchParams.get("after")) || 0) }));
    return true;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
  return true;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Survival Ascension Logs</title>
<style>
:root{color-scheme:dark;--bg:#0f1417;--panel:#172024;--line:#26343a;--fg:#e4ebe8;--muted:#8a9ba1;--err:#ff6b5e;--warn:#f2c14e;--info:#7fc4e8;--acc:#f28b36}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 ui-monospace,Menlo,Consolas,monospace}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:12px max(16px,env(safe-area-inset-left));display:flex;flex-wrap:wrap;gap:10px;align-items:center;z-index:2}
h1{font:700 16px system-ui,sans-serif;margin:0;color:var(--acc);letter-spacing:.04em;margin-right:8px}
select,input,button{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:6px 8px;font:inherit}
button{cursor:pointer}.chips{display:flex;gap:6px}.chip{padding:3px 8px;border-radius:99px;border:1px solid var(--line);font-size:12px}
.chip.error{color:var(--err)}.chip.warn{color:var(--warn)}.chip.info{color:var(--info)}#meta{color:var(--muted);font-size:12px;margin-left:auto}
main{padding:8px max(16px,env(safe-area-inset-left)) 40px}table{width:100%;border-collapse:collapse}td{padding:5px 8px;border-bottom:1px solid #1d282d;vertical-align:top}
tr.error td{background:#2a1513}tr.warn td{background:#262010}td.t{white-space:nowrap;color:var(--muted)}td.k{white-space:nowrap}td.lv{font-weight:700;white-space:nowrap}
tr.error .lv{color:var(--err)}tr.warn .lv{color:var(--warn)}tr.info .lv{color:var(--info)}td.where{white-space:nowrap;color:var(--muted)}td.m{word-break:break-word}
.empty{color:var(--muted);padding:30px;text-align:center}
</style></head><body>
<header><h1>SURVIVAL ASCENSION · LOGS</h1>
<select id="lv"><option value="">All levels</option><option value="error">Errors only</option><option value="warn">Errors + warnings</option></select>
<input id="q" placeholder="Search (player, room, text)…" size="24">
<button id="pause">Pause</button>
<span class="chips"><span class="chip error" id="nErr">0 errors</span><span class="chip warn" id="nWarn">0 warnings</span><span class="chip info" id="nInfo">0 events</span></span>
<span id="meta"></span></header>
<main><table><tbody id="rows"></tbody></table><div class="empty" id="empty">No log entries yet.</div></main>
<script>
const key=new URLSearchParams(location.search).get("key")||"";let all=[],after=0,paused=false;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=t=>new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});
function draw(){const lv=document.getElementById("lv").value,q=document.getElementById("q").value.toLowerCase();
 const show=all.filter(e=>(!lv||e.level==="error"||(lv==="warn"&&e.level==="warn"))&&(!q||JSON.stringify(e).toLowerCase().includes(q))).slice().reverse();
 document.getElementById("rows").innerHTML=show.map(e=>{const where=[e.room&&"room "+e.room,e.wave&&"wave "+e.wave,e.player&&e.player+(e.cls?" ("+e.cls+")":"")].filter(Boolean).join(" · ");
  return '<tr class="'+e.level+'"><td class="t">'+fmt(e.t)+'</td><td class="lv">'+e.level.toUpperCase()+'</td><td class="k">'+esc(e.kind)+'</td><td class="where">'+esc(where)+'</td><td class="m">'+esc(e.msg)+'</td></tr>';}).join("");
 document.getElementById("empty").hidden=show.length>0;
 const c=l=>all.filter(e=>e.level===l).length;document.getElementById("nErr").textContent=c("error")+" errors";document.getElementById("nWarn").textContent=c("warn")+" warnings";document.getElementById("nInfo").textContent=c("info")+" events";}
async function poll(){if(!paused){try{const r=await fetch("/logs.json?key="+encodeURIComponent(key)+"&after="+after);const d=await r.json();
 if(d.entries.length){all=all.concat(d.entries).slice(-3000);after=d.entries[d.entries.length-1].id;}
 document.getElementById("meta").textContent="server up since "+fmt(d.startedAt)+" · version "+d.commit+" · updated "+fmt(d.now);draw();}catch(e){document.getElementById("meta").textContent="can't reach the server (asleep or restarting?)";}}
 setTimeout(poll,4000);}
document.getElementById("lv").onchange=draw;document.getElementById("q").oninput=draw;
document.getElementById("pause").onclick=e=>{paused=!paused;e.target.textContent=paused?"Resume":"Pause";};
poll();
</script></body></html>`;
