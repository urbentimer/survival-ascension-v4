// Stand-in for the colyseus.js Client in solo test mode.
// "Create room" starts the real SurvivalRoom server code inside this browser tab,
// so the game plays exactly like online, just without other players.
import { SurvivalRoom } from "../../server/src/SurvivalRoom.js";

export class Client {
  constructor() {}

  async create(_roomName, options = {}) {
    const server = new SurvivalRoom();
    server.onCreate({ ...options, solo: true });
    const me = { sessionId: "solo-" + Math.random().toString(36).slice(2, 8) };
    server.onJoin(me, options);

    const listeners = { state: [], leave: [], error: [], messages: {} };
    server._onBroadcast = (type, msg) => (listeners.messages[type] || []).forEach((cb) => cb(msg));
    const fail = (e) => {
      console.error("[solo server]", e);
      listeners.error.forEach((cb) => cb(500, e?.message || String(e)));
    };
    // Same rate the online server sends updates (patchRate 50ms).
    const pump = setInterval(() => {
      try { listeners.state.forEach((cb) => cb(server.state)); } catch (e) { fail(e); }
    }, 50);

    return {
      sessionId: me.sessionId,
      roomId: server.roomId,
      get state() { return server.state; },
      get server() { return server; },   // (automated preview tests poke the server through this)
      send(type, data) {
        try { server._handlers[type]?.(me, data); } catch (e) { fail(e); }
      },
      onStateChange(cb) { listeners.state.push(cb); },
      onLeave(cb) { listeners.leave.push(cb); },
      onError(cb) { listeners.error.push(cb); },
      onMessage(type, cb) { (listeners.messages[type] ||= []).push(cb); },
      leave() {
        clearInterval(pump);
        try { server.onLeave(me); } catch (e) { fail(e); }
        server._dispose();
        listeners.leave.forEach((cb) => cb(1000));
      },
    };
  }

  async joinById() {
    throw new Error("Solo test mode is just you. Joining friends needs the online version.");
  }
}
