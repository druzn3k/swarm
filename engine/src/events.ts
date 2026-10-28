// A tiny synchronous event emitter replacing the old engine's use of Angular's
// $rootScope ($emit/$broadcast/$on). Like Angular, an exception thrown by one
// listener is caught (and reported to onListenerError) and does not stop the
// other listeners or the code that emitted the event.

export type Listener<T> = (payload: T) => void;

/** Payload type of event `K`; events not declared in `E` carry `any`. */
export type EventPayload<E, K> = K extends keyof E ? E[K] : any;

export class EventEmitter<E extends {} = {}> {
  private listeners: { [name: string]: Listener<any>[] } = {};

  /**
   * @param onListenerError called with exceptions thrown by listeners. Angular
   * logged these; by default we ignore them.
   */
  constructor(public onListenerError: (event: string, error: unknown) => void = () => {}) {}

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends string>(name: K, fn: Listener<EventPayload<E, K>>): () => void {
    (this.listeners[name] ??= []).push(fn);
    return () => {
      const list = this.listeners[name];
      const i = list ? list.indexOf(fn) : -1;
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends string>(name: K, payload?: EventPayload<E, K>): void {
    for (const fn of [...(this.listeners[name] ?? [])]) {
      try {
        fn(payload);
      } catch (e) {
        this.onListenerError(name, e);
      }
    }
  }
}
