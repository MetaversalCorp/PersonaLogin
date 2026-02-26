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

  // Placeholder for rPersona instance from @metaversalcorp/mvrp
  // In production: private rPersona: import('@metaversalcorp/mvrp').RPersona;
  private rPersona: unknown = null;

  constructor(personaInfo: PersonaInfo) {
    super(personaInfo);
    this.flagQueue = new FlagQueue();
  }

  async spawn(): Promise<void> {
    if (this._spawned) return;

    // Placeholder: initialize rPersona and attach to world scene
    // this.rPersona = new RPersona({ personaId: this.personaId });
    // await this.rPersona.spawn(this.transform);
    this.rPersona = { personaId: this.personaId };

    this._spawned = true;
    console.log(`[PersonaPuppet] Spawned persona ${this.personaId} as "${this.displayName}"`);
  }

  async despawn(): Promise<void> {
    if (!this._spawned) return;

    this.flagQueue.clear();

    // Placeholder: this.rPersona.Send({ type: "despawn" });
    this.rPersona = null;
    this._spawned = false;

    console.log(`[PersonaPuppet] Despawned persona ${this.personaId}`);
  }

  /**
   * Move the avatar to a new world position.
   * Calls rPersona.Send() with transform data.
   */
  moveTo(transform: PersonaTransform): void {
    if (!this._spawned) return;
    this.transform = { ...transform };

    // Placeholder: this.rPersona.Send({ type: "move", ...this.transform });
    console.log(`[PersonaPuppet] moveTo`, this.transform);
  }

  /**
   * Trigger an avatar animation by name.
   * Calls rPersona.Send() with animation flag.
   */
  playAnimation(animationName: string): void {
    if (!this._spawned) return;

    this.flagQueue.enqueue(animationName);

    // Placeholder: this.rPersona.Send({ type: "animate", animation: animationName });
    console.log(`[PersonaPuppet] playAnimation "${animationName}"`);
  }

  /**
   * Stop a playing animation.
   */
  stopAnimation(animationName: string): void {
    if (!this._spawned) return;

    this.flagQueue.dequeue(animationName);

    // Placeholder: this.rPersona.Send({ type: "stopAnimation", animation: animationName });
    console.log(`[PersonaPuppet] stopAnimation "${animationName}"`);
  }

  getTransform(): PersonaTransform {
    return { ...this.transform };
  }
}
