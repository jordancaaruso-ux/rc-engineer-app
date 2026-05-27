export type OverlayAlignment = {
  translateX: number;
  translateY: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  originXPercent: number;
  originYPercent: number;
};

export const DEFAULT_OVERLAY_ALIGNMENT: OverlayAlignment = {
  translateX: 0,
  translateY: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotateDeg: 0,
  skewXDeg: 0,
  skewYDeg: 0,
  originXPercent: 50,
  originYPercent: 50,
};

export function buildOverlayTransform(a: OverlayAlignment): string {
  const sx = a.scale * a.scaleX;
  const sy = a.scale * a.scaleY;
  return [
    `translate(${a.translateX}px, ${a.translateY}px)`,
    `rotate(${a.rotateDeg}deg)`,
    `skew(${a.skewXDeg}deg, ${a.skewYDeg}deg)`,
    `scale(${sx}, ${sy})`,
  ].join(" ");
}

export function buildTransformOrigin(a: OverlayAlignment): string {
  return `${a.originXPercent}% ${a.originYPercent}%`;
}

export function patchAlignment(
  current: OverlayAlignment,
  patch: Partial<OverlayAlignment>
): OverlayAlignment {
  return { ...current, ...patch };
}
