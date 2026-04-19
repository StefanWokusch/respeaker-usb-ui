import type {
  CommandResponse,
  DashboardState
} from "../../shared/types";
import { decimalToColor } from "./deviceMath";

function extractRoutingPair(payload?: string) {
  if (!payload) {
    return null;
  }

  const muxMatch = payload.match(/\[(\d+)\]\s+(-?\d+(?:\.\d+)?)/);
  if (muxMatch) {
    return [Number(muxMatch[1]), Number(muxMatch[2])] as [number, number];
  }

  const numbers = Array.from(
    payload.matchAll(/-?\d+(?:\.\d+)?/g),
    (match) => Number(match[0])
  );
  if (numbers.length >= 2) {
    return [numbers[0], numbers[1]] as [number, number];
  }

  return null;
}

function applyResponseToDashboard(
  dashboard: DashboardState,
  command: string,
  response: CommandResponse
) {
  dashboard.raw[command] = response;

  switch (command) {
    case "VERSION":
      dashboard.version = response.payloadText;
      dashboard.connected = true;
      return;
    case "BLD_MSG":
      dashboard.buildMessage = response.payloadText;
      return;
    case "BOOT_STATUS":
      dashboard.bootStatus = response.payloadText;
      return;
    case "AEC_FIXEDBEAMSONOFF": {
      const value = response.numericValues[0];
      dashboard.mode = value === 1 ? "fixed" : value === 0 ? "room" : "unknown";
      return;
    }
    case "AEC_AZIMUTH_VALUES":
      dashboard.beamDegrees = response.degreeValues;
      dashboard.freeRunningDegrees = response.degreeValues[2];
      dashboard.autoSelectDegrees = response.degreeValues[3];
      return;
    case "AEC_FIXEDBEAMSAZIMUTH_VALUES":
      dashboard.fixedBeamDegrees = response.degreeValues;
      return;
    case "AUDIO_MGR_SELECTED_AZIMUTHS":
      dashboard.selectedAzimuthDegrees = response.degreeValues;
      return;
    case "AEC_SPENERGY_VALUES":
      dashboard.speechEnergy = response.numericValues;
      dashboard.speechDetected = response.numericValues.some((value) => value > 0);
      return;
    case "LED_EFFECT":
      dashboard.ledEffect = response.numericValues[0];
      return;
    case "LED_COLOR":
      dashboard.ledColor = decimalToColor(response.numericValues[0]);
      return;
    case "LED_DOA_COLOR":
      dashboard.ledDoaColors = response.numericValues
        .map((value) => decimalToColor(value))
        .filter(Boolean);
      return;
    case "AUDIO_MGR_MIC_GAIN":
      dashboard.micGain = response.numericValues[0];
      return;
    case "AUDIO_MGR_REF_GAIN":
      dashboard.refGain = response.numericValues[0];
      return;
    case "PP_AGCONOFF":
      dashboard.agcEnabled = response.numericValues[0] === 1;
      return;
    case "PP_AGCMAXGAIN":
      dashboard.agcMaxGain = response.numericValues[0];
      return;
    case "PP_AGCDESIREDLEVEL":
      dashboard.agcDesiredLevel = response.numericValues[0];
      return;
    case "PP_MIN_NS":
      dashboard.noiseStationary = response.numericValues[0];
      return;
    case "PP_MIN_NN":
      dashboard.noiseNonStationary = response.numericValues[0];
      return;
    case "AUDIO_MGR_OP_L":
      dashboard.routing = {
        ...dashboard.routing,
        left: extractRoutingPair(response.payloadText)
      };
      return;
    case "AUDIO_MGR_OP_R":
      dashboard.routing = {
        ...dashboard.routing,
        right: extractRoutingPair(response.payloadText)
      };
      return;
    default:
      return;
  }
}

export function mergeResponsesIntoDashboard(
  current: DashboardState | null,
  responses: Record<string, CommandResponse>
) {
  if (!current) {
    return current;
  }

  const next: DashboardState = {
    ...current,
    raw: { ...current.raw },
    routing: {
      ...current.routing
    }
  };

  for (const [command, response] of Object.entries(responses)) {
    applyResponseToDashboard(next, command, response);
  }

  next.generatedAt = new Date().toISOString();
  next.lastError = undefined;
  return next;
}

const MODE_READBACK = [
  "AEC_FIXEDBEAMSONOFF",
  "AEC_FIXEDBEAMSAZIMUTH_VALUES",
  "AUDIO_MGR_SELECTED_AZIMUTHS",
  "AEC_SPENERGY_VALUES"
];

export function readbackCommandsForWrite(command: string) {
  switch (command) {
    case "AUDIO_MGR_MIC_GAIN":
    case "AUDIO_MGR_REF_GAIN":
    case "PP_AGCONOFF":
    case "PP_AGCMAXGAIN":
    case "PP_AGCDESIREDLEVEL":
    case "PP_MIN_NS":
    case "PP_MIN_NN":
    case "PP_ECHOONOFF":
    case "AEC_FIXEDBEAMSGATING":
    case "AUDIO_MGR_OP_L":
    case "AUDIO_MGR_OP_R":
      return [command];
    case "LED_EFFECT":
      return ["LED_EFFECT", "LED_COLOR", "LED_DOA_COLOR"];
    case "LED_COLOR":
      return ["LED_COLOR", "LED_EFFECT"];
    case "LED_DOA_COLOR":
      return ["LED_DOA_COLOR", "LED_EFFECT"];
    case "AEC_FIXEDBEAMSONOFF":
    case "AEC_FIXEDBEAMSAZIMUTH_VALUES":
      return MODE_READBACK;
    default:
      return [command];
  }
}

export function dedupeCommands(commands: string[]) {
  return Array.from(new Set(commands));
}
