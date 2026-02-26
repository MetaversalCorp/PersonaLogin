import { LoginClient } from "./client/LoginClient.js";
import { ConnectionState } from "./types/index.js";

// UI element references
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const stateBadge = document.getElementById("state-badge") as HTMLSpanElement;
const logOutput = document.getElementById("log-output") as HTMLDivElement;
const worldCard = document.getElementById("world-card") as HTMLDivElement;
const moveBtn = document.getElementById("move-btn") as HTMLButtonElement;
const animWaveBtn = document.getElementById("anim-wave-btn") as HTMLButtonElement;
const animIdleBtn = document.getElementById("anim-idle-btn") as HTMLButtonElement;
const clearLogBtn = document.getElementById("clear-log-btn") as HTMLButtonElement;

function appendLog(message: string): void {
  logOutput.textContent += message + "\n";
  logOutput.scrollTop = logOutput.scrollHeight;
}

const STATE_COLORS: Record<ConnectionState, string> = {
  [ConnectionState.Disconnected]: "secondary",
  [ConnectionState.Connecting]: "warning",
  [ConnectionState.Connected]: "info",
  [ConnectionState.LoggingIn]: "warning",
  [ConnectionState.LoggedIn]: "info",
  [ConnectionState.EnteringWorld]: "warning",
  [ConnectionState.InWorld]: "success",
  [ConnectionState.LoggingOut]: "warning",
  [ConnectionState.Error]: "danger",
};

function updateStateBadge(state: ConnectionState): void {
  stateBadge.textContent = state;
  stateBadge.className = `badge bg-${STATE_COLORS[state] ?? "secondary"} state-badge`;
}

const client = new LoginClient({
  onStateChange(state: ConnectionState) {
    updateStateBadge(state);
    const inWorld = state === ConnectionState.InWorld;
    loginBtn.disabled = state !== ConnectionState.Disconnected && state !== ConnectionState.Error;
    logoutBtn.disabled = state === ConnectionState.Disconnected || state === ConnectionState.LoggingOut;
    worldCard.classList.toggle("d-none", !inWorld);
  },
  onError(error: Error) {
    appendLog(`ERROR: ${error.message}`);
  },
  onLog(message: string) {
    appendLog(message);
  },
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const serverUrl = (document.getElementById("server-url") as HTMLInputElement).value.trim();
  const username = (document.getElementById("username") as HTMLInputElement).value.trim();
  const password = (document.getElementById("password") as HTMLInputElement).value;
  const personaId = (document.getElementById("persona-id") as HTMLInputElement).value.trim();

  try {
    await client.login({ serverUrl, username, password });
    await client.enterWorld(personaId);
  } catch {
    // Error already handled via onError callback
  }
});

logoutBtn.addEventListener("click", async () => {
  await client.logout();
});

moveBtn.addEventListener("click", () => {
  appendLog("[UI] Move command sent (world controls placeholder)");
});

animWaveBtn.addEventListener("click", () => {
  appendLog("[UI] Wave animation triggered (world controls placeholder)");
});

animIdleBtn.addEventListener("click", () => {
  appendLog("[UI] Idle animation triggered (world controls placeholder)");
});

clearLogBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

// Initial state
updateStateBadge(ConnectionState.Disconnected);
appendLog("PersonaLogin ready. Enter credentials and click Login.");
