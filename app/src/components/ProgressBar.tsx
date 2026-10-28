/** A pixel progress bar. `value` is 0..1. */
export function ProgressBar({ value, ready, label }: { value: number; ready?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return (
    <span className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(pct * 100)}>
      <span className={"bar-fill" + (ready ? " ready" : "")} style={{ width: `${Math.floor(pct * 100)}%` }} />
    </span>
  );
}
