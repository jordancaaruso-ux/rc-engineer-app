/** Top-down 1/10 touring silhouette; origin at wheelbase center, +X = forward. */
const BODY = "#b8bcc4";
const BODY_STROKE = "#5c6370";
const WING = "#9ca3af";
const TIRE = "#1a1d1c";
const COCKPIT = "#8b9199";

type Props = {
  showRearSmear?: boolean;
};

export function HandlingTouringCarSilhouette({ showRearSmear = false }: Props) {
  return (
    <g aria-hidden>
      {showRearSmear ? (
        <g opacity={0.45}>
          <ellipse cx={-8.5} cy={2.8} rx={3.2} ry={1.1} fill="#94a3b8" transform="rotate(-18 -8.5 2.8)" />
          <ellipse cx={-9.5} cy={-2.8} rx={3.2} ry={1.1} fill="#94a3b8" transform="rotate(18 -9.5 -2.8)" />
        </g>
      ) : null}
      <ellipse cx={7.2} cy={3.1} rx={2.1} ry={1.05} fill={TIRE} transform="rotate(-8 7.2 3.1)" />
      <ellipse cx={7.2} cy={-3.1} rx={2.1} ry={1.05} fill={TIRE} transform="rotate(8 7.2 -3.1)" />
      <ellipse cx={-7.2} cy={3.4} rx={2.25} ry={1.1} fill={TIRE} transform="rotate(-6 -7.2 3.4)" />
      <ellipse cx={-7.2} cy={-3.4} rx={2.25} ry={1.1} fill={TIRE} transform="rotate(6 -7.2 -3.4)" />
      <path
        d="M 9.2 0 L 6.8 2.4 L 3.2 3.1 L -1.5 3.4 L -7.5 3.2 L -9.8 2.2 L -10.2 0 L -9.8 -2.2 L -7.5 -3.2 L -1.5 -3.4 L 3.2 -3.1 L 6.8 -2.4 Z"
        fill={BODY}
        stroke={BODY_STROKE}
        strokeWidth={0.55}
        strokeLinejoin="round"
      />
      <ellipse cx={1.5} cy={0} rx={2.8} ry={1.6} fill={COCKPIT} opacity={0.85} />
      <rect x={8.2} y={-3.6} width={1.4} height={7.2} rx={0.25} fill={WING} stroke={BODY_STROKE} strokeWidth={0.35} />
      <rect x={-10.4} y={-4.2} width={1.2} height={8.4} rx={0.25} fill={WING} stroke={BODY_STROKE} strokeWidth={0.35} />
      <line x1={-10.4} y1={-4.2} x2={-10.4} y2={4.2} stroke={BODY_STROKE} strokeWidth={0.4} opacity={0.6} />
      <line x1={8.2} y1={-3.6} x2={8.2} y2={3.6} stroke={BODY_STROKE} strokeWidth={0.35} opacity={0.5} />
    </g>
  );
}
