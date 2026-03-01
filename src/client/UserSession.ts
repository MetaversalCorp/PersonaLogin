import { Session } from "../base/Session.js";
import { ConnectionState } from "../types/index.js";
import type { LnGUser, LnGPersona } from "../mv/LnG.js";
import { getPFabric } from "../mv/LnG.js";
import { PersonaSession } from "./PersonaSession.js";
import type { PersonaTransform } from "../avatar/PersonaPuppet.js";

// MV is a global namespace populated by side-effect imports in LnG.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const MV: any;

/**
 * UserSession - owns the MVRP__RUser model returned by MV LnG and coordinates
 * persona selection and session management.
 *
 * After construction, call pickPersona(id) or createPersona(firstName, lastName)
 * to enter the world with a specific persona.
 */
export class UserSession extends Session {
  readonly username: string;
  readonly userId: string;

  /** All personas associated with this account (ownPersonaList tracker). */
  readonly ownPersonaList: LnGPersona[];

  private personaSession: PersonaSession | null = null;

  // MV.MVRP.Fabric.FRIENDS instance initialized after persona entry.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp_fabric').FRIENDS
  private friendsManager: unknown = null;
  private friendsReadyListener: object | null = null;

  constructor(user: LnGUser) {
    super();
    this.username = user.displayName;
    this.userId = user.id;
    this.ownPersonaList = [...user.personas];
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.Connecting);
    // Real implementation (requires @metaversalcorp/mvmf at runtime):
    // await pLnG instance readiness check here.
    this.setState(ConnectionState.Connected);
  }

  /**
   * Select an existing persona by ID and enter the world.
   * Creates a PersonaSession and transitions state to InWorld.
   * Initializes the friends service (MV.MVRP.Fabric.FRIENDS) via pFabric.GetLnG("friends").
   */
  async pickPersona(id: string): Promise<void> {
    this.setState(ConnectionState.EnteringWorld);
    this.personaSession = new PersonaSession(id);
    await this.personaSession.connect();

    const pFabric = getPFabric();
    if (pFabric) {
      try {
        const FRIENDS_TIMEOUT_MS = 5000;
        const friendsLnG = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            pFabric.Detach(listener);
            reject(new Error("[UserSession] Timed out waiting for friends service"));
          }, FRIENDS_TIMEOUT_MS);

          // Listener stays attached until the LnG becomes available; once it
          // does, we detach, clear the timer, and resolve the promise.
          const listener = {
            onReadyState: () => {
              const lnG = pFabric.GetLnG("friends");
              if (lnG) {
                clearTimeout(timer);
                pFabric.Detach(listener);
                resolve(lnG);
              }
            },
          };
          pFabric.Attach(listener);

          // Resolve immediately if the service LnG is already available.
          const lnG = pFabric.GetLnG("friends");
          if (lnG) {
            clearTimeout(timer);
            pFabric.Detach(listener);
            resolve(lnG);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.friendsManager = new MV.MVRP.Fabric.FRIENDS(friendsLnG, id);
        this.friendsReadyListener = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onReadyState: (pNotice: any) => {
            if (pNotice.pEmitter !== this.friendsManager) return;
            if (pNotice.pEmitter.ReadyState() === pNotice.pEmitter.eSTATE.READY) {
              // Friends service is ready to use
            }
          },
        };
        (this.friendsManager as { Attach: (listener: object) => void }).Attach(
          this.friendsReadyListener
        );
      } catch (err) {
        console.error("[UserSession] Friends service initialization failed:", err);
      }
    }

    this.setState(ConnectionState.InWorld);
  }

  /**
   * Create a new persona and enter the world with it.
   *
   * Real implementation (requires @metaversalcorp/mvmf at runtime):
   *   const persona = await pLnG.CreatePersona(firstName, lastName);
   *   this.ownPersonaList.push(persona);
   *   await this.pickPersona(persona.id);
   */
  async createPersona(firstName: string, lastName: string): Promise<LnGPersona> {
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    // Stub: real persona creation uses @metaversalcorp/mvmf CreatePersona()
    const persona: LnGPersona = {
      id: `persona_stub_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      firstName,
      lastName,
      displayName,
    };
    this.ownPersonaList.push(persona);
    await this.pickPersona(persona.id);
    return persona;
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
    if (this.friendsManager && this.friendsReadyListener) {
      (this.friendsManager as { Detach: (listener: object) => void }).Detach(
        this.friendsReadyListener
      );
    }
    this.friendsReadyListener = null;
    this.friendsManager = null;
    this.setState(ConnectionState.Disconnected);
  }
}
