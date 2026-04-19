import { describe, expect, it } from "vitest";

import type { CommandResponse, DashboardState } from "../../shared/types";
import {
  mergeResponsesIntoDashboard,
  readbackCommandsForWrite
} from "./dashboardState";

function mockResponse(
  command: string,
  payloadText: string,
  numericValues: number[] = [],
  degreeValues: number[] = []
): CommandResponse {
  return {
    command,
    ok: true,
    rawOutput: `${command} ${payloadText}`.trim(),
    payloadText,
    tokens: payloadText.split(/\s+/).filter(Boolean),
    numericValues,
    degreeValues,
    timestamp: new Date().toISOString()
  };
}

function mockDashboard(): DashboardState {
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    devicePath: null,
    commandsLoaded: 0,
    mode: "room",
    speechDetected: false,
    beamDegrees: [],
    fixedBeamDegrees: [],
    selectedAzimuthDegrees: [],
    speechEnergy: [],
    ledEffect: 4,
    ledColor: "#002040",
    ledDoaColors: ["#002040", "#00c066"],
    micGain: 91,
    refGain: 8,
    agcEnabled: true,
    agcMaxGain: 64,
    agcDesiredLevel: 0.0045,
    noiseStationary: 0.15,
    noiseNonStationary: 0.51,
    routing: {
      left: [6, 3],
      right: [6, 3]
    },
    raw: {}
  };
}

describe("mergeResponsesIntoDashboard", () => {
  it("patches routing, LED colors and fixed mode from targeted readback", () => {
    const next = mergeResponsesIntoDashboard(mockDashboard(), {
      AUDIO_MGR_OP_L: mockResponse(
        "AUDIO_MGR_OP_L",
        "MUX_USER_CHOSEN_CHANNELS[8] 0",
        [8, 0]
      ),
      LED_DOA_COLOR: mockResponse(
        "LED_DOA_COLOR",
        "8256 49254",
        [8256, 49254]
      ),
      AEC_FIXEDBEAMSONOFF: mockResponse("AEC_FIXEDBEAMSONOFF", "1", [1]),
      AEC_FIXEDBEAMSAZIMUTH_VALUES: mockResponse(
        "AEC_FIXEDBEAMSAZIMUTH_VALUES",
        "6.02139 (345.00 deg) 0.26180 (15.00 deg)",
        [6.02139, 345, 0.2618, 15],
        [345, 15]
      )
    });

    expect(next?.routing.left).toEqual([8, 0]);
    expect(next?.ledDoaColors).toEqual(["#002040", "#00c066"]);
    expect(next?.mode).toBe("fixed");
    expect(next?.fixedBeamDegrees).toEqual([345, 15]);
  });
});

describe("readbackCommandsForWrite", () => {
  it("requests the relevant LED readback set", () => {
    expect(readbackCommandsForWrite("LED_EFFECT")).toEqual([
      "LED_EFFECT",
      "LED_COLOR",
      "LED_DOA_COLOR"
    ]);
  });
});
