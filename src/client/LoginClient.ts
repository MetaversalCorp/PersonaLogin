// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;
import { createLnGClient, ILnGClient, LnGUser, LnGPersona, GUEST_EMAIL } from "../mv/LnG.js";
import { UserSession } from "./UserSession.js";
import { ConnectionState } from "../types/index.js";

/** Credentials exported so callers can reference the same type. */
export interface LoginCredentials {
  email: string;
  password: string;
  remember?: boolean;
}

/** Time (ms) to wait for the RUser model's onReadyState + Child_Enum to complete. */
const PERSONA_ENUM_WAIT_MS = 500;

/**
 * LoginClient — drives the RP1 login UI in index.html.
 *
 * Uses MV LnG (Log-n-Go) for authentication instead of direct HTTP calls.
 * LnG manages all communication with RP1 servers and token exchange internally.
 *
 * Login flow:
 *   1. Member/guest credentials → pLnG.Login() → LnGUser (with persona list)
 *   2. Show persona picker → user picks or auto-pick first persona
 *   3. userSession.pickPersona(id) → PersonaSession → InWorld
 *
 * 2FA flow:
 *   pLnG.Login() invokes the finalizationHandler when a code is required.
 *   LoginClient shows the 2FA route and resolves the pending promise once
 *   the user submits the code.
 */
export class LoginClient {
  private _pLnG: ILnGClient;
  private userSession: UserSession | null = null;
  private pendingUser: LnGUser | null = null;

  constructor(_container: HTMLElement) {
    this._pLnG = createLnGClient();
    this.bindUI();
  }

  // ─── Public getters ────────────────────────────────────────────────────────

  /**
   * Public accessor for pLnG instance.
   * Required by UserSession and PersonaSession constructors.
   */
  get pLnG(): ILnGClient {
    return this._pLnG;
  }

