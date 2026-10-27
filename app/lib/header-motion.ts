/** A small hysteresis band prevents trackpad movement around the threshold from reversing the bar. */
export function headerShouldCompact(compact: boolean, scrollY: number) {
  return compact ? scrollY > 12 : scrollY >= 28;
}

export const HEADER_MOTION_MS = 500;
type Bounds = { left: number; top: number; width: number; height: number };

/** Sample a lightly damped spring once; the browser interpolates these transforms on its own. */
export function headerMotionFrames(from: Bounds, to: Bounds, stretch = false): Keyframe[] {
  const dx = from.left - to.left, dy = from.top - to.top;
  const sx = stretch && to.width > 0 ? from.width / to.width : 1;
  const sy = stretch && to.height > 0 ? from.height / to.height : 1;
  return Array.from({ length: 31 }, (_, index) => {
    const offset = index / 30;
    const t = offset * HEADER_MOTION_MS / 1000;
    // Stiffness 260, damping 28: angular frequency after damping is exactly 8.
    const remaining = index === 30 ? 0 : Math.exp(-14 * t) * (Math.cos(8 * t) + 1.75 * Math.sin(8 * t));
    const transform = `translate(${dx * remaining}px, ${dy * remaining}px)` +
      (stretch ? ` scale(${1 + (sx - 1) * remaining}, ${1 + (sy - 1) * remaining})` : "");
    return { offset, transform };
  });
}
