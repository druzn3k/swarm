// The art module's public face: palette, unit sprites, upgrade icons and the
// drawing helpers. The drawings themselves live in ./units and ./icons.
export { PAL, recolor, sp } from "./pixels";
export type { Sprite } from "./pixels";
export { FALLBACK, PROPS, framesFor, hasSprite, spriteFor, spriteNames } from "./units";
export { ICONS, UPGRADE_FALLBACK, iconForUpgrade, iconNameForUpgrade } from "./icons";
export { drawSprite, spriteDataUrl } from "./draw";
