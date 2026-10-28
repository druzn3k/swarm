// A button that asks again on the page before doing something drastic (no
// window.confirm): the first tap opens a warning with Confirm and Cancel.
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import "../../styles/progression.css";

export function ConfirmButton({
  label,
  confirmLabel,
  warning,
  disabled,
  quiet,
  onConfirm,
}: {
  label: ReactNode;
  confirmLabel: string;
  warning: ReactNode;
  disabled?: boolean;
  quiet?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const isOpen = open && !disabled;

  useEffect(() => {
    if (isOpen) box.current?.focus();
  }, [isOpen]);

  const close = () => {
    setOpen(false);
    // the opener comes back on the next render
    setTimeout(() => opener.current?.focus(), 0);
  };

  if (!isOpen) {
    return (
      <button ref={opener} type="button" className={"btn btn-wide" + (quiet ? " btn-quiet" : "")} disabled={disabled} onClick={() => setOpen(true)} aria-haspopup="true">
        {label}
      </button>
    );
  }
  return (
    <div className="confirm" role="group" aria-labelledby={id} ref={box} tabIndex={-1}>
      <p id={id} className="confirm-text">
        {warning}
      </p>
      <div className="btn-row two">
        <button type="button" className="btn btn-quiet" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            close();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
