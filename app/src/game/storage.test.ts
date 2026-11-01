import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSaveErrors, isDesktop, onSaveError, openSaveStorage, saveBackend } from "./storage";

const KEY = "swarmhive-v2";

function fakeShell(initial: string | null = null) {
  const shell = { file: initial, stores: [] as string[], failLoad: false, failStore: false };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "load_save") {
      if (shell.failLoad) throw "disk on fire";
      return shell.file;
    }
    if (cmd === "store_save") {
      if (shell.failStore) throw new Error("disk full");
      shell.file = (args as { text: string }).text;
      shell.stores.push(shell.file);
      return undefined;
    }
    throw new Error("unknown command " + cmd);
  });
  return { shell, invoke: invoke as unknown as <T>(c: string, a?: Record<string, unknown>) => Promise<T> };
}

// vitest runs in node: a minimal window with a localStorage
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  clearSaveErrors();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser", () => {
  it("uses localStorage, synchronously", async () => {
    expect(isDesktop()).toBe(false);
    window.localStorage.setItem(KEY, "abc");
    const s = await openSaveStorage(KEY);
    expect(s.getItem(KEY)).toBe("abc");
    s.setItem(KEY, "def");
    expect(window.localStorage.getItem(KEY)).toBe("def");
    const b = saveBackend(KEY);
    expect(await b.load()).toBe("def");
    await b.store("ghi");
    expect(window.localStorage.getItem(KEY)).toBe("ghi");
  });
});

describe("tauri", () => {
  it("detects the global and routes the backend through invoke", async () => {
    const { invoke, shell } = fakeShell("from file");
    window.__TAURI__ = { core: { invoke } };
    expect(isDesktop()).toBe(true);
    const b = saveBackend(KEY);
    expect(await b.load()).toBe("from file");
    await b.store("x");
    expect(invoke).toHaveBeenCalledWith("store_save", { text: "x" });
    expect(shell.file).toBe("x");
  });

  it("reads the file, writes through without waiting, keeps other keys in localStorage", async () => {
    const { invoke, shell } = fakeShell("from file");
    const s = await openSaveStorage(KEY, invoke);
    expect(s.getItem(KEY)).toBe("from file");
    s.setItem(KEY, "next");
    expect(s.getItem(KEY)).toBe("next"); // at once, before the write lands
    s.setItem(`${KEY}:heartbeat`, "123");
    await Promise.resolve();
    expect(shell.file).toBe("next");
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(`${KEY}:heartbeat`)).toBe("123");
    s.removeItem?.(KEY);
    expect(s.getItem(KEY)).toBeNull();
  });

  it("copies a browser-side save once when the file is empty", async () => {
    window.localStorage.setItem(KEY, "browser save");
    const { invoke, shell } = fakeShell(null);
    const s = await openSaveStorage(KEY, invoke);
    expect(s.getItem(KEY)).toBe("browser save");
    expect(shell.file).toBe("browser save");
    // later: the file wins over a different browser-side save
    window.localStorage.setItem(KEY, "stale");
    shell.file = "desktop";
    expect((await openSaveStorage(KEY, invoke)).getItem(KEY)).toBe("desktop");
    expect(shell.stores).toEqual(["browser save"]);
  });

  it("starts a new game (null) when neither has a save", async () => {
    const { invoke, shell } = fakeShell(null);
    expect((await openSaveStorage(KEY, invoke)).getItem(KEY)).toBeNull();
    expect(shell.stores).toEqual([]);
  });

  it("toasts a failed store once per streak, without throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { invoke, shell } = fakeShell("a");
    const s = await openSaveStorage(KEY, invoke);
    const seen: string[] = [];
    onSaveError((m) => seen.push(m));
    shell.failStore = true;
    expect(() => s.setItem(KEY, "b")).not.toThrow();
    s.setItem(KEY, "c");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["Couldn't save the game: disk full"]);
    expect(s.getItem(KEY)).toBe("c");
  });

  it("falls back to localStorage and toasts when the file can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(KEY, "browser save");
    const { invoke, shell } = fakeShell("x");
    shell.failLoad = true;
    const s = await openSaveStorage(KEY, invoke);
    expect(s.getItem(KEY)).toBe("browser save");
    const seen: string[] = [];
    onSaveError((m) => seen.push(m)); // a late listener still hears the startup error
    expect(seen[0]).toMatch(/Couldn't read the saved game.*disk on fire/);
  });
});
