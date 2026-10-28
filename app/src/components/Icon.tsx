import { useMemo } from "react";
import { spriteDataUrl, spriteFor } from "../art/sprites";

/** A unit/tab sprite as a crisp pixel <img>. Decorative: the label sits next to it. */
export function SpriteIcon({ name, tab, size = 48, className }: { name: string; tab?: string; size?: number; className?: string }) {
  const src = useMemo(() => spriteDataUrl(spriteFor(name, tab)), [name, tab]);
  return <img className={"px-icon" + (className ? " " + className : "")} src={src} alt="" width={size} height={size} />;
}
