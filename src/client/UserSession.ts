import { Session } from "../base/Session.js";
import { ConnectionState } from "../types/index.js";
import type { LoginCredentials } from "./LoginClient.js";
import { PersonaSession } from "./PersonaSession.js";

/**
 * UserSession - owns user identity data and coordinates persona sessions.
 * Extends Session with user-level authentication logic.
 */
export class UserSession extends Session {
  readonly username: string;
  private personaSession: PersonaSession | null = null;
  private _userId: string | null = null;
  private _authToken: string | null = null;

  constructor(username: string) {
    super();
    this.username = username;
  }

  get userId(): string | null {
    return this._userId;
  }

  get authToken(): string | null {
    return this._authToken;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);
  }

  async login(credentials: LoginCredentials): Promise<void> {
    // Placeholder: real implementation calls @metaversalcorp/mvmf login API
    this._userId = `user_${credentials.username}`;
    this._authToken = `token_${Date.now()}`;
    this.setState(ConnectionState.LoggedIn);
  }

  async enterWorld(personaId: string): Promise<void> {
    if (!this._authToken) {
      throw new Error("Cannot enter world: not authenticated");
    }
    this.personaSession = new PersonaSession(personaId, this._authToken);
    await this.personaSession.connect();
    this.setState(ConnectionState.InWorld);
  }

  async disconnect(): Promise<void> {
    if (this.personaSession) {
      await this.personaSession.disconnect();
      this.personaSession = null;
    }
    this._authToken = null;
    this._userId = null;
    this.setState(ConnectionState.Disconnected);
  }
}