  /**
   * Returns the active UserSession once authenticated, or `null` before login.
   * Use `userSession.personaSession?.inWorld?.audio` to reach the audio manager.
   */
  get session(): UserSession | null {
    return this.userSession;
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
      "persona-picker-route",
      "tfa-route",
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

  private updateSessionInfo(): void {
    const info = this.el("session-info");
    if (!info || !this.userSession) return;

    const session = this.userSession;
    info.innerHTML = `<pre>${JSON.stringify(
      {
        userId: session.userId,
        displayName: session.username,
        personas: session.ownPersonaList.map((p) => ({ id: p.id, name: p.displayName })),
        connectionState: session.state,
      },
      null,
      2
    )}</pre>`;
  }

  // ─── Persona picker ────────────────────────────────────────────────────────

  /**
   * Auto-pick the first persona without showing the picker UI.
   */
  private showPersonaPicker(user: LnGUser): void {
    this.pendingUser = user;

    if (user.personas.length > 0) {
      this.appendStatus(`Auto-picking persona "${user.personas[0].displayName}".`);
      void this.onPersonaPicked(user.personas[0].id).catch((err) => {
        this.updateStatusBadge("error");
        this.appendStatus(`Persona error: ${(err as Error).message}`);
      });
    } else {
      this.appendStatus("No personas found. Create a new persona to continue.");
      this.showRoute("persona-picker-route");
    }
  }

  private async onPersonaPicked(personaId: string): Promise<void> {
    if (!this.pendingUser) return;
    const user = this.pendingUser;
    this.pendingUser = null;

    this.userSession = new UserSession(user);
    await this.userSession.connect();

    this.appendStatus(`Entering world with persona ${personaId}…`);
    try {
      await this.userSession.pickPersona(personaId);
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Persona error: ${(err as Error).message}`);
    }
  }

  private onSessionStarted(): void {
    if (!this.userSession) return;

    const displayNameEl = this.el("user-display-name");
    if (displayNameEl) displayNameEl.textContent = this.userSession.username;

    this.showSection("session");
    this.updateStatusBadge("logged-in");
    this.updateSessionInfo();
    this.appendStatus(
      `Session started as "${this.userSession.username}" (${this.userSession.userId})`
    );
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
      void this.handleGuestLogin();
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

    // Persona picker — create new persona button
    this.el("create-persona-button")?.addEventListener("click", () => {
      void this.handleCreatePersona();
    });

    // 2FA form
    this.el("tfa-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const code = (this.el<HTMLInputElement>("tfa-code")?.value ?? "").trim();
      if (!code) return;
      this.submitTfaCode(code);
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
        const radius = btn.dataset["radius"] ?? "6371000";
        this.setTeleportInputs(celestial, lat, lon, radius);
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

  /**
   * Member login — calls pLnG.Login(MV.MVMF.Encode({ contact, password, remember }), finalizationHandler).
   * MV LnG handles all HTTP communication with RP1 servers internally.
   */
  private async handleMemberLogin(credentials: LoginCredentials): Promise<void> {
    const btn = this.el<HTMLButtonElement>("login-button");
    if (btn) btn.disabled = true;

    this.updateStatusBadge("pending");
    this.appendStatus("Connecting to RP1 via MV LnG…");

    try {
      const encoded = MV.MVMF.Encode({ contact: credentials.email, password: credentials.password, remember: credentials.remember });
      const user = await this._pLnG.Login(
        encoded,
        (resolve2FA) => {
          this.appendStatus("2FA required — enter confirmation code.");
          this.showTfaRoute(resolve2FA);
        }
      );
      this.appendStatus(`Authenticated as "${user.displayName}".`);
      this.updateStatusBadge("success");

      this.pendingUser = user;
      this.userSession = new UserSession(user);
      await this.userSession.connect();

      // Wait for personas to be enumerated by onReadyState/Child_Enum
      await new Promise<void>((resolve) => setTimeout(resolve, PERSONA_ENUM_WAIT_MS));

      const personas = this.userSession.ownPersonaList;
      if (personas.length > 0) {
        this.appendStatus(`Auto-picking persona "${personas[0].displayName}".`);
        try {
          await this.userSession.pickPersona(personas[0].id);
          this.onSessionStarted();
        } catch (err) {
          this.updateStatusBadge("error");
          this.appendStatus(`Persona error: ${(err as Error).message}`);
        }
      } else {
        this.appendStatus("No personas found. Create a new persona to continue.");
        this.showRoute("persona-picker-route");
      }
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Login error: ${(err as Error).message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /**
   * Guest login — calls pLnG.Login(MV.MVMF.Encode({ contact: GUEST_EMAIL, password: GUEST_EMAIL })).
   * MV LnG requires both contact and password fields to initiate an anonymous session.
   * Guests skip RPERSONA_OPEN and go directly to RPERSONA_ENTER via pickPersona().
   */
  private async handleGuestLogin(): Promise<void> {
    const btn = this.el<HTMLButtonElement>("guest-join-button");
    if (btn) btn.disabled = true;

    this.updateStatusBadge("pending");
    this.appendStatus("Connecting to RP1 as guest via MV LnG…");

    try {
      const user = await this._pLnG.Login(MV.MVMF.Encode({ contact: GUEST_EMAIL, password: GUEST_EMAIL }));
      this.appendStatus(`Guest session started.`);
      this.updateStatusBadge("success");

      this.userSession = new UserSession(user);
      await this.userSession.connect();

      // Wait for personas to be enumerated by onReadyState/Child_Enum
      await new Promise<void>((resolve) => setTimeout(resolve, PERSONA_ENUM_WAIT_MS));

      const personaId = this.userSession.ownPersonaList[0]?.id ?? "0";
      this.appendStatus(`Opening persona ${personaId}…`);
      await this.userSession.pickPersona(personaId);
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Guest login error: ${(err as Error).message}`);
      if (this.userSession) {
        await this.userSession.disconnect();
        this.userSession = null;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private async handleCreatePersona(): Promise<void> {
    if (!this.pendingUser) return;

    const user = this.pendingUser;
    this.userSession = new UserSession(user);
    await this.userSession.connect();

    this.appendStatus(`Opening persona…`);
    try {
      await this.userSession.pickPersona("0");
      this.onSessionStarted();
    } catch (err) {
      this.updateStatusBadge("error");
      this.appendStatus(`Open persona error: ${(err as Error).message}`);
    }
  }

  private async handleLogout(): Promise<void> {
    await this._pLnG.Logout();
    if (this.userSession) {
      await this.userSession.disconnect();
      this.userSession = null;
    }
    this.pendingUser = null;

    this.showSection("login");
    this.showRoute("not-logged-in-route");
    this.updateStatusBadge("pending");
    this.appendStatus("Logged out.");
  }

  // ─── 2FA ───────────────────────────────────────────────────────────────────

  private pendingTfaResolve: ((code: string) => void) | null = null;

  private showTfaRoute(resolve2FA: (code: string) => void): void {
    this.pendingTfaResolve = resolve2FA;
    const codeInput = this.el<HTMLInputElement>("tfa-code");
    if (codeInput) codeInput.value = "";
    this.showRoute("tfa-route");
  }

  private submitTfaCode(code: string): void {
    if (!this.pendingTfaResolve) return;
    const resolve = this.pendingTfaResolve;
    this.pendingTfaResolve = null;
    this.appendStatus("Submitting 2FA code…");
    resolve(code);
  }

  // ─── Teleport ──────────────────────────────────────────────────────────────

  private setTeleportInputs(
    celestial: string,
    lat: string,
    lon: string,
    radius: string
  ): void {
    const set = (id: string, val: string): void => {
      const el = this.el<HTMLInputElement>(id);
      if (el) el.value = val;
    };
    set("celestial-id", celestial);
    set("teleport-latitude", lat);
    set("teleport-longitude", lon);
    set("teleport-radius", radius);
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
    const radius = parseFloat(
      this.el<HTMLInputElement>("teleport-radius")?.value ?? "0"
    );

    if (!celestial || isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      this.appendStatus("Teleport: invalid coordinates.");
      return;
    }

    const [dx, dy, dz] = latLonToCartesianYUp(lat, lon, radius);

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
      elPosition.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}, ${radius}m`;
    }

    // Send teleport via persona puppet if in-world session is active
    this.userSession?.teleportTo(celestial, { x: dx, y: dy, z: dz });

    this.appendStatus(
      `Teleport → ${celestial} lat=${lat} lon=${lon} radius=${radius}m`
    );
    this.updateSessionInfo();
  }
}

export function latLonToCartesianYUp(
  latDeg: number,
  lonDeg: number,
  radius: number
): [number, number, number] {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;

  const cosLat = Math.cos(lat);

  const x = radius * cosLat * Math.sin(lon);
  const y = radius * Math.sin(lat);
  const z = radius * cosLat * Math.cos(lon);

  return [x, y, z];
}