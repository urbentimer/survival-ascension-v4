import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { SurvivalRoom } from "./SurvivalRoom.js";

const port = Number(process.env.PORT || 2567);
const server = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
  publicAddress: process.env.PUBLIC_ADDRESS
});
server.define("survival", SurvivalRoom);
server.listen(port);
console.log(`Survival Ascension server listening on port ${port}`);
