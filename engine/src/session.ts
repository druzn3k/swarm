// Port of services/session.coffee: Session (game state + save encode/decode).
//
// Save format (unchanged, byte-compatible with the old game):
//   btoa(version) + "|" + btoa("Cheater :(\n\n") + LZString.compressToBase64(JSON.stringify(state))
import * as _ from "lodash";
import Decimal from "decimal.js";
import LZString from "lz-string";
import { atob, btoa } from "./util";
import { compressToBase64 } from "./lzbase64";
import type { Clock, GameState } from "./game";
import type { EngineEventEmitter } from "./engineevents";

/** The old game's version, written into saves. */
export const DEFAULT_VERSION = "1.1.17";
/** env.saveId of the old production build */
export const DEFAULT_SAVE_ID = "v0.2";

const PREFIX = btoa("Cheater :(\n\n");
// The encoded string starts with an encoded version number. Older savestates
// might not, so if this is missing, no biggie.
const VERSION_DELIM = "|";

/** Key-value storage for saves (localStorage-like). */
export interface SaveStorage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** In-memory SaveStorage. */
export class MemoryStorage implements SaveStorage {
  data: { [key: string]: string } = {};
  getItem(key: string): string | null {
    return key in this.data ? this.data[key] : null;
  }
  setItem(key: string, value: string): void {
    this.data[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.data[key];
  }
}

export interface SessionState extends GameState {
  unittypes: { [name: string]: any };
  date: {
    started: Date;
    restarted?: Date;
    saved?: Date;
    loaded?: Date;
    reified: Date;
    closed?: Date;
    [key: string]: any;
  };
  options: any;
  upgrades: { [name: string]: any };
  statistics: any;
  achievements: { [name: string]: number };
  watched: { [name: string]: boolean | number };
  skippedMillis: number;
  version?: { started?: string; saved?: string };
  kongregate?: boolean;
}

export interface SessionOptions {
  /** current time; defaults to the system clock */
  clock?: Clock;
  storage?: SaveStorage;
  events?: EngineEventEmitter;
  /** base storage key (old env.saveId). Default "v0.2" */
  saveId?: string;
  /** appends "-kongregate" to the save id and sets state.kongregate */
  isKongregate?: boolean;
  /** game version written to saves. Default "1.1.17" */
  version?: string;
  /** old env.isOffline: no heartbeats (saves still happen) */
  isOffline?: boolean;
  /** called when storage.setItem throws (the old engine logged it) */
  onError?: (message: string, error: unknown) => void;
}

export class Session {
  id!: string;
  heartbeatId!: string;
  state!: SessionState;
  _exportCache?: string;

  clock: Clock;
  storage: SaveStorage;
  events?: EngineEventEmitter;
  saveIdBase: string;
  isKongregate: boolean;
  version: string;
  isOffline: boolean;
  onError: (message: string, error: unknown) => void;

  constructor(opts: SessionOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.storage = opts.storage ?? new MemoryStorage();
    this.events = opts.events;
    this.saveIdBase = opts.saveId ?? DEFAULT_SAVE_ID;
    this.isKongregate = opts.isKongregate ?? false;
    this.version = opts.version ?? DEFAULT_VERSION;
    this.isOffline = opts.isOffline ?? false;
    this.onError = opts.onError ?? (() => {});
    this.reset();
    if (!this.id) throw new Error("no save id defined");
  }

  /** saveId factory: env.saveId plus "-kongregate" on kongregate */
  get saveId(): string {
    const suffix = this.isKongregate ? "-kongregate" : "";
    return `${this.saveIdBase}${suffix}`;
  }

  reset(): void {
    const now = this.clock();
    this.id = this.saveId;
    this.heartbeatId = `${this.id}:heartbeat`;
    this.state = {
      unittypes: {},
      date: {
        started: now,
        restarted: now,
        saved: now,
        loaded: now,
        reified: now,
        closed: now,
      },
      options: {},
      upgrades: {},
      statistics: {},
      achievements: {},
      watched: {},
      skippedMillis: 0,
      version: {
        started: this.version,
        saved: this.version,
      },
    };
    // undefined if not isKongregate
    if (this.isKongregate) {
      this.state.kongregate = true;
    }
    this.events?.emit("reset", { session: this });
  }

  _saves(data: any = this.state, setdates: boolean = true): string {
    if (setdates) {
      data.date.saved = this.clock();
      delete data.date.loaded;
      if (data.version != null) data.version.saved = this.version;
    }
    let ret = JSON.stringify(data);
    // lz-string's compressToBase64, same output, faster
    ret = compressToBase64(ret);
    ret = PREFIX + ret;
    // version is saved separately from json in case save format changes
    ret = `${btoa(this.version)}${VERSION_DELIM}${ret}`;
    return ret;
  }
  _hasVersionHeader(encoded: string): boolean {
    return encoded.indexOf(VERSION_DELIM) >= 0;
  }
  _splitVersionHeader(encoded: string): [string | undefined, string] {
    let saveversion: string | undefined;
    if (this._hasVersionHeader(encoded)) {
      [saveversion, encoded] = encoded.split(VERSION_DELIM);
    }
    // version may be undefined
    return [saveversion, encoded];
  }
  _validateSaveVersion(saveversion: string = "0.1.0", gameversion: string = this.version): void {
    const [sM, sm] = saveversion.split(".").map((n) => parseInt(n));
    const [gM, gm] = gameversion.split(".").map((n) => parseInt(n));
    // during beta, 0.n.0 resets all games from 0.n-1.x. Don't import older games.
    if (sM === gM && gM === 0 && sm !== gm) {
      throw new Error("Beta save from different minor version");
    }
    // No importing 1.0.x games into 0.2.x. Need this for publictest.
    // Importing 0.2.x into 1.0.x is fine.
    if (sM > 0 && gM === 0) {
      throw new Error("1.0 save in 0.x game");
    }
    // 0.1.x saves are blacklisted for 1.0.x, already reset
    if (gM > 0 && sM === 0 && sm < 2) {
      throw new Error("nice try, no 0.1.x saves");
    }
    const blacklisted = [/^1\.0\.0-publictest/];
    // never blacklist the current version; also makes tests pass before we do `npm version 1.0.0`
    if (saveversion !== gameversion) {
      for (const b of blacklisted) {
        if (b.test(saveversion)) {
          throw new Error("blacklisted save version");
        }
      }
    }
  }

