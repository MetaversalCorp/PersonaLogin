import { Session } from "../base/Session.js";
import { ConnectionState } from "../types/index.js";
import type { LoginCredentials } from "./LoginClient.js";
import { AuthService } from "./AuthService.js";
import { PersonaSession } from "./PersonaSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";

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
    this.setState(ConnectionState.LoggingIn);
    const response = await AuthService.loginMember(credentials);
    this._userId = response.token.userId;
    this._authToken = response.token.accessToken;
    this.setState(ConnectionState.LoggedIn);
  }

  async enterWorld(personaId: string): Promise<void> {
    if (!this._authToken) {
      throw new Error("Cannot enter world: not authenticated");
    }
    this.setState(ConnectionState.EnteringWorld);
    this.personaSession = new PersonaSession(personaId, this._authToken);
    await this.personaSession.connect();
    this.setState(ConnectionState.InWorld);
  }

  /**
   * Teleport the active persona to the given world position.
   *
   * @param celestialId - The pParent celestial body identifier (e.g. "earth_001").
   * @param transform - Cartesian position in world-space metres (x/y/z).
   *   `rotY` is intentionally omitted and defaults to 0 on the puppet side.
   *
   * No-op when not in world.
   */
  teleportTo(celestialId: string, transform: Omit<PersonaTransform, "rotY">): void {
    this.personaSession?.teleportTo(celestialId, transform);
  }

  async disconnect(): Promise<void> {
    if (this.personaSession) {
      await this.personaSession.disconnect();
      this.personaSession = null;
    }
    AuthService.clearToken();
    this._authToken = null;
    this._userId = null;
    this.setState(ConnectionState.Disconnected);
  }
}
