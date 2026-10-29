import { useMemo } from "react";
import { iconForUpgrade, spriteDataUrl, spriteFor } from "../art/sprites";

/**
 * A unit/tab sprite (or, with kind="upgrade", an upgrade/ability icon) as a
 * crisp pixel <img>, drawn at a whole-number scale. Decorative: the label
 * sits next to it.
 */
export function SpriteIcon({
  name,
  tab,
  size = 48,
  className,
  kind = "unit",
}: {
  name: string;
  tab?: string;
  size?: number;
  className?: string;
  kind?: "unit" | "upgrade";
}) {
  const src = useMemo(() => {
    const sprite = kind === "upgrade" ? iconForUpgrade(name) : spriteFor(name, tab);
    // render at device resolution so the browser never resamples the pixels
    const dpr = typeof window !== "undefined" ? Math.max(1, Math.round(window.devicePixelRatio || 1)) : 1;
    return spriteDataUrl(sprite, size * dpr);
  }, [name, tab, kind, size]);
  return <img className={"px-icon" + (className ? " " + className : "")} src={src} alt="" width={size} height={size} draggable={false} />;
}

/** An upgrade's or ability's icon. */
export function UpgradeIcon({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return <SpriteIcon name={name} kind="upgrade" size={size} className={className} />;
}
