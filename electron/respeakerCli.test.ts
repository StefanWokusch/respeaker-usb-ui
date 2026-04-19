import { describe, expect, it } from "vitest";

import { parseCatalogOutput, ReSpeakerController } from "./respeakerCli";

describe("parseCatalogOutput", () => {
  it("parses command lines with wrapped descriptions", () => {
    const commands = parseCatalogOutput(`LED_EFFECT                      READ/WRITE  1   uint8    Set the LED effect mode, 0 = off
                                                         and 4 = doa
AEC_FIXEDBEAMSONOFF             READ/WRITE  1   int32    Enables or disables fixed focused beam mode.`);

    expect(commands).toHaveLength(2);
    expect(commands[0].name).toBe("LED_EFFECT");
    expect(commands[0].description).toContain("and 4 = doa");
    expect(commands[0].group).toBe("LEDs & GPIO");
    expect(commands[1].name).toBe("AEC_FIXEDBEAMSONOFF");
    expect(commands[1].group).toBe("Beamforming & AEC");
  });
});

describe("ReSpeakerController write parsing", () => {
  it("accepts write outputs without an echoed payload line", () => {
    const controller = new ReSpeakerController(null) as unknown as {
      buildCommandResponse: (
        command: string,
        output: string,
        options?: { allowMissingPayload?: boolean }
      ) => {
        ok: boolean;
        payloadText: string;
        numericValues: number[];
      };
    };

    const response = controller.buildCommandResponse(
      "AEC_FIXEDBEAMSONOFF",
      "Device (USB)::device_init() -- Found device VID: 10374 PID: 26 interface: 3",
      { allowMissingPayload: true }
    );

    expect(response.ok).toBe(true);
    expect(response.payloadText).toBe("");
    expect(response.numericValues).toEqual([]);
  });
});
