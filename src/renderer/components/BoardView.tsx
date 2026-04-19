import { normalizeDegrees } from "../lib/deviceMath";

interface BoardViewProps {
  mode: "room" | "fixed" | "unknown";
  autoSelectDegrees?: number;
  freeRunningDegrees?: number;
  selectedAzimuthDegrees: number[];
  fixedBeamDegrees: number[];
  speechDetected: boolean;
  ledEffect?: number;
  ledColor?: string;
  ledDoaColors?: string[];
}

function point(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function sectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startDegrees: number,
  endDegrees: number
) {
  let start = normalizeDegrees(startDegrees);
  let end = normalizeDegrees(endDegrees);

  if (end <= start) {
    end += 360;
  }

  const outerStart = point(cx, cy, outerRadius, start);
  const outerEnd = point(cx, cy, outerRadius, end);
  const innerEnd = point(cx, cy, innerRadius, end);
  const innerStart = point(cx, cy, innerRadius, start);
  const largeArc = end - start > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function doaMarker(cx: number, cy: number, radius: number, degrees: number) {
  const head = point(cx, cy, radius, degrees);
  const tail = point(cx, cy, radius - 54, degrees);

  return {
    head,
    tail
  };
}

export default function BoardView({
  mode,
  autoSelectDegrees,
  freeRunningDegrees,
  selectedAzimuthDegrees,
  fixedBeamDegrees,
  speechDetected,
  ledEffect,
  ledColor,
  ledDoaColors
}: BoardViewProps) {
  const baseLed = ledDoaColors?.[0] ?? ledColor ?? "#223d58";
  const accentLed = ledDoaColors?.[1] ?? "#3ff2ab";
  const ledMode = ledEffect ?? 4;
  const showDoaOverlay = ledMode === 4;
  const markerDegrees = autoSelectDegrees ?? selectedAzimuthDegrees[1] ?? 0;
  const activeMarker = doaMarker(240, 240, 178, markerDegrees);
  const selectionMarker =
    selectedAzimuthDegrees[0] !== undefined
      ? doaMarker(240, 240, 152, selectedAzimuthDegrees[0])
      : null;

  return (
    <div className={`board-shell board-shell--${mode}`}>
      <svg viewBox="0 0 480 480" className="board-shell__svg" role="img">
        <defs>
          <radialGradient id="boardSurface" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#203246" />
            <stop offset="58%" stopColor="#102033" />
            <stop offset="100%" stopColor="#09111b" />
          </radialGradient>
          <radialGradient id="centerChip" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#22395d" />
            <stop offset="100%" stopColor="#101826" />
          </radialGradient>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="240" cy="240" r="190" className="board-shell__board-shadow" />
        <circle cx="240" cy="240" r="182" fill="url(#boardSurface)" stroke="#395979" strokeWidth="2" />
        <circle cx="240" cy="240" r="138" className="board-shell__inner-ring" />
        <circle cx="240" cy="240" r="62" fill="url(#centerChip)" stroke="#49637d" strokeWidth="2" />
        <circle cx="240" cy="240" r="24" className="board-shell__chip-core" />

        {mode === "fixed" && fixedBeamDegrees.length === 2 ? (
          <path
            d={sectorPath(240, 240, 94, 170, fixedBeamDegrees[0], fixedBeamDegrees[1])}
            className="board-shell__fixed-window"
          />
        ) : null}

        {Array.from({ length: 12 }).map((_, index) => {
          const degrees = index * 30;
          const led = point(240, 240, 182, degrees);
          let fill = "rgba(72, 98, 124, 0.10)";

          if (ledMode === 3) {
            fill = ledColor ?? "#5bb2ff";
          }
          if (ledMode === 4) {
            const distance = Math.abs(normalizeDegrees(markerDegrees - degrees));
            fill = distance < 16 ? accentLed : baseLed;
          }
          if (ledMode === 2) {
            fill = `hsl(${degrees}, 88%, 63%)`;
          }
          if (ledMode === 1) {
            fill = ledColor ?? "#f6b15a";
          }
          if (ledMode === 0) {
            fill = "rgba(72, 98, 124, 0.06)";
          }

          return (
            <circle
              key={degrees}
              cx={led.x}
              cy={led.y}
              r="8"
              fill={fill}
              filter={speechDetected && ledMode !== 0 ? "url(#softGlow)" : undefined}
              className={
                ledMode === 1
                  ? "board-shell__led board-shell__led--breath"
                  : "board-shell__led"
              }
            />
          );
        })}

        {showDoaOverlay ? (
          <>
            <line
              x1={activeMarker.tail.x}
              y1={activeMarker.tail.y}
              x2={activeMarker.head.x}
              y2={activeMarker.head.y}
              className="board-shell__doa-line"
            />
            <circle
              cx={activeMarker.head.x}
              cy={activeMarker.head.y}
              r="10"
              fill={accentLed}
              filter="url(#softGlow)"
            />
          </>
        ) : null}

        {selectionMarker ? (
          <>
            <line
              x1={selectionMarker.tail.x}
              y1={selectionMarker.tail.y}
              x2={selectionMarker.head.x}
              y2={selectionMarker.head.y}
              className="board-shell__selected-line"
            />
            <circle cx={selectionMarker.head.x} cy={selectionMarker.head.y} r="5" fill="#f0fbff" />
          </>
        ) : null}

        <rect x="198" y="58" width="84" height="24" rx="8" className="board-shell__usb-port" />
        <circle cx="180" cy="86" r="10" className="board-shell__aux-port" />
        <text x="240" y="448" textAnchor="middle" className="board-shell__label board-shell__label--muted">
          180 deg
        </text>
        <text x="438" y="246" textAnchor="middle" className="board-shell__label board-shell__label--muted">
          90 deg
        </text>
        <text x="44" y="246" textAnchor="middle" className="board-shell__label board-shell__label--muted">
          270 deg
        </text>

        <text x="240" y="234" textAnchor="middle" className="board-shell__center-title">
          ReSpeaker
        </text>
        <text x="240" y="254" textAnchor="middle" className="board-shell__center-subtitle">
          XVF3800
        </text>
      </svg>
    </div>
  );
}
