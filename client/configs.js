// Client-side configuration for Survival Ascension.
// Override the server address at launch with ?server=wss://your-render-host
export const GAME_CONFIG = Object.freeze({
  roomName: "survival",
  serverPort: 2567,
  maxPlayers: 8,
  defaultCharacterClass: "assault",
  profileStorageKey: "survivalAscensionProfile"
});
