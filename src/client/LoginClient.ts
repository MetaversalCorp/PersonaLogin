import { AuthService, AuthResponse } from "./AuthService.js";
import { UserSession } from "./UserSession.js";
import { ConnectionState } from "../types/index.js";
import { Endpoints } from "../config.js";

/** Credentials exported so UserSession can reference the same type. */
export interface LoginCredentials {
  email: string;
  password: string;
  remember?: boolean;
}

/**
 * LoginClient — drives the RP1 login UI in index.html.
 *
 * Wires DOM event listeners to AuthService calls and manages the transition
 * between the login views and the post-login session view.
 */
export class LoginClient {
  private userSession: UserSession | null = null;
  private authResponse: AuthResponse | null = null;

  constructor(_container: HTMLElement) {
    this.bindUI();
    // Attempt to restore a previously stored session on load
    void this.restoreSession();
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────

  private el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  private showRoute(id: string): void {
    const routes = [
      "not-logged-in-route",
      "guest-sign-in-route",
      "login-route",
    ];
    for (const r of routes) {
      const el = this.el(r);
      if (el) el.classList.toggle("d-none", r !== id);
    }
  }

  private showSection(section: "login" | "session"): void {
    const loginSection = this.el("login-section");
    const sessionSection = this.el("session-section");
    if (loginSection) loginSection.classList.toggle("d-none", section !== "login");
    if (sessionSection) sessionSection.classList.toggle("d-none", section !== "session");
  }

  private updateStatusBadge(type: "pending" | "success" | "error" | "logged-in"): void {
    const badge = document.querySelector<HTMLElement>("#status-panel .status-badge");
    if (!badge) return;
    badge.className = `status-badge ${type}`;
    const labels: Record<string, string> = {
      pending: "Pending",
      success: "Connected",
      error: "Error",
      "logged-in": "Logged In",
    };
    badge.textContent = labels[type] ?? type;
  }

  private appendStatus(message: string): void {
    const content = this.el("status-content");
    if (!content) return;
    const line = document.createElement("div");
    const now = new Date().toLocaleTimeString();
    line.textContent = `[${now}] ${message}`;
    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
  }

  private showTokenData(response: AuthResponse): void {
    const content = this.el("status-content");
    if (!content) return;
    content.innerHTML = "";

    const addItem = (label: string, value: string, cssClass: string): void => {
      const item = document.createElement("div");
      item.className = cssClass;
      item.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
      content.appendChild(item);
    };

    addItem("Session ID", response.sessionId, "token-item");
    addItem("User ID", response.token.userId, "token-item");
    addItem(
      "Access Token",
      response.token.accessToken.slice(0, 32) + "…",
      "token-item"
    );
    addItem(
      "Expires",
      new Date(response.token.expiresAt).toLocaleString(),
      "token-item"
    );
    if (response.token.personaIds.length) {
      addItem("Persona IDs", response.token.personaIds.join(", "), "token-item");
    }
    addItem(
      "Server Response",
      JSON.stringify(
        {
          sessionId: response.sessionId,
          userId: response.token.userId,
          personaIds: response.token.personaIds,
          expiresAt: response.token.expiresAt,
        },
        null,
        2
      ),
      "transaction-item"
    );
  }

  private updateSessionInfo(): void {
    const info = this.el("session-info");
    if (!info || !this.authResponse) return;

    const session = this.userSession;
    info.innerHTML = `<pre>${JSON.stringify(
      {
        sessionId: this.authResponse.sessionId,
        userId: this.authResponse.token.userId,
        displayName: this.authResponse.displayName,
        personaIds: this.authResponse.token.personaIds,
        connectionState: session?.state ?? ConnectionState.Disconnected,
        tokenExpiresAt: new Date(this.authResponse.token.expiresAt).toISOString(),
      },
      null,
      2
    )}</pre>`;
  }

  // ─── Session management ────────────────────────────────────────────────────

  private async restoreSession(): Promise<void> {
    const stored = AuthService.getStoredToken();
    if (!stored) return;

    if (!AuthService.isTokenValid(stored)) {
      // Attempt silent refresh
      try {
        const refreshed = await AuthService.refreshToken(stored.refreshToken);
        this.appendStatus("Session restored via token refresh.");
        this.onTokenObtained({
          token: refreshed,
          sessionId: "restored",
          displayName: "Returning User",
        });
      } catch {
        AuthService.clearToken();
      }
      return;
    }

    this.appendStatus("Session restored from stored token.");
    this.onTokenObtained({
      token: stored,
      sessionId: "restored",
      displayName: "Returning User",
    });
  }

  private onTokenObtained(response: AuthResponse): void {
    this.authResponse = response;
    this.userSession = new UserSession(response.displayName);

    const displayNameEl = this.el("user-display-name");
    if (displayNameEl) displayNameEl.textContent = response.displayName;

    this.showSection("session");
    this.updateStatusBadge("logged-in");
    this.showTokenData(response);
    this.updateSessionInfo();
    this.appendStatus(`Logged in as "${response.displayName}" (${response.token.userId})`);
  }

  // ─── Event binding ─────────────────────────────────────────────────────────

  private bindUI(): void {
    // Navigation between login views
    this.el("login-guest-button")?.addEventListener("click", () => {
      this.showRoute("guest-sign-in-route");
    });
    this.el("login-or-create-button")?.addEventListener("click", () => {
      this.showRoute("login-route");
    });
    this.el("guest-cancel-button")?.addEventListener("click", () => {
      this.showRoute("not-logged-in-route");
    });
    this.el("login-back-button")?.addEventListener("click", () => {
      this.showRoute("not-logged-in-route");
    });

    // Guest login form
    this.el("guest-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const firstName =
        (this.el<HTMLInputElement>("guest-first-name")?.value ?? "").trim();
      const lastName =
        (this.el<HTMLInputElement>("guest-last-name")?.value ?? "").trim() ||
        undefined;
      if (!firstName) return;
      void this.handleGuestLogin(firstName, lastName);
    });

    // Member login form
    this.el("login-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email =
        (this.el<HTMLInputElement>("login-email")?.value ?? "").trim();
      const password = this.el<HTMLInputElement>("login-password")?.value ?? "";
      const remember =
        this.el<HTMLInputElement>("login-remember")?.checked ?? false;
      if (!email || !password) return;
      void this.handleMemberLogin({ email, password, remember });
    });

