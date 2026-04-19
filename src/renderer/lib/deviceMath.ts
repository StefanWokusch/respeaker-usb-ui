import type {
  CommandDefinition,
  CommandResponse
} from "../../shared/types";

export const AUDIO_CATEGORIES = [
  { value: 0, label: "0 · Silence" },
  { value: 1, label: "1 · Raw microphones" },
  { value: 2, label: "2 · Unpacked microphones" },
  { value: 3, label: "3 · Amplified microphones" },
  { value: 4, label: "4 · Far end" },
  { value: 5, label: "5 · Far end delayed" },
  { value: 6, label: "6 · Processed data" },
  { value: 7, label: "7 · AEC residual / ASR" },
  { value: 8, label: "8 · User chosen channels" },
  { value: 9, label: "9 · Post SHF DSP" },
  { value: 10, label: "10 · Far end native rate" },
  { value: 11, label: "11 · Amplified mics pre-delay" },
  { value: 12, label: "12 · Amplified far end delayed" }
];

export const CATEGORY_SOURCES: Record<
  number,
  Array<{ value: number; label: string }>
> = {
  0: [{ value: 0, label: "0 · Silence" }],
  1: [0, 1, 2, 3].map((value) => ({ value, label: `${value} · Mic ${value}` })),
  2: [0, 1, 2, 3].map((value) => ({
    value,
    label: `${value} · Unpacked mic ${value}`
  })),
  3: [0, 1, 2, 3].map((value) => ({
    value,
    label: `${value} · Amp mic ${value}`
  })),
  4: [{ value: 0, label: "0 · Far end" }],
  5: [{ value: 0, label: "0 · Far end delayed" }],
  6: [
    { value: 0, label: "0 · Slow beam 0" },
    { value: 1, label: "1 · Slow beam 1" },
    { value: 2, label: "2 · Fast beam" },
    { value: 3, label: "3 · Auto select" }
  ],
  7: [0, 1, 2, 3].map((value) => ({
    value,
    label: `${value} · Residual / ASR ${value}`
  })),
  8: [
    { value: 0, label: "0 · User chosen 0" },
    { value: 1, label: "1 · User chosen 1" }
  ],
  9: [0, 1, 2, 3].map((value) => ({
    value,
    label: `${value} · Post SHF ${value}`
  })),
  10: [0, 1, 2, 3, 4, 5].map((value) => ({
    value,
    label: `${value} · Native far end ${value}`
  })),
  11: [0, 1, 2, 3].map((value) => ({
    value,
    label: `${value} · Pre-delay mic ${value}`
  })),
  12: [{ value: 0, label: "0 · Far end gain + delay" }]
};

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function fixedWindowFromBeams(beams: number[]) {
  if (beams.length < 2) {
    return {
      centerDegrees: 0,
      widthDegrees: 30
    };
  }

  const start = normalizeDegrees(beams[0]);
  const end = normalizeDegrees(beams[1]);
  const width = normalizeDegrees(end - start);

  return {
    centerDegrees: normalizeDegrees(start + width / 2),
    widthDegrees: width || 30
  };
}

export function fixedWindowToRadianStrings(
  centerDegrees: number,
  widthDegrees: number
) {
  const normalizedCenter = normalizeDegrees(centerDegrees);
  const boundedWidth = Math.max(6, Math.min(widthDegrees, 180));
  const halfWidth = boundedWidth / 2;
  const start = normalizeDegrees(normalizedCenter - halfWidth);
  const end = normalizeDegrees(normalizedCenter + halfWidth);
  const degToRad = Math.PI / 180;

  return [
    (start * degToRad).toFixed(5),
    (end * degToRad).toFixed(5)
  ] as const;
}

export function colorToDecimal(cssColor: string) {
  return parseInt(cssColor.replace("#", ""), 16).toString(10);
}

export function decimalToColor(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "#000000";
  }

  return `#${Math.max(0, value).toString(16).padStart(6, "0").slice(-6)}`;
}

export function describeResponse(response?: CommandResponse) {
  if (!response) {
    return "No value cached";
  }

  return response.payloadText || response.rawOutput || "Command completed";
}

function extractPrimaryPayloadNumbers(payload: string, count: number) {
  const matches = Array.from(
    payload.matchAll(/(-?\d+(?:\.\d+)?)(?=\s*(?:\(|$))/g),
    (match) => match[1]
  );

  return matches.slice(0, count);
}

export function guessValues(
  command: Pick<CommandDefinition, "count" | "name" | "valueType">,
  response?: CommandResponse
) {
  const empty = Array.from({ length: command.count }, () =>
    command.name.includes("COLOR") ? "#000000" : ""
  );

  if (!response) {
    return empty;
  }

  if (command.name.includes("COLOR")) {
    const numeric = response.numericValues.slice(0, command.count);
    if (numeric.length >= command.count) {
      return numeric.map((value) => decimalToColor(value));
    }

    return empty;
  }

  if (command.valueType === "radians") {
    const primaryNumbers = extractPrimaryPayloadNumbers(
      response.payloadText,
      command.count
    );

    if (primaryNumbers.length >= command.count) {
      return primaryNumbers;
    }
  }

  if (response.numericValues.length >= command.count) {
    return response.numericValues
      .slice(0, command.count)
      .map((value) => String(value));
  }

  return empty;
}
