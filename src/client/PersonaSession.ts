import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { InWorldSession } from "./InWorldSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";


/**
 * PersonaSession - manages a pRPersona instance and transitions to InWorldSession.
 * Integrates with @metaversalcorp/mvrp for persona protocol handling.
 *
 * Authentication is handled by MV LnG upstream; PersonaSession receives only
 * the persona ID selected via UserSession.pickPersona().
 */
export class PersonaSession extends Session {
  readonly personaId: string;
  private inWorldSession: InWorldSession | null = null;
  private _personaInfo: PersonaInfo | null = null;

  // pRPersona instance from @metaversalcorp/mvrp.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp').RPersona
  private _pRPersona: unknown = null;

  // pLnG instance passed from UserSession via constructor; used to open/close
  // the RPersona model and must outlive the PersonaSession.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pLnG: any;

  private _firstName: string | undefined;
  private _lastName: string | undefined;

  constructor(personaId: string, pLnG: any, firstName?: string, lastName?: string) {
    super();
    this.personaId = personaId;
    this.pLnG = pLnG;
    this._firstName = firstName;
    this._lastName = lastName;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  get pRPersona(): unknown {
    return this._pRPersona;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    // Use the pLnG instance passed from UserSession to open the RPersona model.
    if (!this.pLnG) {
      throw new Error(`[PersonaSession] pLnG is not available; cannot open RPersona model`);
    }
    const pRPersona = this.pLnG.Model_Open('RPersona', this.personaId);
    if (!pRPersona) {
      throw new Error(`[PersonaSession] Model_Open('RPersona', '${this.personaId}') returned null`);
    }
    this._pRPersona = pRPersona;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._pRPersona as any).Attach(this);
    this.enterPersona();

    this._personaInfo = new PersonaInfo(
      this.personaId,
      [this._firstName, this._lastName].filter(Boolean).join(" ") || `Persona_${this.personaId}`,
      "",
      "default_world",
      "default_region"
    );

    this.inWorldSession = new InWorldSession(this._personaInfo, this);
    await this.inWorldSession.connect();

    this.setState(ConnectionState.InWorld);
  }

  /**
   * Enter the world with this persona by sending RPERSONA_ENTER to the persona model.
   * PersonaPuppet then handles ongoing position updates.
   */
  enterPersona(): void {
    if (!this._pRPersona) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = (this._pRPersona as any).Send('RPERSONA_ENTER', {
      twRPersonaIx: this.personaId,
    });
    if (!sent) {
      console.warn(`[PersonaSession] RPERSONA_ENTER failed to send for persona ${this.personaId}`);
    }
  }

  /** Relay a teleport command to the active persona puppet. */
  teleportTo(
    celestialId: string,
    position: Omit<PersonaTransform, "rotY">
  ): void {
    if (!this.inWorldSession?.avatar) return;

    const transform: PersonaTransform = { ...position, rotY: 0 };
    this.inWorldSession.avatar.moveTo(transform, celestialId);
  }

  async disconnect(): Promise<void> {
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }

    // Close the RPersona model via pLnG when available (requires @metaversalcorp/mvrp at runtime).
    if (this.pLnG && this._pRPersona) {
      this.pLnG.Model_Close(this._pRPersona);
    }
    this._pRPersona = null;
    this.pLnG = null;
    this._personaInfo = null;

    this.setState(ConnectionState.Disconnected);
  }
}
