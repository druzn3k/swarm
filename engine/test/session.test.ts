// Port of swarmsim-coffee/test/spec/services/session.coffee, plus save-format
// and storage checks for the TS Session.
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";
import { MemoryStorage, Session } from "../src";

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/session-saves.json"), "utf8"));
const version = "1.1.17";

describe("Service: session", () => {
  let session: Session;
  beforeEach(() => {
    session = new Session({ clock: () => new Date() });
  });

  it("should do something", () => {
    expect(!!session).toBe(true);
  });

  it("saves/loads", () => {
    let t = 1600000000000;
    session = new Session({ clock: () => new Date(t++) });
    const origsaved = (session.state.date.saved = new Date(session.state.date.saved!.getTime() - 1));
    const state = session._saves();
    expect(origsaved).not.toEqual(session.state.date.saved);

    // session is nonequal because of its class/ctor, so use an object for later compares
    const orig: any = _.clone(session.state);
    const loaded: any = session._loads(state);
    expect(orig.date.loaded).not.toEqual(loaded.date.loaded);
    delete orig.date.loaded;
    delete loaded.date.loaded;
    expect(orig).toEqual(loaded);
  });

  it("saves/loads versionless", () => {
    let encoded = session._saves();
    let version: string | undefined;
    [version, encoded] = session._splitVersionHeader(encoded);
    expect(encoded.indexOf("|")).toBeLessThan(0);
    const data = session._loads(encoded);
    expect(!!data).toBe(true);
  });

  it("saves/loads versionful", () => {
    const encoded = session._saves();
    expect(encoded.indexOf("|")).not.toBeLessThan(0);
    const data = session._loads(encoded);
    expect(!!data).toBe(true);
  });

  it("validates the save version programmatically", () => {
    const v = (a: any, b?: string) => () => session._validateSaveVersion(a, b);
    expect(v("0.1.0", "0.1.0")).not.toThrow();
    expect(v("0.1.0", "0.1.30")).not.toThrow();
    // we're allowing older version imports
    expect(v("0.1.30", "0.1.0")).not.toThrow();
    // but beta minor versions are a reset
    expect(v("0.1.30", "0.2.0")).toThrow();
    expect(v("0.2.30", "0.3.0")).toThrow();
    // no importing 0.2.0 games into 0.1.0 either
    expect(v("0.2.0", "0.1.30")).toThrow();
    expect(v("0.3.0", "0.2.30")).toThrow();

    expect(v("0.2.30", "0.2.0")).not.toThrow();
    expect(v("0.2.0", "0.2.0")).not.toThrow();
    expect(v("1.0.0", "1.0.0")).not.toThrow();
    // 0.x to 1.0 is not a reset, but no reverse-imports, and 0.1.x's still blacklisted
    expect(v("0.9.0", "1.0.0")).not.toThrow();
    expect(v("1.0.0", "0.9.0")).toThrow();
    expect(v("0.1.0", "1.0.0")).toThrow();
    expect(v("1.9.0", "1.0.0")).not.toThrow();
    expect(v("1.0.0", "1.9.0")).not.toThrow();
    // major versions after 1.0 aren't resets
    expect(v("2.0.0", "1.0.0")).not.toThrow();
    expect(v("1.0.0", "2.0.0")).not.toThrow();
    // default version - very old saves.
    expect(v(undefined, "0.1.0")).not.toThrow();
    expect(v(undefined, "0.2.0")).toThrow();
    // current-version based. Breaks when upgrading versions.
    expect(v("0.1.0")).toThrow();
    expect(v("0.2.0")).not.toThrow();
    expect(v("1.0.0")).not.toThrow();
    expect(v(undefined)).toThrow();
    expect(v("1.0.0-publictest1")).toThrow();
    expect(v("1.0.0-publictest8")).toThrow();
    expect(v("1.0.0-publictest20")).toThrow();
  });

  it("validates the save version on import", () => {
    session.state.version!.started = "0.0.1";
    let encoded = session._saves();
    expect(() => session._loads(encoded)).toThrow();
    session.state.version!.started = "1.0.0";
    encoded = session._saves();
    expect(() => session._loads(encoded)).not.toThrow();
    session.state.version!.started = version;
    encoded = session._saves();
    expect(() => session._loads(encoded)).not.toThrow();
    // missing version is assumed to be 0.1.0, but we're past 0.2.0 now
    delete session.state.version;
    encoded = session._saves();
    expect(() => session._loads(encoded)).toThrow();
  });

  it("validates the format version on import, blocking all publictest imports", () => {
    expect(() => session._loads(fixtures.v02)).not.toThrow();
    expect(() => session._loads(fixtures.v1)).not.toThrow();
    expect(() => session._loads(fixtures.publictestCreated)).toThrow();
    expect(() => session._loads(fixtures.publictestImported)).toThrow();
    expect(() => session._loads(fixtures.publictestBroken)).toThrow();
  });

  it("ignores whitespace", () => {
    expect(fixtures.whitespace).toMatch(/\n/);
    expect(() => session._loads(fixtures.whitespace)).not.toThrow();
  });
});

describe("Session (TS port)", () => {
  const now = () => new Date("2020-01-01T00:00:00.000Z");

  it("encodes the save format: base64 version | base64 prefix + lz-string json", () => {
    const session = new Session({ clock: now });
    const encoded = session._saves();
    const [v, body] = encoded.split("|");
    expect(v).toBe("MS4xLjE3"); // btoa("1.1.17")
    expect(body.startsWith("Q2hlYXRlciA6KAoK")).toBe(true); // btoa("Cheater :(\n\n")
    expect(session.state.date.loaded).toBeUndefined();
    expect(session.state.version!.saved).toBe("1.1.17");
  });

  it("exportSave returns an imported string unchanged; save() re-encodes", () => {
    const session = new Session({ clock: now });
    session.importSave(fixtures.v1);
    expect(session.exportSave()).toBe(fixtures.v1);
    session.save();
    expect(session.exportSave()).not.toBe(fixtures.v1);
    expect(session._loads(session.exportSave()).date.saved!.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  it("writes saves and heartbeats to storage", () => {
    const storage = new MemoryStorage();
    const session = new Session({ clock: now, storage, saveId: "test", isKongregate: true });
    expect(session.id).toBe("test-kongregate");
    expect(session.state.kongregate).toBe(true);
    session.save();
    expect(storage.getItem("test-kongregate")).toBe(session.exportSave());
    session.onHeartbeat();
    expect(session.dateClosed().toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(session.millisSinceClosed(new Date("2020-01-01T00:01:00.000Z"))).toBe(60000);
    const other = new Session({ clock: now, storage, saveId: "test", isKongregate: true });
    other.load();
    expect(other.exportSave()).toBe(session.exportSave());
  });

  it("reports failed writes", () => {
    const failures: unknown[] = [];
    const session = new Session({
      clock: now,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      onError: (_msg, e) => failures.push(e),
    });
    expect(() => session.save()).not.toThrow();
    expect(failures.length).toBe(1);
  });
});
