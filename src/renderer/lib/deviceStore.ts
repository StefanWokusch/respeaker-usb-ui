import { useSyncExternalStore } from "react";

import type {
  BootstrapPayload,
  CommandDefinition,
  CommandResponse,
  DashboardState,
  LiveDetailSnapshot,
  PreviewSnapshot,
  SignalSnapshot,
  LiveSnapshot
} from "../../shared/types";
import { normalizeDegrees } from "./deviceMath";
import {
  dedupeCommands,
  mergeResponsesIntoDashboard,
  readbackCommandsForWrite
} from "./dashboardState";

const DASHBOARD_REFRESH_MS = 6000;
const PREVIEW_REFRESH_MS = 42;
const SIGNAL_REFRESH_MS = 125;
const LIVE_DETAIL_REFRESH_MS = 280;

interface AngleGuard {
  pending?: number;
  count: number;
}

interface AngleGuardStore {
  auto: AngleGuard;
  free: AngleGuard;
  selected: AngleGuard[];
  beams: AngleGuard[];
}

export interface DeviceStoreState {
  commands: CommandDefinition[];
  dashboard: DashboardState | null;
  commandResults: Record<string, CommandResponse>;
  binaryPath: string | null;
  autoDiscoveredPath: string | null;
  busy: boolean;
  message: string;
}

const INITIAL_STATE: DeviceStoreState = {
  commands: [],
  dashboard: null,
  commandResults: {},
  binaryPath: null,
  autoDiscoveredPath: null,
  busy: false,
  message: "Booting ReSpeaker USB UI…"
};

function getApi() {
  if (!window.respeakerApi) {
    throw new Error(
      "ReSpeaker bridge not loaded. Check the packaged preload and restart the app."
    );
  }

  return window.respeakerApi;
}

function statusText(dashboard: DashboardState | null) {
  if (!dashboard) {
    return "Loading device state…";
  }

  if (!dashboard.connected) {
    return dashboard.lastError ?? "Device not reachable";
  }

  return dashboard.speechDetected
    ? "Speech energy detected on the active beam."
    : "Connected and polling. Waiting for speech.";
}

function createAngleGuard(): AngleGuard {
  return { pending: undefined, count: 0 };
}

function createAngleGuardStore(): AngleGuardStore {
  return {
    auto: createAngleGuard(),
    free: createAngleGuard(),
    selected: [],
    beams: []
  };
}

function shortestCircularDelta(current: number, target: number) {
  return ((((target - current) % 360) + 540) % 360) - 180;
}

function guardLargeJump(
  current: number | undefined,
  next: number | undefined,
  guard: AngleGuard
) {
  if (next === undefined || Number.isNaN(next)) {
    return current;
  }

  const normalizedNext = normalizeDegrees(next);

  if (current === undefined || Number.isNaN(current)) {
    guard.pending = undefined;
    guard.count = 0;
    return normalizedNext;
  }

  const delta = Math.abs(shortestCircularDelta(current, normalizedNext));
  if (delta <= 105) {
    guard.pending = undefined;
    guard.count = 0;
    return normalizedNext;
  }

  if (
    guard.pending !== undefined &&
    Math.abs(shortestCircularDelta(guard.pending, normalizedNext)) <= 20
  ) {
    guard.count += 1;
  } else {
    guard.pending = normalizedNext;
    guard.count = 1;
  }

  if (guard.count >= 3) {
    guard.pending = undefined;
    guard.count = 0;
    return normalizedNext;
  }

  return current;
}

function interpolateCircularDegrees(
  current: number,
  target: number,
  alpha: number
) {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return normalizeDegrees(current + delta * alpha);
}

function mergeCircularValue(
  current: number | undefined,
  next: number | undefined,
  alpha: number
) {
  if (next === undefined || Number.isNaN(next)) {
    return current;
  }

  if (current === undefined || Number.isNaN(current)) {
    return normalizeDegrees(next);
  }

  return interpolateCircularDegrees(current, next, alpha);
}

function mergeCircularArray(current: number[], next: number[], alpha: number) {
  if (next.length === 0) {
    return current;
  }

  return next.map((value, index) =>
    mergeCircularValue(current[index], value, alpha) ?? value
  );
}

