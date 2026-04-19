import { afterAll, describe, expect, it } from "vitest";

import type { ReSpeakerApi } from "../../shared/types";
import { ReSpeakerController, discoverBinaryPath } from "../../../electron/respeakerCli";
import { ReSpeakerDeviceStore } from "./deviceStore";

const hasHardware = process.env.RESPEAKER_HARDWARE_TEST === "1";
const hardwareDescribe = hasHardware ? describe : describe.skip;

const controller = new ReSpeakerController(discoverBinaryPath() ?? null);

const api: ReSpeakerApi = {
  bootstrap: async () => {
    const commands = await controller.listCommands();
    const dashboard = await controller.readDashboardState(commands);
    return {
      binaryPath: controller.getBinaryPath(),
      autoDiscoveredPath: controller.getAutoDiscoveredPath(),
      commands,
      dashboard
    };
  },
  refreshDashboard: () => controller.readDashboardState(),
  refreshPreview: () => controller.readPreviewState(),
  refreshSignals: () => controller.readSignalState(),
  refreshLive: () => controller.readLiveState(),
  refreshLiveDetails: () => controller.readLiveDetailState(),
  refreshCommands: (force) => controller.listCommands(force),
  readCommand: (name) => controller.readCommand(name),
  readCommands: (names) => controller.readCommands(names),
  writeCommand: (payload) => controller.writeCommand(payload.name, payload.values),
  setBinaryPath: async (binaryPath) => {
    controller.setBinaryPath(binaryPath);
    return {
      binaryPath: controller.getBinaryPath(),
      autoDiscoveredPath: controller.getAutoDiscoveredPath()
    };
  },
  browseBinaryPath: async () => ({
    binaryPath: controller.getBinaryPath(),
    autoDiscoveredPath: controller.getAutoDiscoveredPath()
  }),
  setRoomMode: () => controller.setRoomMode(),
  setFixedMode: () => controller.setFixedMode(),
  setFixedBeamWindow: (payload) =>
    controller.setFixedBeamWindow(payload.centerDegrees, payload.widthDegrees),
  saveConfiguration: () => controller.saveConfiguration(),
  clearConfiguration: () => controller.clearConfiguration(),
  reboot: () => controller.reboot()
};

(globalThis as typeof globalThis & { window: typeof globalThis & { respeakerApi: ReSpeakerApi } }).window =
  Object.assign(globalThis, { respeakerApi: api });

hardwareDescribe("device store hardware mode switch", () => {
  const store = new ReSpeakerDeviceStore();

  afterAll(async () => {
    try {
      await controller.setRoomMode();
    } finally {
      store.dispose();
    }
  });

  it("confirms fixed and room transitions against the real device", async () => {
    await store.setFixedBeamWindow(190, 30, "hardware fixed test");
    let snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("fixed");
    expect(snapshot.dashboard?.fixedBeamDegrees.length).toBe(2);

    await store.setRoomMode("hardware room test");
    snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("room");
  }, 20000);
});
