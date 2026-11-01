// Tells the player when the save couldn't be read or written (desktop app),
// instead of failing silently. Dismissed by tapping it.
import { useEffect, useState } from "react";
import { onSaveError } from "../../game/storage";

export function SaveErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onSaveError(setMessage), []);
  if (!message) return null;
  return (
    <div
      role="alert"
      onClick={() => setMessage(null)}
      style={{ position: "fixed", left: 8, right: 8, bottom: 64, zIndex: 100, padding: "8px 12px", background: "#5a1d1d", color: "#fff", border: "2px solid #c33", cursor: "pointer" }}
    >
      {message}
    </div>
  );
}