  _validateFormatVersion(formatversion: string, gameversion: string = this.version): void {
    const blacklisted = [/^1\.0\.0-publictest/];
    // never blacklist the current version; also makes tests pass before we do `npm version 1.0.0`
    if (formatversion !== gameversion) {
      for (const b of blacklisted) {
        if (b.test(formatversion)) {
          throw new Error("blacklisted save version");
        }
      }
    }
  }

  _loads(encoded0: string): SessionState {
    // ignore whitespace
    let encoded = encoded0.replace(/\s+/g, "");
    let saveversion: string | undefined;
    [saveversion, encoded] = this._splitVersionHeader(encoded);
    // don't compare this saveversion for validity! it's only for figuring out changing save formats.
    // (with some exceptions, like publictest.)
    encoded = encoded.substring(PREFIX.length);
    const json = LZString.decompressFromBase64(encoded);
    const ret = JSON.parse(json as string);
    // special case dates. JSON.stringify replacers and toJSON do not get along.
    for (const key of Object.keys(ret.date)) {
      ret.date[key] = new Date(ret.date[key]);
    }
    ret.date.loaded = this.clock();
    // check save version for validity
    this._validateSaveVersion(ret.version?.started);
    // prevent saves imported from publictest. easy to hack around, but good enough to deter non-cheaters.
    if (saveversion) {
      this._validateFormatVersion(atob(saveversion));
    }
    // bigdecimals. toPrecision avoids decimal.js precision errors when converting old saves.
    for (const obj of [ret.unittypes, ret.upgrades]) {
      for (const key of Object.keys(obj)) {
        let val = obj[key];
        if (_.isNumber(val)) {
          val = val.toPrecision(15);
        }
        obj[key] = new Decimal(val);
      }
    }
    return ret;
  }

  /** The current save string. Right after importSave(), this is the imported string, unchanged. */
  exportSave(): string {
    if (this._exportCache == null) {
      // this happens on page load, when we haven't saved
      this._exportCache = this._saves(undefined, false);
    }
    return this._exportCache;
  }

  exportJson(): string {
    return JSON.stringify(this.state);
  }

  importSave(encoded: string, transient: boolean = true): void {
    this.state = this._loads(encoded);
    this._exportCache = encoded;
    if (!transient) {
      this._write();
    }
  }

  _write(): void {
    // write the game in @_exportCache without building a new one. usually
    // you'll want @save() instead, but @importSave() uses this to save the
    // game without overwriting its save-time.
    let success = false;
    try {
      this.storage.setItem(this.id, this._exportCache as string);
      success = true;
    } catch (e) {
      this.onError("failed to save game", e);
      this.events?.emit("save:failed", { error: e, session: this });
    }
    if (success) {
      this.events?.emit("save", this);
    }
  }
  save(): void {
    // Careful to delete it while saving, so saves don't contain other saves recursively!
    delete this._exportCache;
    this._exportCache = this._saves();
    this._write();
  }

  _setItem(key: string, val: string): void {
    this.storage.setItem(key, val);
  }

  getStoredSaveData(id: string = this.id): string | null | undefined {
    return this.storage.getItem(id);
  }

  load(id?: string): void {
    this.importSave(this.getStoredSaveData(id) as string);
  }

  onClose(): void {
    // Don't save the whole session - this avoids overwriting everything if the save failed to load.
    this.onHeartbeat();
  }

  onHeartbeat(): boolean | void {
    if (this.isOffline) {
      return false;
    }
    // periodically save the current date, in case onClose() doesn't fire.
    // give it its own storage slot, so it saves quicker (it's more frequent than other saves)
    // and generally doesn't screw with the rest of the session. It won't be exported; that's fine.
    try {
      // (the old engine stored Date#toString(); ISO parses back the same)
      this._setItem(this.heartbeatId, this.clock().toISOString());
    } catch (e) {
      // No noisy error handling, heartbeats aren't critical.
    }
  }

  _getHeartbeatDate(): Date | undefined {
    try {
      const heartbeat = this.storage.getItem(this.heartbeatId);
      if (heartbeat) {
        return new Date(heartbeat);
      }
    } catch (e) {
      // Couldn't load heartbeat time to determine game-closed time. No biggie, continuing.
    }
    return undefined;
  }
  dateClosed(ignoreHeartbeat: boolean = false): Date {
    // don't just use date.closed - maybe the browser crashed and it didn't fire. Use the latest date possible.
    let closed = 0;
    const hb = ignoreHeartbeat ? undefined : this._getHeartbeatDate();
    if (hb) {
      closed = Math.max(closed, hb.getTime());
    }
    for (const key of Object.keys(this.state.date)) {
      if (key !== "loaded" && key !== "saved") {
        closed = Math.max(closed, this.state.date[key].getTime());
      }
    }
    return new Date(closed);
  }
  millisSinceClosed(now: Date = this.clock(), ignoreHeartbeat?: boolean): number {
    const closed = this.dateClosed(ignoreHeartbeat);
    return now.getTime() - closed.getTime();
  }
}
