import { describe, expect, it } from "vitest";

import type {
  CommandDefinition,
  CommandResponse
} from "../../shared/types";
import { guessValues } from "./deviceMath";

function mockCommand(
  overrides: Partial<CommandDefinition>
): CommandDefinition {
  return {
    name: "TEST_COMMAND",
    access: "rw",
    count: 1,
    valueType: "float",
    description: "",
    group: "Advanced",
    keywords: [],
    suggestedControl: "number",
    ...overrides
  };
}

function mockResponse(
  overrides: Partial<CommandResponse>
): CommandResponse {
  return {
    command: "TEST_COMMAND",
    ok: true,
    rawOutput: "",
    payloadText: "",
    tokens: [],
    numericValues: [],
    degreeValues: [],
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

describe("guessValues", () => {
  it("converts color command values into CSS hex colors", () => {
    const command = mockCommand({
      name: "LED_DOA_COLOR",
      count: 2,
      valueType: "uint32",
      suggestedControl: "tuple"
    });
    const response = mockResponse({
      payloadText: "8256 49254",
      numericValues: [8256, 49254]
    });

    expect(guessValues(command, response)).toEqual(["#002040", "#00c066"]);
  });

  it("uses primary radian values instead of degree annotations", () => {
    const command = mockCommand({
      name: "AEC_FIXEDBEAMSAZIMUTH_VALUES",
      count: 2,
      valueType: "radians"
    });
    const response = mockResponse({
      payloadText: "1.74533 (100.00 deg) 2.26893 (130.00 deg)",
      numericValues: [1.74533, 100, 2.26893, 130],
      degreeValues: [100, 130]
    });

    expect(guessValues(command, response)).toEqual(["1.74533", "2.26893"]);
  });
});
