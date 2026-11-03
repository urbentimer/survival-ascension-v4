// Stand-in for "@colyseus/core" when the game server runs inside the browser.
// Provides only what SurvivalRoom uses: state, message handlers and the game loop timer.
export class Room {
  constructor() {
    this._handlers = {};
    this._timers = [];
    this.roomId = Math.random().toString(36).slice(2, 11);
  }
  setState(state) { this.state = state; }
  broadcast(type, message) { this._onBroadcast?.(type, message); }
  onMessage(type, handler) { this._handlers[type] = handler; }
  setSimulationInterval(fn, ms = 16) { this._timers.push(setInterval(fn, ms)); }
  _dispose() { this._timers.forEach(clearInterval); this._timers = []; }
}
