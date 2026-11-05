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
  minify: true,
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
const webpOf = rel => join(WEBP_DIR, rel.replace(/[\/]/g, "__") + ".q90.webp");
{
  const all = new Set([...(js + html).matchAll(ASSET_RE)].map(m => m[0]).filter(r => r.endsWith(".png")));
  const todo = [...all].filter(r => { const out = webpOf(r); return !existsSync(out) || statSync(out).mtimeMs < statSync(join(root, "client", r)).mtimeMs; });
  if (todo.length) {
    const py = "import sys\nfrom PIL import Image\nfor a in sys.argv[1:]:\n  src, dst = a.split('|')\n  im = Image.open(src); im = im.convert('RGBA') if im.mode not in ('RGB','RGBA') else im\n  im.save(dst, quality=90, alpha_quality=100, method=6)\n";
    execFileSync("python3", ["-c", py, ...todo.map(r => join(root, "client", r) + "|" + webpOf(r))], { stdio: "inherit" });
  }
}
const inlineAssets = (text) => text.replace(ASSET_RE, (rel) => {
  if (rel.includes("audio/music_") || rel.includes("audio/fire_loop")) return "";   // music + the fire crackle stay out of the preview (16 MB limit): the live game has them
  const ext = rel.split(".").pop();
  if (ext === "png") { const w = readFileSync(webpOf(rel)), p = readFileSync(join(root, "client", rel)); if (w.length < p.length) return "data:image/webp;base64," + w.toString("base64"); }
  const mime = ext === "jpg" ? "image/jpeg" : ext === "mp3" ? "audio/mpeg" : "image/" + ext;
  return `data:${mime};base64,` + readFileSync(join(root, "client", rel)).toString("base64");
});
js = inlineAssets(js);
const page = `<title>Survival Ascension</title>
<style>${inlineAssets(styles)}
${extraCss}</style>
${inlineAssets(body)}
<script>${js}</script>
`;
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/preview.html"), page);
console.log(`preview.html written (${(page.length / 1024).toFixed(0)} KB)`);
