import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { InWorldSession } from "./InWorldSession.js";

/**
 * PersonaSession - manages a pRPersona instance and transitions to InWorldSession.
 * Integrates with @metaversalcorp/mvrp for persona protocol handling.
 */
export class PersonaSession extends Session {
  readonly personaId: string;
  private authToken: string;
  private inWorldSession: InWorldSession | null = null;
  private _personaInfo: PersonaInfo | null = null;

  // Placeholder for pRPersona instance from @metaversalcorp/mvrp
  // In production: private pRPersona: import('@metaversalcorp/mvrp').RPersona;
  private pRPersona: unknown = null;

  constructor(personaId: string, authToken: string) {
    super();
    this.personaId = personaId;
    this.authToken = authToken;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    // Placeholder: instantiate pRPersona from @metaversalcorp/mvrp
    // this.pRPersona = new RPersona({ personaId: this.personaId, authToken: this.authToken });
    // await this.pRPersona.connect();
    this.pRPersona = { personaId: this.personaId };

    this._personaInfo = new PersonaInfo(
      this.personaId,
      `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );

    this.inWorldSession = new InWorldSession(this._personaInfo);
    await this.inWorldSession.connect();

    this.setState(ConnectionState.InWorld);
  }

  async disconnect(): Promise<void> {
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }

    // Placeholder: this.pRPersona?.disconnect();
    this.pRPersona = null;
    this._personaInfo = null;

    this.setState(ConnectionState.Disconnected);
  }
}
