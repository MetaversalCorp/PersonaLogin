import { Session } from "../base/Session.js";
import { ConnectionState, PersonaInfo } from "../types/index.js";
import { PersonaPuppet } from "../avatar/PersonaPuppet.js";
import type { PersonaSession } from "../client/PersonaSession.js";
import { ProximityAudioManager } from "../audio/ProximityAudioManager.js";
import { AudioVisualizer } from "../client/AudioVisualizer.js";

/**
 * InWorldSession - integrates the active persona with the RP1 world environment.
 * Manages the PersonaPuppet avatar, world-level event handling, and proximity
 * audio playback via ProximityAudioManager.
 */
export class InWorldSession extends Session {
  private personaInfo: PersonaInfo;
  private puppet: PersonaPuppet | null = null;
  readonly personaSession: PersonaSession;
  private audioManager: ProximityAudioManager | null = null;
  private visualizer: AudioVisualizer | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pTime: any = null;

  constructor(personaInfo: PersonaInfo, personaSession: PersonaSession) {
    super();
    this.personaInfo = personaInfo;
    this.personaSession = personaSession;
  }

  get avatar(): PersonaPuppet | null {
    return this.puppet;
  }

  /** Returns the active ProximityAudioManager, or null before connect(). */
  get audio(): ProximityAudioManager | null {
    return this.audioManager;
  }

  async connect(): Promise<void> {
    this.setState(ConnectionState.EnteringWorld);

    this.puppet = new PersonaPuppet(this.personaInfo, this);
    await this.puppet.spawn();

    // Start proximity audio: receives encoded audio from the server and plays
    // it back through the local Web Audio API (AudioContext).
    const pLnG = this.personaSession.pLnGClient;
    if (pLnG) {
      this.audioManager = new ProximityAudioManager(pLnG);
      this.audioManager.start();

      // Attach the waveform visualizer if the container element is present
      const vizContainer = document.getElementById('audio-visualizer-container');
      if (vizContainer) {
        this.visualizer = new AudioVisualizer(vizContainer);
        this.visualizer.attachAudioSource(this.audioManager);
      }
    } else {
      console.warn('[InWorldSession] pLnGClient unavailable; proximity audio disabled');
    }

    // Open the Time model and attach for periodic tick notifications.
    // pTime sends onNotice() callbacks on every internal tick, which we use to
    // drive throttled avatar-position updates (replacing the non-ticking pRPersona).
    const pClient = pLnG?.pClient ?? null;
    this.pTime = pClient?.Time_Open?.() ?? null;
    if (this.pTime) {
      this.pTime.Attach(this);
      console.log('[InWorldSession] pTime opened and attached for tick-driven avatar updates');
    } else {
      console.warn('[InWorldSession] pTime unavailable; avatar updates will not fire');
    }

    this.setState(ConnectionState.InWorld);
  }

  async disconnect(): Promise<void> {
    if (this.pTime) {
      this.pTime.Detach(this);
      this.pTime = null;
    }

    if (this.visualizer) {
      this.visualizer.dispose();
      this.visualizer = null;
    }

    if (this.audioManager) {
      this.audioManager.stop();
      this.audioManager = null;
    }

    if (this.puppet) {
      await this.puppet.despawn();
      this.puppet = null;
    }
    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Called by pTime on each internal tick when this session is attached via
   * `pTime.Attach(this)`. Delegates to PersonaSession's onNotice() handler
   * so avatar-update callbacks fire within the MVRP event loop (not from
   * setInterval or manual calls).
   */
  public onNotice(): void {
    try {
      this.personaSession.onNotice();
    } catch (err) {
      console.error('[InWorldSession] onNotice delegation error:', err);
    }
  }

  public teleportTo(celestialId: string, position: { x: number; y: number; z: number }): void {
    if (!this.personaSession || !this.personaSession.pRPersona) {
      console.error('[InWorldSession] No PersonaSession or pRPersona for teleport');
      return;
    }

    console.log(`[InWorldSession] Sending UPDATE to reposition to ${celestialId}:`, position);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pRPersona = this.personaSession.pRPersona as any;

      const tmStamp: number = typeof pRPersona.pTime === 'number' ? pRPersona.pTime : Date.now();
      const updatePayload = {
        tmStamp,
        pState: {
          bControl: 0,
          bVolume: 0,
          wFlag: 0,
          bSerial_A: 0,
          bSerial_B: 0,
          wOrder: 0,
          bCoordSys: 156, // Universal coordinate system (matches RP1Demo PersonaPuppet)
          pPosition_Head: {
            pParent: {
              twObjectIx: Number(celestialId),
              wClass: 71, // MapModelType.Celestial
            },
            pRelative: {
              vPosition: {
                dX: position.x,
                dY: position.y,
                dZ: position.z,
              },
            },
          },
          pRotation_Head: {
            dwV: pRPersona.Quat_Encode([0.7071068, 0, 0, 0.7071068]),
          },
          pRotation_Body: {
            dwV: pRPersona.Quat_Encode([0.7071068, 0, 0, 0.7071068]),
          },
          pPosition_Hand_Left: {
            dwV: pRPersona.Vect_Encode([-0.2, -0.6, -0.1]),
          },
          pRotation_Hand_Left: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          pPosition_Hand_Right: {
            dwV: pRPersona.Vect_Encode([0.2, -0.6, -0.1]),
          },
          pRotation_Hand_Right: {
            dwV: pRPersona.Quat_Encode([0, 0, 0, 1]),
          },
          bHand_Left: Array.from(new Uint8Array(6)),   // Default neutral hand grip (all zeros)
          bHand_Right: Array.from(new Uint8Array(6)),  // Default neutral hand grip (all zeros)
          bFace: [24, 23, 22, 21],                     // Default neutral face expression
        },
        wSamples: 0,
        wCodec: 0,
        wSize: 0,
        abData: new Uint8Array(0),
      };

      console.log('[InWorldSession] Calling pRPersona.Send("UPDATE", ...)');
      pRPersona.Send('UPDATE', updatePayload);
      console.log('[InWorldSession] UPDATE sent successfully');
    } catch (err) {
      console.error('[InWorldSession] UPDATE Send failed:', err);
      throw err;
    }
  }
}
