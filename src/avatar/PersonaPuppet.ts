import { PersonaInfo } from "../types/index.js";
import { Avatar } from "./Avatar.js";
import { FlagQueue } from "../utils/FlagQueue.js";

export interface PersonaTransform {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/**
 * PersonaPuppet - avatar controller that drives the rPersona via Send() calls.
 * Integrates with @metaversalcorp/mvrp RPersona protocol for avatar animation
 * and world interaction.
 */
export class PersonaPuppet extends Avatar {
  private flagQueue: FlagQueue;
  private transform: PersonaTransform = { x: 0, y: 0, z: 0, rotY: 0 };

  // rPersona instance from @metaversalcorp/mvrp.
  // Type is kept as `unknown` because the private package cannot be resolved
  // in open-source builds; cast to the real type when the package is available.
  // import('@metaversalcorp/mvrp').RPersona
  private rPersona: unknown = null;

  constructor(personaInfo: PersonaInfo) {
    super(personaInfo);
    this.flagQueue = new FlagQueue();
  }

  async spawn(): Promise<void> {
    if (this._spawned) return;

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // const { RPersona } = await import('@metaversalcorp/mvrp');
    // this.rPersona = new RPersona({ personaId: this.personaId });
    // await (this.rPersona as RPersona).spawn(this.transform);
    this.rPersona = { personaId: this.personaId };

    this._spawned = true;
    console.log(`[PersonaPuppet] Spawned persona ${this.personaId} as "${this.displayName}"`);
  }

  async despawn(): Promise<void> {
    if (!this._spawned) return;

    this.flagQueue.clear();

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // (this.rPersona as RPersona).Send({ type: 'despawn' });
    this.rPersona = null;
    this._spawned = false;

    console.log(`[PersonaPuppet] Despawned persona ${this.personaId}`);
  }

  /**
   * Move the avatar to a new world position and transmit it to the service.
   * @param celestialId - The pParent celestial body identifier; defaults to '0'.
   */
  moveTo(transform: PersonaTransform, celestialId: string = '0'): void {
    if (!this._spawned) return;
    this.transform = { ...transform };
    console.log(`[PersonaPuppet] moveTo`, this.transform);
    this.sendUpdate(celestialId);
  }

  /**
   * Encode current avatar position/rotation and send an UPDATE to the persona service.
   * Calls rPersona.Send('UPDATE', ...) with position and rotation state.
   */
  sendUpdate(celestialId: string): void {
    if (!this._spawned) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rPersona = this.rPersona as any;
    if (!rPersona?.Send) return;

    const tmStamp = Date.now();
    const sinHalf = Math.sin(this.transform.rotY / 2);
    const cosHalf = Math.cos(this.transform.rotY / 2);
    const rotDwV = rPersona.Quat_Encode([0, sinHalf, 0, cosHalf]);

    rPersona.Send('UPDATE', {
      tmStamp,
      pState: {
        pPosition_Head: {
          pParent: { twObjectIx: celestialId, wClass: 0 },
          pRelative: {
            vPosition: {
              dX: this.transform.x,
              dY: this.transform.y,
              dZ: this.transform.z,
            },
          },
        },
        pRotation_Head: { dwV: rotDwV },
        pRotation_Body: { dwV: rotDwV },
      },
    });
  }

  /**
   * Trigger an avatar animation by name.
   * Calls rPersona.Send() with animation flag.
   */
  playAnimation(animationName: string): void {
    if (!this._spawned) return;

    this.flagQueue.enqueue(animationName);

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // (this.rPersona as RPersona).Send({ type: 'animate', animation: animationName });
    console.log(`[PersonaPuppet] playAnimation "${animationName}"`);
  }

  /**
   * Stop a playing animation.
   */
  stopAnimation(animationName: string): void {
    if (!this._spawned) return;

    this.flagQueue.dequeue(animationName);

    // Real call (requires @metaversalcorp/mvrp at runtime):
    // (this.rPersona as RPersona).Send({ type: 'stopAnimation', animation: animationName });
    console.log(`[PersonaPuppet] stopAnimation "${animationName}"`);
  }

  getTransform(): PersonaTransform {
    return { ...this.transform };
  }
}
