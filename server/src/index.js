import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { SurvivalRoom, warmLayouts } from "./SurvivalRoom.js";
import { log, commit, handleLogsRequest } from "./logbook.js";

const port = Number(process.env.PORT || 2567);
const server = new Server({
  transport: new WebSocketTransport({ pingInterval: 2000, pingMaxRetries: 3, server: createServer((req, res) => { if (!handleLogsRequest(req, res)) { res.writeHead(404); res.end(); } }) }),
  publicAddress: process.env.PUBLIC_ADDRESS
});
warmLayouts();
server.define("survival", SurvivalRoom);
server.listen(port);
console.log(`Survival Ascension server listening on port ${port}`);
log("info", "server-start", `server started (version ${commit})`);
