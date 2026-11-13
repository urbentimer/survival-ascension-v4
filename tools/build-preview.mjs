// Builds a single-file, solo-playable preview of the game.
// Usage (from the project root):  node tools/build-preview.mjs
// Output: tools/dist/preview.html
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const COLYSEUS_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/colyseus\.js@.*$/;

const soloPlugin = {
  name: "solo",
  setup(b) {
    b.onResolve({ filter: COLYSEUS_CDN }, () => ({ path: join(here, "solo/client-shim.js") }));
    b.onResolve({ filter: /^@colyseus\/core$/ }, () => ({ path: join(here, "solo/room-shim.js") }));
    b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({
      path: join(root, "server/node_modules/@colyseus/schema/build/esm/index.mjs"),
    }));
  },
};

const result = await build({
  entryPoints: [join(root, "client/client.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: !process.env.SA_NOMIN,   // SA_NOMIN=1: readable names for CPU profiles (tools/dist/preview-dev.html)
  write: false,
  plugins: [soloPlugin],
  define: { __SOLO__: "true" },
  logLevel: "warning",
});
let js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = readFileSync(join(root, "client/index.html"), "utf8");
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
body = body.replace(/<script[^>]*src="\.\/client\.js[^"]*"[^>]*><\/script>/, "");

const banner = `<div class="solo-banner" role="note"><b>SOLO TEST MODE</b><span>The game server runs in this tab, so it plays exactly like online, just without friends. Joining a room is off here.</span></div>`;
body = body.replace(/<main class="wrap">/, `<main class="wrap">${banner}`);

const extraCss = `.solo-banner{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin:0 0 12px;padding:9px 12px;border:1px dashed #f28b36;background:#2a1c14;color:#ffd2a8;font-size:12px;line-height:1.45}.solo-banner b{letter-spacing:.14em;color:#ffb56d}`;

// Inline art (client/assets/...) as data URIs so the single-file preview shows it.
// PNGs are packed as high-quality WebP (q90, alpha exact; looks the same, about half the size): the preview must stay under 16 MB.
// The live game keeps the original PNGs. Cached in tools/dist/webp/ (delete the folder to re-encode).
const ASSET_RE = /assets\/[\w\/.-]+\.(webp|png|jpg|mp3)/g;
const WEBP_DIR = join(here, "dist/webp"); mkdirSync(WEBP_DIR, { recursive: true });
const webpOf = rel => join(WEBP_DIR, rel.replace(/[\/]/g, "__") + ".q60.webp");
{
  const all = new Set([...(js + html).matchAll(ASSET_RE)].map(m => m[0]).filter(r => r.endsWith(".png") || r.endsWith(".webp")));   // Nov 10: webp sources too, at q76 (preview only: the page limit is 16.7 MB)
  const todo = [...all].filter(r => { const out = webpOf(r); return !existsSync(out) || statSync(out).mtimeMs < statSync(join(root, "client", r)).mtimeMs; });
  if (todo.length) {
    const py = "import sys\nfrom PIL import Image\nfor a in sys.argv[1:]:\n  src, dst = a.split('|')\n  im = Image.open(src); im = im.convert('RGBA') if im.mode not in ('RGB','RGBA') else im\n  im.save(dst, quality=60, alpha_quality=100, method=6)\n";
    execFileSync("python3", ["-c", py, ...todo.map(r => join(root, "client", r) + "|" + webpOf(r))], { stdio: "inherit" });
  }
}
const inlineAssets = (text) => text.replace(ASSET_RE, (rel) => {
  if (!process.env.SA_MUSIC && (rel.includes("audio/music_") || rel.includes("audio/fire_loop"))) return rel;   // (Nov 12) music + the fire crackle stay plain paths: the mp3s are published NEXT to the page (Artifact files "assets/audio/..."), so they don't count toward its 16 MB. SA_MUSIC=1 inlines them (a local file:// test build, where fetch can't read files)
  const ext = rel.split(".").pop();
  if ((ext === "png" || ext === "webp") && !/\/abom|dir8\/(pyre|screamer|butcher|mb|hivemind-alpha|juggernaut)|fx\/briggs-(wall|slab|shield|shock|punch)/.test(rel)) { const w = readFileSync(webpOf(rel)), p = readFileSync(join(root, "client", rel)); if (w.length < p.length) return "data:image/webp;base64," + w.toString("base64"); }   // (Nov 12) the sharpened boss sheets (Abomination, Pyre Priest, Screamer, Butcher, Mine Beast, Alpha Hivemind) go in as they are (no q60 re-encode)
  const mime = ext === "jpg" ? "image/jpeg" : ext === "mp3" ? "audio/mpeg" : "image/" + ext;
  return `data:${mime};base64,` + readFileSync(join(root, "client", rel)).toString("base64");
});
// (Nov 11) The game's art no longer fits one 16 MB page. Every asset path that is a whole string in the code ("assets/x.webp") becomes a lookup
// __A["assets/x.webp"], and the data URIs live in separate script files published next to the page (preview-assets-N.js, each well under 16 MB).
// Paths inside bigger strings (CSS, HTML) are still inlined.
const table = {}; mkdirSync(join(here, "dist"), { recursive: true });
js = js.replace(/(["'`])(assets\/[\w\/.-]+\.(?:webp|png|jpg|mp3))\1/g, (m, q, rel) => { const key = rel.slice(7); if (!(key in table)) table[key] = inlineAssets(rel); return `__A[${JSON.stringify(key)}]`; });   // (key without "assets/": the inlining pass below must not touch it)
js = inlineAssets(js);
const dev = !!process.env.SA_NOMIN, base = dev ? "preview-dev-assets" : "preview-assets", chunks = [[]], LIMIT = 9 * 1024 * 1024; let size = 0;
for (const [rel, uri] of Object.entries(table)) { if (size + uri.length > LIMIT && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; } chunks[chunks.length - 1].push([rel, uri]); size += uri.length; }
const files = chunks.map((c, i) => { const name = `${base}-${i + 1}.js`; writeFileSync(join(here, "dist", name), "window.__A=Object.assign(window.__A||{}," + JSON.stringify(Object.fromEntries(c)) + ");\n"); return name; });
const page = `<title>Survival Ascension</title>
<style>${inlineAssets(styles)}
${extraCss}</style>
${inlineAssets(body)}
${files.map(f => `<script src="${f}"></script>`).join("\n")}
<script>${js}</script>
`;
const outName = dev ? "dist/preview-dev.html" : "dist/preview.html";
writeFileSync(join(here, outName), page);
console.log(`${outName.slice(5)} written (${(page.length / 1024).toFixed(0)} KB) + ${files.length} asset files (${chunks.map(c => (c.reduce((a, [, u]) => a + u.length, 0) / 1048576).toFixed(1) + " MB").join(", ")})`);
