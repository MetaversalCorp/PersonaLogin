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
  private pRPersona: unknown = null;

  constructor(personaId: string) {
    super();
    this.personaId = personaId;
  }

  get personaInfo(): PersonaInfo | null {
    return this._personaInfo;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    // Real instantiation (requires @metaversalcorp/mvrp at runtime):
    // const { RPersona } = await import('@metaversalcorp/mvrp');
    // this.pRPersona = new RPersona({ personaId: this.personaId });
    // await (this.pRPersona as RPersona).connect();
    // LnG manages session auth; RPersona receives only the persona ID.
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

  /** Relay a teleport command to the active persona puppet. */
  teleportTo(
    celestialId: string,
    position: Omit<PersonaTransform, "rotY">
  ): void {
    if (!this.inWorldSession?.avatar) return;

    const transform: PersonaTransform = { ...position, rotY: 0 };
    this.inWorldSession.avatar.moveTo(transform);

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // (this.pRPersona as RPersona).Send({ type: 'teleport', celestialId, ...position });
    console.log(`[PersonaSession] teleportTo ${celestialId}`, position);
    // pRPersona is used for the real Send() call above; kept for structural parity
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.pRPersona;
  }

  async disconnect(): Promise<void> {
    if (this.inWorldSession) {
      await this.inWorldSession.disconnect();
      this.inWorldSession = null;
    }

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // await (this.pRPersona as RPersona).disconnect();
    this.pRPersona = null;
    this._personaInfo = null;

    this.setState(ConnectionState.Disconnected);
  }
}
