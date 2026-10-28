// Time helpers for the meta screens (the old moment `fromNow` and util.utcdoy).
import { formatDuration } from "../../format";

/** "3 hours ago", like moment's fromNow(). */
export function fromNow(date: Date, now: Date): string {
  const secs = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  return (formatDuration(secs, { format: "human" }) || "a few seconds") + " ago";
}

/** Elapsed milliseconds as "2d 3h 04:05.678" (old util.utcdoy). */
export function utcdoy(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "";
  const t = new Date(ms);
  const days = Math.floor(ms / 86400000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  // the old filter used day-of-year, so it wrapped after a year; days don't
  return `${days > 0 ? `${days}d ` : ""}${t.getUTCHours()}h ${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.${pad(t.getUTCMilliseconds(), 3)}`;
}

/** A date in the player's locale, with the time. */
export function dateTime(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