function mergeLiveSnapshot(
  dashboard: DashboardState | null,
  live: LiveSnapshot,
  guards: AngleGuardStore
) {
  if (!dashboard) {
    return dashboard;
  }

  const freezeAngles = !live.speechDetected;
  const nextAuto = freezeAngles
    ? dashboard.autoSelectDegrees
    : guardLargeJump(dashboard.autoSelectDegrees, live.autoSelectDegrees, guards.auto);
  const nextFree = freezeAngles
    ? dashboard.freeRunningDegrees
    : guardLargeJump(dashboard.freeRunningDegrees, live.freeRunningDegrees, guards.free);
  const nextSelected = freezeAngles
    ? dashboard.selectedAzimuthDegrees
    : live.selectedAzimuthDegrees.map((value, index) => {
        if (!guards.selected[index]) {
          guards.selected[index] = createAngleGuard();
        }

        return (
          guardLargeJump(
            dashboard.selectedAzimuthDegrees[index],
            value,
            guards.selected[index]
          ) ?? value
        );
      });
  const nextBeams = freezeAngles
    ? dashboard.beamDegrees
    : live.beamDegrees.map((value, index) => {
        if (!guards.beams[index]) {
          guards.beams[index] = createAngleGuard();
        }

        return (
          guardLargeJump(dashboard.beamDegrees[index], value, guards.beams[index]) ??
          value
        );
      });

  return {
    ...dashboard,
    connected: live.connected,
    generatedAt: live.generatedAt,
    autoSelectDegrees: freezeAngles
      ? dashboard.autoSelectDegrees
      : mergeCircularValue(dashboard.autoSelectDegrees, nextAuto, 0.34),
    freeRunningDegrees: freezeAngles
      ? dashboard.freeRunningDegrees
      : mergeCircularValue(dashboard.freeRunningDegrees, nextFree, 0.24),
    selectedAzimuthDegrees: freezeAngles
      ? dashboard.selectedAzimuthDegrees
      : mergeCircularArray(dashboard.selectedAzimuthDegrees, nextSelected, 0.4),
    beamDegrees: freezeAngles
      ? dashboard.beamDegrees
      : mergeCircularArray(dashboard.beamDegrees, nextBeams, 0.22),
    speechEnergy: live.speechEnergy,
    speechDetected: live.speechDetected,
    lastError: live.lastError
  };
}

function mergePreviewSnapshot(
  dashboard: DashboardState | null,
  preview: PreviewSnapshot,
  guards: AngleGuardStore
) {
  if (!dashboard) {
    return dashboard;
  }

  const freezeAngles = !dashboard.speechDetected;
  const nextAuto = freezeAngles
    ? dashboard.autoSelectDegrees
    : guardLargeJump(
        dashboard.autoSelectDegrees,
        preview.autoSelectDegrees,
        guards.auto
      );
  const nextFree = freezeAngles
    ? dashboard.freeRunningDegrees
    : guardLargeJump(
        dashboard.freeRunningDegrees,
        preview.freeRunningDegrees,
        guards.free
      );
  const nextBeams = freezeAngles
    ? dashboard.beamDegrees
    : preview.beamDegrees.map((value, index) => {
        if (!guards.beams[index]) {
          guards.beams[index] = createAngleGuard();
        }

        return (
          guardLargeJump(dashboard.beamDegrees[index], value, guards.beams[index]) ??
          value
        );
      });

  return {
    ...dashboard,
    connected: preview.connected,
    generatedAt: preview.generatedAt,
    autoSelectDegrees: freezeAngles
      ? dashboard.autoSelectDegrees
      : mergeCircularValue(dashboard.autoSelectDegrees, nextAuto, 0.52),
    freeRunningDegrees: freezeAngles
      ? dashboard.freeRunningDegrees
      : mergeCircularValue(dashboard.freeRunningDegrees, nextFree, 0.4),
    beamDegrees: freezeAngles
      ? dashboard.beamDegrees
      : mergeCircularArray(dashboard.beamDegrees, nextBeams, 0.34),
    lastError: preview.lastError
  };
}

