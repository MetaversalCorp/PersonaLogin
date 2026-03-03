import { Session } from '../base/Session.js';
import { ConnectionState } from '../types/index.js';
import { getPFabric, LnGUser, LnGPersona } from '../mv/LnG.js';
import { PersonaSession } from './PersonaSession.js';
import type { PersonaTransform } from '../avatar/PersonaPuppet.js';

/**
 * UserSession — manages the authenticated user's RUser model and delegates
 * persona lifecycle to PersonaSession.
 *
 * Integrates with @metaversalcorp/mvrp for user/persona protocol handling via
 * the pLnG instance provided by the MSF fabric (getPFabric().pLnG).
 */
export class UserSession extends Session {
  private readonly user: LnGUser;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _loginClient: any;
  private _personaSession: PersonaSession | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly pRUser: any;
  private _ownPersonaList: LnGPersona[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _friendsService: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(user: LnGUser, loginClient: any) {
    super();
    this.user = user;
    this._loginClient = loginClient;

    // Model_Open + Attach happen IMMEDIATELY in constructor (RP1Demo pattern)
    this.pRUser = loginClient.pLnG.Model_Open('RUser', user.id);
    this.pRUser.Attach(this);
  }

  get userId(): string {
    return this.user.id;
  }

  get username(): string {
    return this.user.displayName;
  }

  get ownPersonaList(): LnGPersona[] {
    return this._ownPersonaList;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get pLnG(): any {
    return this._loginClient.pLnG;
  }

  /**
   * Initialize the UserSession connection state.
   * Model_Open + Attach already happened in constructor.
   */
  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);
    this.setState(ConnectionState.Connected);
  }

  /**
   * Called by MV library when pRUser ready state changes.
   * Enumerates existing personas when RUser is RECOVERED.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onReadyState(pNotice: any): void {
    if (pNotice.pCreator !== this.pRUser) return;

    const readyState = this.pRUser.ReadyState?.();

    console.log('[UserSession] onReadyState fired, readyState:', readyState);

    if (this.pRUser.eSTATE?.RECOVERED !== undefined && readyState === this.pRUser.eSTATE.RECOVERED) {
      console.log('[UserSession] RUser state is RECOVERED, enumerating personas...');
      this.enumeratePersonas();
    }
  }

  /**
   * Enumerate existing personas using Child_Enum like RP1Demo does.
   */
  private enumeratePersonas(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enumCallback = (rPersona: any): boolean => {
      const personaId = rPersona.twRPersonaIx;
      const personaName = rPersona.pName;
      const displayName = [personaName?.wsForename, personaName?.wsSurname]
        .filter(Boolean)
        .join(' ') || `Persona_${personaId}`;

      const persona: LnGPersona = {
        id: String(personaId),
        displayName,
        firstName: personaName?.wsForename || '',
        lastName: personaName?.wsSurname || '',
      };

      this._ownPersonaList.push(persona);
      console.log(`[UserSession] Found persona: ${displayName} (ID: ${personaId})`);

      return true; // Continue enumeration
    };

    try {
      this.pRUser.Child_Enum('RPersona', this, enumCallback);
      console.log(`[UserSession] Persona enumeration complete. Found ${this._ownPersonaList.length} personas`);
    } catch (err) {
      console.error('[UserSession] Child_Enum failed:', err);
    }
  }

  /**
   * Enter the world with the selected persona.
   */
  async pickPersona(personaId: string): Promise<void> {
    const persona = this._ownPersonaList.find((p) => p.id === personaId);
    return new Promise<void>((resolve) =>
      this.setupPersonaSession(personaId, resolve, persona?.firstName, persona?.lastName)
    );
  }

  /**
   * Close the active PersonaSession and the RUser model.
   */
  async disconnect(): Promise<void> {
    this._friendsService = null;

    if (this._personaSession) {
      await this._personaSession.disconnect();
      this._personaSession = null;
    }

    if (this.pRUser) {
      this.pRUser.Detach(this);
    }
    this._ownPersonaList = [];

    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Relay a teleport command to the active PersonaSession.
   */
  teleportTo(celestialId: string, position: Omit<PersonaTransform, 'rotY'>): void {
    this._personaSession?.teleportTo(celestialId, position);
  }

  /**
   * Set up a PersonaSession for the given persona ID,
   * then resolve the enclosing promise once the session is connected.
   */
  private setupPersonaSession(
    id: string,
    resolve: (value: void | PromiseLike<void>) => void,
    firstName?: string,
    lastName?: string
  ): void {
    // Prefer pLnG exposed by the RUser model; fall back to the fabric singleton.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pLnG = (this.pRUser as any)?.pLnG ?? getPFabric()?.pLnG;
    this._personaSession = new PersonaSession(id, pLnG, this.pRUser, firstName, lastName);
    void this._personaSession.connect().then(() => {
      this._initFriendsService();
      resolve();
    }).catch((err) => {
      console.error('[UserSession] PersonaSession.connect failed:', err);
      throw err;
    });
  }

  /**
   * Initialize the friends service via pFabric.GetLnG("friends").
   * Uses the Attach/onReadyState event pattern to wait for readiness.
   */
  private _initFriendsService(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pFabric: any = getPFabric();
    if (!pFabric) return;

    const friendsLnG = pFabric.GetLnG('friends');
    if (!friendsLnG) return;

    if (friendsLnG.IsReady()) {
      this._friendsService = friendsLnG;
      return;
    }

    const listener = {
      onReadyState: () => {
        if (friendsLnG.IsReady()) {
          pFabric.Detach(listener);
          this._friendsService = friendsLnG;
        }
      },
    };
    pFabric.Attach(listener);
  }
}