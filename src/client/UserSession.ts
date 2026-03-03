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
  private _personaSession: PersonaSession | null = null;
  private _pRUser: unknown = null;
  private _ownPersonaList: LnGPersona[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _friendsService: any = null;

  constructor(user: LnGUser) {
    super();
    this.user = user;
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
  private get pLnG(): any {
    return getPFabric()?.pLnG ?? null;
  }

  /**
   * Initialize the UserSession by opening the RUser model via pLnG.
   * Reads the user's persona list from pRUser.ownPersonaList.
   */
  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    const pLnG = this.pLnG;
    if (pLnG) {
      const pRUser = pLnG.Model_Open('RUser', this.user.id);
      if (pRUser) {
        this._pRUser = pRUser;
        this._ownPersonaList = [...(pRUser.ownPersonaList ?? [])];
      }
    } else {
      this._ownPersonaList = [...this.user.personas];
    }

    this.setState(ConnectionState.Connected);
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

    const pLnG = this.pLnG;
    if (pLnG && this._pRUser) {
      pLnG.Model_Close(this._pRUser);
    }
    this._pRUser = null;
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
    this._personaSession = new PersonaSession(id, this.pLnG, firstName, lastName);
    void this._personaSession.connect().then(() => {
      this._initFriendsService();
      resolve();
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