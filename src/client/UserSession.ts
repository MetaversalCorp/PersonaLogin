import { Session } from '../base/Session.js';
import { ConnectionState } from '../types/index.js';
import { getPFabric, LnGUser, LnGPersona } from '../mv/LnG.js';
import { PersonaSession } from './PersonaSession.js';
import type { PersonaTransform } from '../avatar/PersonaPuppet.js';

/**
 * Wraps a model's Send() call in a Promise using the callback pattern required
 * by the MV server action protocol.
 *
 * @param pModel    The model object (e.g. pRUser) with a Send() method.
 * @param sAction   The action name (e.g. 'RPERSONA_OPEN').
 * @param pData     Request fields to merge into pIAction.pRequest.
 * @param callback  Called with the completed pIAction; may be async and should
 *                  call pIAction.GetResult() to check for errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promisifyAction<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pModel: any,
  sAction: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (pIAction: any) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = pModel.Send(sAction, pData, null, async (pIAction: any) => {
      try {
        resolve(await callback(pIAction));
      } catch (err) {
        reject(err);
      }
    });
    if (!sent) {
      reject(new Error(`[promisifyAction] Failed to send action '${sAction}'`));
    }
  });
}

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
   * Creates a PersonaSession and initializes the friends service.
   */
  async pickPersona(personaId: string): Promise<void> {
    const persona = this._ownPersonaList.find((p) => p.id === personaId);
    this._personaSession = new PersonaSession(
      personaId,
      this.pLnG,
      persona?.firstName,
      persona?.lastName
    );
    await this._personaSession.connect();
    this._initFriendsService();
  }

  /**
   * Create a new persona via the RPERSONA_OPEN server action on the RUser model,
   * then enter the world with that persona.
   */
  async createPersona(firstName: string, lastName?: string): Promise<void> {
    const pLnG = this.pLnG;
    let personaId: string;

    if (pLnG && this._pRUser) {
      personaId = await promisifyAction(
        this._pRUser,
        'RPERSONA_OPEN',
        {
          // qwMapIx_Home: 0 — server assigns a default home map for the new persona.
          qwMapIx_Home: 0,
          pName: {
            wsForename: firstName,
            wsSurname: lastName ?? '',
            // dwSequence: 0 — server assigns the disambiguation sequence number.
            dwSequence: 0,
          },
          pPosition: {
            // twObjectIx/wClass: 0 — server assigns the starting celestial object.
            pParent: { twObjectIx: 0, wClass: 0 },
            pRelative: { vPosition: { dX: 0, dY: 0, dZ: 0 } },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (pIAction: any) => {
          const result = pIAction.GetResult();
          if (result !== 0) {
            throw new Error(`Persona creation failed (error ${result})`);
          }
          const twRPersonaIx = pIAction.pResponse?.twRPersonaIx;
          if (!twRPersonaIx) {
            throw new Error('Persona creation failed: server returned no persona ID');
          }
          return String(twRPersonaIx);
        }
      );
    } else {
      personaId = `${firstName}${lastName ? `_${lastName}` : ''}_${Date.now()}`;
    }

    this._personaSession = new PersonaSession(personaId, pLnG, firstName, lastName);
    await this._personaSession.connect();
    this._initFriendsService();
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