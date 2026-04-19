import { afterEach, describe, expect, it } from "vitest";

import type {
  BootstrapPayload,
  CommandDefinition,
  CommandResponse,
  DashboardState,
  ReSpeakerApi
} from "../../shared/types";
import { ReSpeakerDeviceStore } from "./deviceStore";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createCommandResponse(command: string): CommandResponse {
  return {
    command,
    ok: true,
    rawOutput: "",
    payloadText: "",
    tokens: [],
    numericValues: [],
    degreeValues: [],
    timestamp: new Date().toISOString()
  };
}

function createDashboard(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    devicePath: "test-device",
    commandsLoaded: 1,
    mode: "fixed",
    speechDetected: false,
    beamDegrees: [0, 0, 270, 90],
    fixedBeamDegrees: [75, 105],
    selectedAzimuthDegrees: [90],
    speechEnergy: [0, 0, 0, 0],
    routing: {
      left: [6, 3],
      right: [6, 3]
    },
    raw: {
      AEC_FIXEDBEAMSONOFF: createCommandResponse("AEC_FIXEDBEAMSONOFF")
    },
    ...overrides
  };
}

function createBootstrap(dashboard: DashboardState): BootstrapPayload {
  return {
    binaryPath: "xvf_host.exe",
    autoDiscoveredPath: "xvf_host.exe",
    commands: [] satisfies CommandDefinition[],
    dashboard
  };
}

function createPreviewSnapshot() {
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    beamDegrees: [0, 0, 270, 90],
    autoSelectDegrees: 90,
    freeRunningDegrees: 270
  };
}

function createSignalSnapshot() {
  return {
    connected: true,
    generatedAt: new Date().toISOString(),
    speechEnergy: [0, 0, 0, 0],
    speechDetected: false
  };
}

describe("ReSpeakerDeviceStore optimistic mode transitions", () => {
  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        window?: typeof globalThis & { respeakerApi?: ReSpeakerApi };
      }
    ).window;
  });

  it("switches the model to room immediately before device confirmation resolves", async () => {
    const bootstrapDashboard = createDashboard({
      mode: "fixed",
      fixedBeamDegrees: [75, 105]
    });
    const roomDeferred = deferred<DashboardState>();

    const api: ReSpeakerApi = {
      bootstrap: async () => createBootstrap(bootstrapDashboard),
      refreshDashboard: async () => bootstrapDashboard,
      refreshPreview: async () => createPreviewSnapshot(),
      refreshSignals: async () => createSignalSnapshot(),
      refreshLive: async () => ({
        ...createPreviewSnapshot(),
        selectedAzimuthDegrees: [90],
        speechEnergy: [0, 0, 0, 0],
        speechDetected: false
      }),
      refreshLiveDetails: async () => ({
        connected: true,
        generatedAt: new Date().toISOString(),
        selectedAzimuthDegrees: [90]
      }),
      refreshCommands: async () => [],
      readCommand: async (name) => createCommandResponse(name),
      readCommands: async () => ({}),
      writeCommand: async (payload) => createCommandResponse(payload.name),
      setBinaryPath: async () => ({
        binaryPath: "xvf_host.exe",
        autoDiscoveredPath: "xvf_host.exe"
      }),
      browseBinaryPath: async () => ({
        binaryPath: "xvf_host.exe",
        autoDiscoveredPath: "xvf_host.exe"
      }),
      setRoomMode: async () => roomDeferred.promise,
      setFixedMode: async () => bootstrapDashboard,
      setFixedBeamWindow: async () => bootstrapDashboard,
      saveConfiguration: async () => createCommandResponse("SAVE_CONFIGURATION"),
      clearConfiguration: async () => createCommandResponse("CLEAR_CONFIGURATION"),
      reboot: async () => createCommandResponse("REBOOT")
    };

    (
      globalThis as typeof globalThis & {
        window: typeof globalThis & { respeakerApi: ReSpeakerApi };
      }
    ).window = Object.assign(globalThis, { respeakerApi: api });

    const store = new ReSpeakerDeviceStore();
    await store.initialize();

    const switchPromise = store.setRoomMode("Switched to room mode.");
    let snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("room");
    expect(snapshot.dashboard?.fixedBeamDegrees).toEqual([]);

    roomDeferred.resolve(
      createDashboard({
        mode: "room",
        fixedBeamDegrees: []
      })
    );
    await switchPromise;

    snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("room");
    expect(snapshot.dashboard?.fixedBeamDegrees).toEqual([]);
  });

  it("switches the model to fixed immediately using the requested window", async () => {
    const bootstrapDashboard = createDashboard({
      mode: "room",
      fixedBeamDegrees: []
    });
    const fixedDeferred = deferred<DashboardState>();

    const api: ReSpeakerApi = {
      bootstrap: async () => createBootstrap(bootstrapDashboard),
      refreshDashboard: async () => bootstrapDashboard,
      refreshPreview: async () => createPreviewSnapshot(),
      refreshSignals: async () => createSignalSnapshot(),
      refreshLive: async () => ({
        ...createPreviewSnapshot(),
        selectedAzimuthDegrees: [90],
        speechEnergy: [0, 0, 0, 0],
        speechDetected: false
      }),
      refreshLiveDetails: async () => ({
        connected: true,
        generatedAt: new Date().toISOString(),
        selectedAzimuthDegrees: [90]
      }),
      refreshCommands: async () => [],
      readCommand: async (name) => createCommandResponse(name),
      readCommands: async () => ({}),
      writeCommand: async (payload) => createCommandResponse(payload.name),
      setBinaryPath: async () => ({
        binaryPath: "xvf_host.exe",
        autoDiscoveredPath: "xvf_host.exe"
      }),
      browseBinaryPath: async () => ({
        binaryPath: "xvf_host.exe",
        autoDiscoveredPath: "xvf_host.exe"
      }),
      setRoomMode: async () => bootstrapDashboard,
      setFixedMode: async () => bootstrapDashboard,
      setFixedBeamWindow: async () => fixedDeferred.promise,
      saveConfiguration: async () => createCommandResponse("SAVE_CONFIGURATION"),
      clearConfiguration: async () => createCommandResponse("CLEAR_CONFIGURATION"),
      reboot: async () => createCommandResponse("REBOOT")
    };

    (
      globalThis as typeof globalThis & {
        window: typeof globalThis & { respeakerApi: ReSpeakerApi };
      }
    ).window = Object.assign(globalThis, { respeakerApi: api });

    const store = new ReSpeakerDeviceStore();
    await store.initialize();

    const switchPromise = store.setFixedBeamWindow(190, 30, "Apply fixed");
    let snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("fixed");
    expect(snapshot.dashboard?.fixedBeamDegrees).toEqual([175, 205]);

    fixedDeferred.resolve(
      createDashboard({
        mode: "fixed",
        fixedBeamDegrees: [175, 205]
      })
    );
    await switchPromise;

    snapshot = store.getSnapshot();
    expect(snapshot.dashboard?.mode).toBe("fixed");
    expect(snapshot.dashboard?.fixedBeamDegrees).toEqual([175, 205]);
  });
});
