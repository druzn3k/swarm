// Export, import and reset (old options.html): saves stay in the old game's
// format, so swarmsim.com saves import here and these export back there.
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "../../game/GameContext";
import { navigate } from "../../router";
import "../../styles/meta.css";

/** Why a save string can't be imported, or undefined if it looks fine. */
export function validateSave(decode: (s: string) => unknown, text: string): string | undefined {
  const s = text.trim();
  if (!s) return "Paste a saved game first.";
  // the old game refused short urls too
  if (/^https?:/i.test(s)) return "That's a link, not a saved game. Paste the exported text itself.";
  try {
    const state = decode(s) as { unittypes?: unknown; date?: unknown } | null;
    if (!state || typeof state !== "object" || !state.unittypes || !state.date) throw new Error("not a game");
  } catch (e) {
    const detail = e instanceof Error && /version|0\.1|blacklist/i.test(e.message) ? ` (${e.message})` : "";
    return `That isn't a Swarm Simulator save we can read${detail}. Copy the whole exported text and try again.`;
  }
  return undefined;
}

export function ExportSave() {
  const store = useStore();
  const [text, setText] = useState(() => store.engine.session.exportSave());
  const [status, setStatus] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const selectAll = () => {
    area.current?.focus();
    area.current?.select();
  };
  const copy = () => {
    // export what's current, then copy it (inside the click, so the clipboard is allowed)
    store.save();
    const fresh = store.engine.session.exportSave();
    setText(fresh);
    const fallback = () => {
      if (area.current) area.current.value = fresh;
      selectAll();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      setStatus(ok ? "Copied." : "Selected. Copy it with your device's copy command.");
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(fresh).then(() => setStatus("Copied."), fallback);
    } else {
      fallback();
    }
  };

  return (
    <div className="save-block">
      <label htmlFor={id}>Your saved game</label>
      <textarea id={id} ref={area} className="save-text" readOnly value={text} rows={4} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
      <div className="btn-row two">
        <button type="button" className="btn" onClick={copy}>
          Copy
        </button>
        <button type="button" className="btn btn-quiet" onClick={selectAll}>
          Select text
        </button>
      </div>
      <p className="save-status" role="status">
        {status}
      </p>
    </div>
  );
}

export function ImportSave({ onImported }: { onImported?: () => void }) {
  const store = useStore();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const id = useId();
  const errId = useId();
  const confirmBox = useRef<HTMLDivElement>(null);
  const importBtn = useRef<HTMLButtonElement>(null);
  // move focus into the question, and back to the Import button when it closes
  useEffect(() => {
    if (confirming) confirmBox.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    setTimeout(() => importBtn.current?.focus(), 0);
  };

  const check = () => {
    setDone(false);
    const err = validateSave((s) => store.engine.session._loads(s), text);
    setError(err);
    setConfirming(!err);
  };
  const doImport = () => {
    const encoded = text.trim();
    const err = store.act(({ game, backfill, events }) => {
      try {
        game.importSave(encoded, false);
        backfill.run(game);
      } catch (e) {
        events.emit("import", { source: "options", success: false });
        throw e;
      }
      events.emit("import", { source: "options", success: true });
    });
    setConfirming(false);
    if (err) {
      setError("Importing failed. Your current game is unchanged.");
      return;
    }
    setText("");
    setDone(true);
    onImported?.();
  };

  return (
    <div className="save-block">
      <label htmlFor={id}>Import a saved game</label>
      <p className="muted small">Paste a save exported from this app or from swarmsim.com.</p>
      <textarea
        id={id}
        className="save-text"
        rows={4}
        value={text}
        placeholder="Paste your saved game here"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(undefined);
          setConfirming(false);
          setDone(false);
        }}
      />
      {error && (
        <p className="form-error" id={errId} role="alert">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-label="Replace your game?" ref={confirmBox} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && cancel()}>
          <p>This replaces your current game with the imported one. Export your current game first if you want to keep it.</p>
          <div className="btn-row two">
            <button type="button" className="btn btn-danger" onClick={doImport}>
              Replace my game
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row one">
          <button type="button" className="btn" onClick={check} disabled={!text.trim()} ref={importBtn}>
            Import
          </button>
        </div>
      )}
      <p className="save-status" role="status">
        {done ? "Imported. Welcome back to your swarm." : ""}
      </p>
    </div>
  );
}

export function ResetGame() {
  const store = useStore();
  const [step, setStep] = useState(0);
  const wipeBtn = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    setStep(0);
    setTimeout(() => wipeBtn.current?.focus(), 0);
  };
  return (
    <div className="save-block">
      {step === 0 ? (
        <div className="btn-row one">
          <button type="button" className="btn btn-danger" onClick={() => setStep(1)} ref={wipeBtn}>
            Wipe all saved data and start over
          </button>
        </div>
      ) : (
        <div className="confirm" role="alertdialog" aria-label="Wipe everything?" onKeyDown={(e) => e.key === "Escape" && cancel()}>
          <p>You will lose everything and restart the game. No reset-bonuses here. You sure?</p>
          <div className="btn-row two">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                store.act(({ game, session }) => {
                  // delete the stored save, as advertised, then start fresh
                  session.storage.removeItem?.(session.id);
                  game.reset(true);
                });
                setStep(0);
                navigate({ name: "tab", tab: "meat" });
              }}
            >
              Yes, wipe everything
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel} autoFocus>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