function fixedWindowDegrees(centerDegrees: number, widthDegrees: number) {
  const normalizedCenter = normalizeDegrees(centerDegrees);
  const boundedWidth = Math.max(6, Math.min(widthDegrees, 180));
  const halfWidth = boundedWidth / 2;

  return [
    normalizeDegrees(normalizedCenter - halfWidth),
    normalizeDegrees(normalizedCenter + halfWidth)
  ] as [number, number];
}

export class ReSpeakerDeviceStore {
  private state: DeviceStoreState = INITIAL_STATE;
  private confirmedDashboard: DashboardState | null = null;
  private listeners = new Set<() => void>();
  private initialized = false;
  private bootstrapPromise: Promise<void> | null = null;
  private dashboardTimer: number | null = null;
  private previewTimer: number | null = null;
  private signalTimer: number | null = null;
  private liveDetailTimer: number | null = null;
  private dashboardRefreshPending = false;
  private previewRefreshPending = false;
  private signalRefreshPending = false;
  private liveDetailRefreshPending = false;
  private activityCount = 0;
  private angleGuards = createAngleGuardStore();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.withBusy(async () => {
        await this.loadBootstrap();
        this.startPolling();
        this.initialized = true;
      }).finally(() => {
        if (!this.initialized) {
          this.bootstrapPromise = null;
        }
      });
    }

    return this.bootstrapPromise;
  }

  async reload() {
    await this.withBusy(async () => {
      await this.loadBootstrap();
    });
  }

  dispose() {
    if (this.dashboardTimer !== null) {
      window.clearInterval(this.dashboardTimer);
      this.dashboardTimer = null;
    }

    if (this.previewTimer !== null) {
      window.clearInterval(this.previewTimer);
      this.previewTimer = null;
    }

    if (this.signalTimer !== null) {
      window.clearInterval(this.signalTimer);
      this.signalTimer = null;
    }

    if (this.liveDetailTimer !== null) {
      window.clearInterval(this.liveDetailTimer);
      this.liveDetailTimer = null;
    }

    this.initialized = false;
    this.bootstrapPromise = null;
    this.dashboardRefreshPending = false;
    this.previewRefreshPending = false;
    this.signalRefreshPending = false;
    this.liveDetailRefreshPending = false;
    this.activityCount = 0;
    this.angleGuards = createAngleGuardStore();
    this.confirmedDashboard = null;
  }

  setMessage(message: string) {
    this.patchState({ message });
  }

  async readCommand(command: string) {
    await this.withBusy(async () => {
      const result = await getApi().readCommand(command);
      this.applyResponses({ [command]: result });
      this.patchState({ message: `Read ${command}` });
    });
  }

  async writeCommand(
    command: string,
    values: string[],
    label: string,
    readback = readbackCommandsForWrite(command)
  ) {
    await this.withBusy(async () => {
      await getApi().writeCommand({ name: command, values });
      await this.readbackCommands(readback);
      this.patchState({ message: label });
    });
  }

  async batchWrite(
    writes: Array<{ command: string; values: string[] }>,
    label: string,
    readback = dedupeCommands(
      writes.flatMap((write) => readbackCommandsForWrite(write.command))
    )
  ) {
    await this.withBusy(async () => {
      for (const write of writes) {
        await getApi().writeCommand({
          name: write.command,
          values: write.values
        });
      }

      await this.readbackCommands(readback);
      this.patchState({ message: label });
    });
  }

  async browseBinaryPath() {
    await this.withBusy(async () => {
      const result = await getApi().browseBinaryPath();
      this.patchState({
        binaryPath: result.binaryPath,
        autoDiscoveredPath: result.autoDiscoveredPath
      });
      await this.loadBootstrap();
      this.patchState({ message: "Updated xvf_host.exe path." });
    });
  }

  async applyBinaryPath(binaryPath: string | null) {
    await this.withBusy(async () => {
      const result = await getApi().setBinaryPath(binaryPath);
      this.patchState({
        binaryPath: result.binaryPath,
        autoDiscoveredPath: result.autoDiscoveredPath
      });
      await this.loadBootstrap();
      this.patchState({ message: "Applied manual xvf_host.exe path." });
    });
  }

  async saveConfiguration() {
    await this.withBusy(async () => {
      await getApi().saveConfiguration();
      this.patchState({
        message: "Saved current XVF3800 configuration to flash."
      });
    });
  }

  async clearConfiguration() {
    await this.withBusy(async () => {
      await getApi().clearConfiguration();
      this.patchState({
        message: "Cleared stored configuration. Replug or reboot the device now."
      });
    });
  }

  async reboot() {
    await this.withBusy(async () => {
      await getApi().reboot();
      this.patchState({ message: "Reboot command sent to the XVF3800." });
    });
  }

  async setRoomMode(message = "Switched to room mode.") {
    await this.withBusy(async () => {
      const previousDashboard = this.confirmedDashboard ?? this.state.dashboard;

      if (previousDashboard) {
        this.patchState({
          dashboard: {
            ...previousDashboard,
            mode: "room",
            fixedBeamDegrees: [],
            generatedAt: new Date().toISOString()
          },
          message: "Switching to room mode..."
        });
      }

      try {
        const dashboard = await getApi().setRoomMode();
        this.applyDashboard(dashboard, message);
      } catch (error) {
        if (previousDashboard) {
          this.patchState({ dashboard: previousDashboard });
        }

        throw error;
      }
    });
  }

  async setFixedBeamWindow(
    centerDegrees: number,
    widthDegrees: number,
    message?: string
  ) {
    await this.withBusy(async () => {
      const previousDashboard = this.confirmedDashboard ?? this.state.dashboard;

      if (previousDashboard) {
        this.patchState({
          dashboard: {
            ...previousDashboard,
            mode: "fixed",
            fixedBeamDegrees: fixedWindowDegrees(centerDegrees, widthDegrees),
            generatedAt: new Date().toISOString()
          },
          message:
            message ??
            `Applying fixed beam window around ${centerDegrees.toFixed(1)} deg with ${widthDegrees.toFixed(1)} deg width...`
        });
      }

      try {
        const dashboard = await getApi().setFixedBeamWindow({
          centerDegrees,
          widthDegrees
        });
        this.applyDashboard(
          dashboard,
          message ??
            `Applied fixed beam window around ${centerDegrees.toFixed(1)} deg with ${widthDegrees.toFixed(1)} deg width.`
        );
      } catch (error) {
        if (previousDashboard) {
          this.patchState({ dashboard: previousDashboard });
        }

        throw error;
      }
    });
  }

  private startPolling() {
    if (this.dashboardTimer === null) {
      this.dashboardTimer = window.setInterval(() => {
        void this.refreshDashboard();
      }, DASHBOARD_REFRESH_MS);
    }

    if (this.previewTimer === null) {
      this.previewTimer = window.setInterval(() => {
        void this.refreshPreview();
      }, PREVIEW_REFRESH_MS);
    }

    if (this.signalTimer === null) {
      this.signalTimer = window.setInterval(() => {
        void this.refreshSignals();
      }, SIGNAL_REFRESH_MS);
    }

    if (this.liveDetailTimer === null) {
      this.liveDetailTimer = window.setInterval(() => {
        void this.refreshLiveDetails();
      }, LIVE_DETAIL_REFRESH_MS);
    }
  }

  private async loadBootstrap() {
    try {
      const payload: BootstrapPayload = await getApi().bootstrap();
      this.angleGuards = createAngleGuardStore();
      this.confirmedDashboard = payload.dashboard;
      this.state = {
        ...this.state,
        commands: payload.commands,
        dashboard: payload.dashboard,
        commandResults: {
          ...this.state.commandResults,
          ...payload.dashboard.raw
        },
        binaryPath: payload.binaryPath,
        autoDiscoveredPath: payload.autoDiscoveredPath,
        message: statusText(payload.dashboard)
      };
      this.emit();
    } catch (error) {
      this.patchState({
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async refreshDashboard() {
    if (this.dashboardRefreshPending || this.activityCount > 0) {
      return;
    }

    this.dashboardRefreshPending = true;
    try {
      const dashboard = await getApi().refreshDashboard();
      this.applyDashboard(dashboard, statusText(dashboard));
    } catch (error) {
      this.patchState({
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.dashboardRefreshPending = false;
    }
  }

  private async refreshPreview() {
    if (
      this.previewRefreshPending ||
      this.activityCount > 0 ||
      !this.state.dashboard?.connected
    ) {
      return;
    }

    this.previewRefreshPending = true;
    try {
      const preview = await getApi().refreshPreview();
      const merged = mergePreviewSnapshot(
        this.state.dashboard,
        preview,
        this.angleGuards
      );
      if (merged) {
        this.patchState({ dashboard: merged });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.state.dashboard) {
        this.patchState({
          dashboard: {
            ...this.state.dashboard,
            connected: false,
            lastError: errorMessage
          },
          message: errorMessage
        });
      } else {
        this.patchState({ message: errorMessage });
      }
    } finally {
      this.previewRefreshPending = false;
    }
  }

  private async refreshSignals() {
    if (
      this.signalRefreshPending ||
      this.activityCount > 0 ||
      !this.state.dashboard?.connected
    ) {
      return;
    }

    this.signalRefreshPending = true;
    try {
      const signal = await getApi().refreshSignals();
      if (this.state.dashboard) {
        this.patchState({
          dashboard: {
            ...this.state.dashboard,
            connected: signal.connected,
            generatedAt: signal.generatedAt,
            speechEnergy: signal.speechEnergy,
            speechDetected: signal.speechDetected,
            lastError: signal.lastError
          }
        });
      }
    } catch {
      // Keep preview responsive; stale speech energy is acceptable.
    } finally {
      this.signalRefreshPending = false;
    }
  }

  private async refreshLiveDetails() {
    if (
      this.liveDetailRefreshPending ||
      this.activityCount > 0 ||
      !this.state.dashboard?.connected
    ) {
      return;
    }

    this.liveDetailRefreshPending = true;
    try {
      const live = await getApi().refreshLiveDetails();
      if (live.selectedAzimuthDegrees.length > 0 && this.state.dashboard) {
        const nextSelected = live.selectedAzimuthDegrees.map((value, index) => {
          if (!this.angleGuards.selected[index]) {
            this.angleGuards.selected[index] = createAngleGuard();
          }

          return (
            guardLargeJump(
              this.state.dashboard?.selectedAzimuthDegrees[index],
              value,
              this.angleGuards.selected[index]
            ) ?? value
          );
        });

        this.patchState({
          dashboard: {
            ...this.state.dashboard,
            generatedAt: live.generatedAt,
            selectedAzimuthDegrees: mergeCircularArray(
              this.state.dashboard.selectedAzimuthDegrees,
              nextSelected,
              0.55
            )
          }
        });
      }
    } catch {
      // Keep the fast preview responsive; stale selected azimuth is acceptable.
    } finally {
      this.liveDetailRefreshPending = false;
    }
  }

  private async readbackCommands(commandNames: string[]) {
    const deduped = dedupeCommands(commandNames);
    if (deduped.length === 0) {
      return;
    }

    const responses = await getApi().readCommands(deduped);
    this.applyResponses(responses);
  }

  private applyDashboard(dashboard: DashboardState, message?: string) {
    this.confirmedDashboard = dashboard;
    this.patchState({
      dashboard,
      commandResults: {
        ...this.state.commandResults,
        ...dashboard.raw
      },
      message: message ?? this.state.message
    });
  }

  private applyResponses(responses: Record<string, CommandResponse>) {
    const nextDashboard = mergeResponsesIntoDashboard(
      this.confirmedDashboard ?? this.state.dashboard,
      responses
    );

    if (nextDashboard) {
      this.confirmedDashboard = nextDashboard;
    }

    this.patchState({
      dashboard: nextDashboard ?? this.state.dashboard,
      commandResults: {
        ...this.state.commandResults,
        ...responses
      }
    });
  }

  private patchState(patch: Partial<DeviceStoreState>) {
    this.state = {
      ...this.state,
      ...patch
    };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async withBusy<T>(operation: () => Promise<T>) {
    this.activityCount += 1;
    if (this.activityCount === 1) {
      this.patchState({ busy: true });
    }

    try {
      return await operation();
    } catch (error) {
      this.patchState({
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.activityCount = Math.max(0, this.activityCount - 1);
      if (this.activityCount === 0) {
        this.patchState({ busy: false });
      }
    }
  }
}

export const deviceStore = new ReSpeakerDeviceStore();

export function useDeviceStore() {
  return useSyncExternalStore(
    deviceStore.subscribe,
    deviceStore.getSnapshot,
    deviceStore.getSnapshot
  );
}