    // Password visibility toggle
    this.el("vis-login-password")?.addEventListener("click", () => {
      const pw = this.el<HTMLInputElement>("login-password");
      if (!pw) return;
      pw.type = pw.type === "password" ? "text" : "password";
    });

    // Logout
    this.el("logout-button-main")?.addEventListener("click", () => {
      void this.handleLogout();
    });

    // Teleport button
    this.el("teleport-button")?.addEventListener("click", () => {
      this.handleTeleport();
    });

    // Location presets
    document.querySelectorAll<HTMLElement>(".location-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const celestial = btn.dataset["celestial"] ?? "";
        const lat = btn.dataset["lat"] ?? "0";
        const lon = btn.dataset["lon"] ?? "0";
        const alt = btn.dataset["alt"] ?? "0";
        this.setTeleportInputs(celestial, lat, lon, alt);
        this.handleTeleport();
      });
    });

    // Clear status log
    this.el("clear-status-btn")?.addEventListener("click", () => {
      const content = this.el("status-content");
      if (content) content.innerHTML = "";
    });
  }

  // ─── Auth handlers ─────────────────────────────────────────────────────────

  private async handleMemberLogin(credentials: LoginCredentials): Promise<void> {
    const btn = this.el<HTMLButtonElement>("login-button");
    if (btn) btn.disabled = true;

    this.updateStatusBadge("pending");
    this.appendStatus(`Connecting to ${Endpoints.login}…`);

    try {
      const response = await AuthService.loginMember({
        email: credentials.email,
        password: credentials.password,
        remember: credentials.remember,
      });
      this.onTokenObtained(response);
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Login error: ${(err as Error).message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private async handleGuestLogin(
    firstName: string,
    lastName?: string
  ): Promise<void> {
    const btn = this.el<HTMLButtonElement>("guest-join-button");
    if (btn) btn.disabled = true;

    this.updateStatusBadge("pending");
    this.appendStatus("Connecting to RP1 as guest…");

    try {
      const response = await AuthService.loginGuest({ firstName, lastName });
      this.onTokenObtained(response);
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Guest login error: ${(err as Error).message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private async handleLogout(): Promise<void> {
    AuthService.clearToken();
    if (this.userSession) {
      await this.userSession.disconnect();
      this.userSession = null;
    }
    this.authResponse = null;

    this.showSection("login");
    this.showRoute("not-logged-in-route");
    this.updateStatusBadge("pending");
    this.appendStatus("Logged out.");
  }

  // ─── Teleport ──────────────────────────────────────────────────────────────

  private setTeleportInputs(
    celestial: string,
    lat: string,
    lon: string,
    alt: string
  ): void {
    const set = (id: string, val: string): void => {
      const el = this.el<HTMLInputElement>(id);
      if (el) el.value = val;
    };
    set("celestial-id", celestial);
    set("teleport-latitude", lat);
    set("teleport-longitude", lon);
    set("teleport-altitude", alt);
  }

  private handleTeleport(): void {
    const celestial =
      (this.el<HTMLInputElement>("celestial-id")?.value ?? "").trim();
    const lat = parseFloat(
      this.el<HTMLInputElement>("teleport-latitude")?.value ?? "0"
    );
    const lon = parseFloat(
      this.el<HTMLInputElement>("teleport-longitude")?.value ?? "0"
    );
    const alt = parseFloat(
      this.el<HTMLInputElement>("teleport-altitude")?.value ?? "0"
    );

    if (!celestial || isNaN(lat) || isNaN(lon) || isNaN(alt)) {
      this.appendStatus("Teleport: invalid coordinates.");
      return;
    }

    // Convert lat/lon/alt to cartesian offsets (simplified flat-earth approx)
    const R = 6_371_000; // Earth radius in metres
    const dx = (lon * Math.PI * R) / 180;
    const dy = alt;
    const dz = (lat * Math.PI * R) / 180;

    const fmt = (n: number): string => n.toFixed(2);
    const elDx = this.el("coord-dx");
    const elDy = this.el("coord-dy");
    const elDz = this.el("coord-dz");
    if (elDx) elDx.textContent = fmt(dx);
    if (elDy) elDy.textContent = fmt(dy);
    if (elDz) elDz.textContent = fmt(dz);

    const elCelestial = this.el("current-celestial");
    const elPosition = this.el("current-position");
    if (elCelestial) elCelestial.textContent = celestial;
    if (elPosition) {
      elPosition.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}, ${alt}m`;
    }

    // Send teleport via persona puppet if in-world session is active
    this.userSession?.teleportTo(celestial, { x: dx, y: dy, z: dz });

    this.appendStatus(
      `Teleport → ${celestial} lat=${lat} lon=${lon} alt=${alt}m`
    );
    this.updateSessionInfo();
  }
}