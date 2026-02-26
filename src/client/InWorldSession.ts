import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { PersonaPuppet } from "../avatar/PersonaPuppet.js";

/**
 * InWorldSession - integrates the active persona with the RP1 world environment.
 * Manages the PersonaPuppet avatar and world-level event handling.
 */
export class InWorldSession extends Session {
  private personaInfo: PersonaInfo;
  private puppet: PersonaPuppet | null = null;

  constructor(personaInfo: PersonaInfo) {
    super();
    this.personaInfo = personaInfo;
  }

  get avatar(): PersonaPuppet | null {
    return this.puppet;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.EnteringWorld);

    this.puppet = new PersonaPuppet(this.personaInfo);
    await this.puppet.spawn();

    this.setState(ConnectionState.InWorld);
  }

  async disconnect(): Promise<void> {
    if (this.puppet) {
      await this.puppet.despawn();
      this.puppet = null;
    }
    this.setState(ConnectionState.Disconnected);
  }
}
