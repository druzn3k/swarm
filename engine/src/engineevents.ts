// The events the engine emits (formerly Angular $rootScope events).
import { EventEmitter } from "./events";
import type { Achievement } from "./achievement";
import type { CommandEvent } from "./command";
import type { Session } from "./session";

export interface EngineEvents {
  /** a player command ran (commands.ts). Statistics and achievements listen to this. */
  command: CommandEvent;
  /** the first purchase of a unit/upgrade (statistics.ts) */
  buyFirst: CommandEvent;
  /** an achievement was earned */
  achieve: Achievement;
  /** session.reset() */
  reset: { session: Session };
  /** the session was written to storage */
  save: Session;
  /** writing the session to storage threw */
  "save:failed": { error: unknown; session: Session };
  // Achievements also listen for UI events: 'changelog', 'import'
  // ({success:true}), 'achieveclick' ({name:'clickme'}), 'konami',
  // 'debugPage', 'achieve-publictest1', 'therightquestion'. Any other event
  // name is allowed, with an untyped payload.
}

export type EngineEventEmitter = EventEmitter<EngineEvents>;

export function createEventEmitter(
  onListenerError?: (event: string, error: unknown) => void
): EngineEventEmitter {
  return new EventEmitter<EngineEvents>(onListenerError);
}
