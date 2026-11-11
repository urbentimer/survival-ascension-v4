// Bundles the server room for the headless sims (tools/dist/room-test.mjs), the same way tools/test-room.mjs does, without running the tests.
import { build } from "esbuild"; import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
await build({ entryPoints: [join(root, "server/src/SurvivalRoom.js")], bundle: true, format: "esm", platform: "node", outfile: join(here, "dist/room-test.mjs"), logLevel: "warning",
  plugins: [{ name: "shim", setup(b) { b.onResolve({ filter: /^@colyseus\/core$/ }, () => ({ path: join(here, "solo/room-shim.js") }));
    b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({ path: join(root, "server/node_modules/@colyseus/schema/build/esm/index.mjs") })); } }] });
