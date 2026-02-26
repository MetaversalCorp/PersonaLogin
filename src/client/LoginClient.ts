import { ConnectionState } from "../types/index.js";
import { UserSession } from "./UserSession.js";

export interface LoginCredentials {
  username: string;
  password: string;
  serverUrl: string;
}

export interface LoginClientEvents {
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
  onLog?: (message: string) => void;
}

/**
 * LoginClient - manages the full authentication and session lifecycle.
 * Orchestrates UserSession → PersonaSession → InWorldSession transitions.
 */
export class LoginClient {
  private userSession: UserSession | null = null;
  private events: LoginClientEvents;
  private _state: ConnectionState = ConnectionState.Disconnected;

  constructor(events: LoginClientEvents = {}) {
    this.events = events;
  }

  get state(): ConnectionState {
    return this._state;
  }

  private log(message: string): void {
    const ts = new Date().toISOString();
    const msg = `[${ts}] ${message}`;
    console.log(msg);
    this.events.onLog?.(msg);
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.events.onStateChange?.(state);
  }

  async login(credentials: LoginCredentials): Promise<void> {
    if (this._state !== ConnectionState.Disconnected) {
      throw new Error(`Cannot login from state: ${this._state}`);
    }

    try {
      this.setState(ConnectionState.Connecting);
      this.log(`Connecting to ${credentials.serverUrl}…`);

      this.userSession = new UserSession(credentials.username);
      await this.userSession.connect();

      this.setState(ConnectionState.LoggingIn);
      this.log(`Authenticating as ${credentials.username}…`);

      // Delegate to UserSession to complete login flow
      await this.userSession.login(credentials);

      this.setState(ConnectionState.LoggedIn);
      this.log("Login successful.");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`Login failed: ${error.message}`);
      this.setState(ConnectionState.Error);
      this.events.onError?.(error);
      throw error;
    }
  }

  async enterWorld(personaId: string): Promise<void> {
    if (!this.userSession) {
      throw new Error("Not logged in");
    }

    try {
      this.setState(ConnectionState.EnteringWorld);
      this.log(`Entering world with persona ${personaId}…`);

      await this.userSession.enterWorld(personaId);

      this.setState(ConnectionState.InWorld);
      this.log("Entered world successfully.");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`Enter world failed: ${error.message}`);
      this.setState(ConnectionState.Error);
      this.events.onError?.(error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    if (
      this._state === ConnectionState.Disconnected ||
      this._state === ConnectionState.LoggingOut
    ) {
      return;
    }

    try {
      this.setState(ConnectionState.LoggingOut);
      this.log("Logging out…");

      if (this.userSession) {
        await this.userSession.disconnect();
        this.userSession = null;
      }

      this.setState(ConnectionState.Disconnected);
      this.log("Logged out.");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`Logout error: ${error.message}`);
      this.setState(ConnectionState.Error);
      this.events.onError?.(error);
    }
  }
}
