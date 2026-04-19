import {
  useDeferredValue,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  useState
} from "react";
import {
  Activity,
  Cable,
  CircleHelp,
  Disc3,
  Mic,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X
} from "lucide-react";

import type {
  BootstrapPayload,
  CommandDefinition,
  CommandResponse,
  DashboardState,
  LiveSnapshot
} from "../shared/types";
import BoardView from "./components/BoardView";
import CommandExplorer from "./components/CommandExplorer";
import ControlCard from "./components/ControlCard";
import {
  AUDIO_CATEGORIES,
  CATEGORY_SOURCES,
  colorToDecimal,
  fixedWindowFromBeams,
  fixedWindowToRadianStrings,
  normalizeDegrees
} from "./lib/deviceMath";
import { deviceStore, useDeviceStore } from "./lib/deviceStore";
import {
  dedupeCommands,
  mergeResponsesIntoDashboard,
  readbackCommandsForWrite
} from "./lib/dashboardState";

const DASHBOARD_REFRESH_MS = 6000;
const LIVE_REFRESH_MS = 125;
type NumericDraftKey =
  | "micGain"
  | "refGain"
  | "agcMaxGain"
  | "agcDesiredLevel"
  | "noiseStationary"
  | "noiseNonStationary";

type NumericDrafts = Record<NumericDraftKey, string>;
type NumericEditing = Record<NumericDraftKey, boolean>;

const EMPTY_NUMERIC_EDITING: NumericEditing = {
  micGain: false,
  refGain: false,
  agcMaxGain: false,
  agcDesiredLevel: false,
  noiseStationary: false,
  noiseNonStationary: false
};

const NUMERIC_FIELD_CONFIG: Record<
  NumericDraftKey,
  {
    command: string;
    successLabel: string;
    readValue: (dashboard: DashboardState | null) => number | undefined;
  }
> = {
  micGain: {
    command: "AUDIO_MGR_MIC_GAIN",
    successLabel: "Updated microphone gain.",
    readValue: (dashboard) => dashboard?.micGain
  },
  refGain: {
    command: "AUDIO_MGR_REF_GAIN",
    successLabel: "Updated reference gain.",
    readValue: (dashboard) => dashboard?.refGain
  },
  agcMaxGain: {
    command: "PP_AGCMAXGAIN",
    successLabel: "Updated AGC max gain.",
    readValue: (dashboard) => dashboard?.agcMaxGain
  },
  agcDesiredLevel: {
    command: "PP_AGCDESIREDLEVEL",
    successLabel: "Updated AGC target level.",
    readValue: (dashboard) => dashboard?.agcDesiredLevel
  },
  noiseStationary: {
    command: "PP_MIN_NS",
    successLabel: "Updated stationary noise suppression.",
    readValue: (dashboard) => dashboard?.noiseStationary
  },
  noiseNonStationary: {
    command: "PP_MIN_NN",
    successLabel: "Updated non-stationary noise suppression.",
    readValue: (dashboard) => dashboard?.noiseNonStationary
  }
};

const APP_DEFAULTS = {
  fixedWindow: {
    centerDegrees: 0,
    widthDegrees: 30
  },
  input: {
    micGain: "91",
    refGain: "8",
    agcEnabled: "1",
    agcMaxGain: "64",
    agcDesiredLevel: "0.0045"
  },
  dsp: {
    noiseStationary: "0.15",
    noiseNonStationary: "0.51",
    echoEnabled: "1",
    beamGating: "1"
  },
  routing: {
    left: ["6", "3"] as [string, string],
    right: ["6", "3"] as [string, string]
  },
  leds: {
    effect: "4",
    single: "#002040",
    doaBase: "#002040",
    doaAccent: "#00c066"
  }
};

function numberToDraft(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "";
  }

  return String(value);
}

function createNumericDrafts(dashboard: DashboardState | null): NumericDrafts {
  return {
    micGain: numberToDraft(dashboard?.micGain),
    refGain: numberToDraft(dashboard?.refGain),
    agcMaxGain: numberToDraft(dashboard?.agcMaxGain),
    agcDesiredLevel: numberToDraft(dashboard?.agcDesiredLevel),
    noiseStationary: numberToDraft(dashboard?.noiseStationary),
    noiseNonStationary: numberToDraft(dashboard?.noiseNonStationary)
  };
}

function syncNumericDrafts(
  current: NumericDrafts,
  dashboard: DashboardState | null,
  editing: NumericEditing
): NumericDrafts {
  const next = createNumericDrafts(dashboard);

  return {
    micGain: editing.micGain ? current.micGain : next.micGain,
    refGain: editing.refGain ? current.refGain : next.refGain,
    agcMaxGain: editing.agcMaxGain ? current.agcMaxGain : next.agcMaxGain,
    agcDesiredLevel: editing.agcDesiredLevel
      ? current.agcDesiredLevel
      : next.agcDesiredLevel,
    noiseStationary: editing.noiseStationary
      ? current.noiseStationary
      : next.noiseStationary,
    noiseNonStationary: editing.noiseNonStationary
      ? current.noiseNonStationary
      : next.noiseNonStationary
  };
}

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
    return "Loading device stateâ€¦";
  }

  if (!dashboard.connected) {
    return dashboard.lastError ?? "Device not reachable";
  }

  return dashboard.speechDetected
    ? "Speech energy detected on the active beam."
    : "Connected and polling. Waiting for speech.";
}

function InfoTip({ text }: { text: string }) {
  return (
    <button
      className="info-tip__trigger"
      type="button"
      title={text}
      aria-label={text}
      onClick={(event) => event.preventDefault()}
    >
      ?
    </button>
  );
}

function LabelWithTip({
  label,
  text
}: {
  label: string;
  text: string;
}) {
  return (
    <span className="field__label-with-tip">
      <span>{label}</span>
      <InfoTip text={text} />
    </span>
  );
}

function CardActions({
  disabled,
  onReset
}: {
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <div className="card-actions">
      <button
        className="ghost-button ghost-button--compact"
        type="button"
        disabled={disabled}
        onClick={onReset}
      >
        <RotateCcw size={14} />
        Reset
      </button>
    </div>
  );
}

function formatAngleValue(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "â€”";
  }

  return `${value.toFixed(1)} deg`;
}

function formatFixedWindowValue(values: number[]) {
  if (values.length !== 2) {
    return "disabled";
  }

  return `${values[0].toFixed(1)} -> ${values[1].toFixed(1)} deg`;
}

function needsControllerSetup(
  message: string,
  dashboard: DashboardState | null,
  binaryPath: string | null,
  autoDiscoveredPath: string | null
) {
  if (/xvf_host\.exe/i.test(message)) {
    return true;
  }

  if (!dashboard?.connected && !binaryPath && !autoDiscoveredPath) {
    return true;
  }

  return false;
}

function BeamStatusItem({
  tone,
  label,
  value,
  tooltip
}: {
  tone: "auto" | "processed" | "fixed" | "free";
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className={`beam-status-item beam-status-item--${tone}`}>
      <div className="beam-status-item__swatch" />
      <div className="beam-status-item__copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <InfoTip text={tooltip} />
    </div>
  );
}

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

function createAngleGuard(): AngleGuard {
  return { pending: undefined, count: 0 };
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

  return next.map(
    (value, index) => mergeCircularValue(current[index], value, alpha) ?? value
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
    : guardLargeJump(
        dashboard.freeRunningDegrees,
        live.freeRunningDegrees,
        guards.free
      );
  const nextSelected = freezeAngles
    ? dashboard.selectedAzimuthDegrees
    : live.selectedAzimuthDegrees.map((value, index) => {
        if (!guards.selected[index]) {
          guards.selected[index] = createAngleGuard();
        }
        return guardLargeJump(
          dashboard.selectedAzimuthDegrees[index],
          value,
          guards.selected[index]
        ) ?? value;
      });
  const nextBeams = freezeAngles
    ? dashboard.beamDegrees
    : live.beamDegrees.map((value, index) => {
        if (!guards.beams[index]) {
          guards.beams[index] = createAngleGuard();
        }
        return guardLargeJump(
          dashboard.beamDegrees[index],
          value,
          guards.beams[index]
        ) ?? value;
      });
  const autoSelectDegrees = freezeAngles
    ? dashboard.autoSelectDegrees
    : mergeCircularValue(dashboard.autoSelectDegrees, nextAuto, 0.34);
  const freeRunningDegrees = freezeAngles
    ? dashboard.freeRunningDegrees
    : mergeCircularValue(
        dashboard.freeRunningDegrees,
        nextFree,
        0.24
      );
  const selectedAzimuthDegrees = freezeAngles
    ? dashboard.selectedAzimuthDegrees
    : mergeCircularArray(
        dashboard.selectedAzimuthDegrees,
        nextSelected,
        0.4
      );
  const beamDegrees = freezeAngles
    ? dashboard.beamDegrees
    : mergeCircularArray(dashboard.beamDegrees, nextBeams, 0.22);

  return {
    ...dashboard,
    connected: live.connected,
    generatedAt: live.generatedAt,
    autoSelectDegrees,
    freeRunningDegrees,
    beamDegrees,
    selectedAzimuthDegrees,
    speechEnergy: live.speechEnergy,
    speechDetected: live.speechDetected,
    lastError: live.lastError
  };
}

export default function App() {
  const {
    commands,
    dashboard,
    commandResults,
    binaryPath,
    autoDiscoveredPath,
    busy,
    message
  } = useDeviceStore();
  const [binaryDraft, setBinaryDraft] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [numericDrafts, setNumericDrafts] = useState<NumericDrafts>(
    createNumericDrafts(null)
  );
  const [numericEditing, setNumericEditing] =
    useState<NumericEditing>(EMPTY_NUMERIC_EDITING);
  const [beamCenterDraft, setBeamCenterDraft] = useState(
    numberToDraft(APP_DEFAULTS.fixedWindow.centerDegrees)
  );
  const [beamWidthDraft, setBeamWidthDraft] = useState(
    APP_DEFAULTS.fixedWindow.widthDegrees
  );
  const [beamEditing, setBeamEditing] = useState({
    center: false,
    width: false
  });
  const [workspaceTab, setWorkspaceTab] = useState<
    "beams" | "input" | "dsp" | "leds"
  >("beams");
  const [overlayPanel, setOverlayPanel] = useState<"system" | "expert" | null>(
    null
  );
  const confirmedFixedWindow = fixedWindowFromBeams(
    dashboard?.fixedBeamDegrees ?? []
  );
  const routingLeft = dashboard?.routing.left
    ? ([String(dashboard.routing.left[0]), String(dashboard.routing.left[1])] as [
        string,
        string
      ])
    : APP_DEFAULTS.routing.left;
  const routingRight = dashboard?.routing.right
    ? ([String(dashboard.routing.right[0]), String(dashboard.routing.right[1])] as [
        string,
        string
      ])
    : APP_DEFAULTS.routing.right;

  useEffect(() => {
    void deviceStore.initialize().catch(() => undefined);
  }, []);

  useEffect(() => {
    setBinaryDraft(binaryPath ?? autoDiscoveredPath ?? "");
  }, [binaryPath, autoDiscoveredPath]);

  useEffect(() => {
    setNumericDrafts((current) =>
      syncNumericDrafts(current, dashboard, numericEditing)
    );
  }, [dashboard, numericEditing]);

  useEffect(() => {
    if (!beamEditing.center) {
      setBeamCenterDraft(numberToDraft(confirmedFixedWindow.centerDegrees));
    }
  }, [confirmedFixedWindow.centerDegrees, beamEditing.center]);

  useEffect(() => {
    if (!beamEditing.width) {
      setBeamWidthDraft(confirmedFixedWindow.widthDegrees);
    }
  }, [confirmedFixedWindow.widthDegrees, beamEditing.width]);

  useEffect(() => {
    if (!overlayPanel) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlayPanel(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [overlayPanel]);

  async function performWrite(
    command: string,
    values: string[],
    label: string,
    readback = readbackCommandsForWrite(command)
  ) {
    await deviceStore.writeCommand(command, values, label, readback);
  }

  async function performBatchWrite(
    writes: Array<{ command: string; values: string[] }>,
    label: string,
    readback = dedupeCommands(
      writes.flatMap((write) => readbackCommandsForWrite(write.command))
    )
  ) {
    await deviceStore.batchWrite(writes, label, readback);
  }

  function beginNumericEditing(key: NumericDraftKey) {
    setNumericEditing((current) =>
      current[key] ? current : { ...current, [key]: true }
    );
  }

  function updateNumericDraft(key: NumericDraftKey, value: string) {
    beginNumericEditing(key);
    setNumericDrafts((current) => ({ ...current, [key]: value }));
  }

  async function commitNumericDraft(key: NumericDraftKey) {
    const config = NUMERIC_FIELD_CONFIG[key];
    const raw = numericDrafts[key].trim();
    const currentValue = config.readValue(dashboard);

    if (raw === "") {
      setNumericEditing((current) => ({ ...current, [key]: false }));
      setNumericDrafts((current) => ({
        ...current,
        [key]: numberToDraft(currentValue)
      }));
      return;
    }

    const nextValue = Number(raw);
    if (Number.isNaN(nextValue)) {
      setNumericEditing((current) => ({ ...current, [key]: false }));
      setNumericDrafts((current) => ({
        ...current,
        [key]: numberToDraft(currentValue)
      }));
      deviceStore.setMessage(`Invalid numeric value for ${config.command}.`);
      return;
    }

    if (currentValue !== undefined && nextValue === currentValue) {
      setNumericEditing((current) => ({ ...current, [key]: false }));
      setNumericDrafts((current) => ({
        ...current,
        [key]: numberToDraft(currentValue)
      }));
      return;
    }

    try {
      await performWrite(config.command, [raw], config.successLabel);
    } finally {
      setNumericEditing((current) => ({ ...current, [key]: false }));
    }
  }

  function handleNumericKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    key: NumericDraftKey
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setNumericEditing((current) => ({ ...current, [key]: false }));
      setNumericDrafts((current) => ({
        ...current,
        [key]: numberToDraft(NUMERIC_FIELD_CONFIG[key].readValue(dashboard))
      }));
      event.currentTarget.blur();
    }
  }

  async function handleRead(command: string) {
    await deviceStore.readCommand(command);
  }

  async function handleRoutingWrite(
    side: "left" | "right",
    nextPair: [string, string]
  ) {
    if (side === "left") {
      await performWrite(
        "AUDIO_MGR_OP_L",
        nextPair,
        "Updated left channel routing.",
        ["AUDIO_MGR_OP_L"]
      );
      return;
    }

    await performWrite(
      "AUDIO_MGR_OP_R",
      nextPair,
      "Updated right channel routing.",
      ["AUDIO_MGR_OP_R"]
    );
  }

  async function handleBrowseBinary() {
    await deviceStore.browseBinaryPath();
  }

  async function handleApplyBinaryPath(nextPath?: string) {
    await deviceStore.applyBinaryPath((nextPath ?? binaryDraft) || null);
  }

  async function handleAutoDetectBinaryPath() {
    await deviceStore.autoDetectBinaryPath();
  }

  async function handleModeSwitch(target: "room" | "fixed") {
    if (target === "room") {
      await deviceStore.setRoomMode("Switched to room mode.");
      setBeamEditing({ center: false, width: false });
      return;
    }

    const nextCenter = Number(beamCenterDraft);
    const centerDegrees = Number.isNaN(nextCenter)
      ? confirmedFixedWindow.centerDegrees
      : normalizeDegrees(nextCenter);
    await deviceStore.setFixedBeamWindow(
      centerDegrees,
      beamWidthDraft,
      `Switched to fixed mode around ${centerDegrees.toFixed(1)} deg with ${beamWidthDraft.toFixed(1)} deg width.`,
    );
    setBeamEditing({ center: false, width: false });
  }

  async function commitFixedWindow(centerDegrees: number, widthDegrees: number) {
    await deviceStore.setFixedBeamWindow(
      centerDegrees,
      widthDegrees,
      `Applied fixed beam window around ${centerDegrees.toFixed(1)} deg with ${widthDegrees.toFixed(1)} deg width.`
    );
  }
  function handleFixedCenterKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setBeamEditing((current) => ({ ...current, center: false }));
      setBeamCenterDraft(numberToDraft(confirmedFixedWindow.centerDegrees));
      event.currentTarget.blur();
    }
  }

  async function handleFixedCenterBlur(
    event: React.FocusEvent<HTMLInputElement>
  ) {
    const nextCenter = Number(event.currentTarget.value)
    if (Number.isNaN(nextCenter)) {
      setBeamEditing((current) => ({ ...current, center: false }))
      setBeamCenterDraft(numberToDraft(confirmedFixedWindow.centerDegrees))
      return
    }

    const normalizedCenter = normalizeDegrees(nextCenter)
    setBeamCenterDraft(numberToDraft(normalizedCenter))

    if (dashboard?.mode !== "fixed") {
      setBeamEditing((current) => ({ ...current, center: false }))
      return
    }

    try {
      await commitFixedWindow(normalizedCenter, beamWidthDraft)
    } finally {
      setBeamEditing((current) => ({ ...current, center: false }))
    }
  }

  async function handleFixedWidthCommit(nextWidth: number) {
    const boundedWidth = Math.max(6, Math.min(nextWidth, 180))
    setBeamWidthDraft(boundedWidth)

    if (dashboard?.mode !== "fixed") {
      setBeamEditing((current) => ({ ...current, width: false }))
      return
    }

    const nextCenter = Number(beamCenterDraft)
    const centerDegrees = Number.isNaN(nextCenter)
      ? confirmedFixedWindow.centerDegrees
      : normalizeDegrees(nextCenter)
    try {
      await commitFixedWindow(centerDegrees, boundedWidth)
    } finally {
      setBeamEditing((current) => ({ ...current, width: false }))
    }
  }

  async function handleResetBeamSection() {
    const [startRadians, endRadians] = fixedWindowToRadianStrings(
      APP_DEFAULTS.fixedWindow.centerDegrees,
      APP_DEFAULTS.fixedWindow.widthDegrees
    )

    await performBatchWrite(
      [
        {
          command: "AEC_FIXEDBEAMSAZIMUTH_VALUES",
          values: [startRadians, endRadians]
        },
        {
          command: "AEC_FIXEDBEAMSONOFF",
          values: ["0"]
        }
      ],
      "Reset beam section to room defaults.",
      [
        "AEC_FIXEDBEAMSONOFF",
        "AEC_FIXEDBEAMSAZIMUTH_VALUES",
        "AUDIO_MGR_SELECTED_AZIMUTHS",
        "AEC_SPENERGY_VALUES"
      ]
    )
    setBeamEditing({ center: false, width: false })
  }
  async function handleResetInputSection() {
    await performBatchWrite(
      [
        { command: "AUDIO_MGR_MIC_GAIN", values: [APP_DEFAULTS.input.micGain] },
        { command: "AUDIO_MGR_REF_GAIN", values: [APP_DEFAULTS.input.refGain] },
        { command: "PP_AGCONOFF", values: [APP_DEFAULTS.input.agcEnabled] },
        { command: "PP_AGCMAXGAIN", values: [APP_DEFAULTS.input.agcMaxGain] },
        {
          command: "PP_AGCDESIREDLEVEL",
          values: [APP_DEFAULTS.input.agcDesiredLevel]
        }
      ],
      "Reset mic and AGC to app defaults."
    );
  }

  async function handleResetDspSection() {
    await performBatchWrite(
      [
        { command: "PP_MIN_NS", values: [APP_DEFAULTS.dsp.noiseStationary] },
        { command: "PP_MIN_NN", values: [APP_DEFAULTS.dsp.noiseNonStationary] },
        { command: "PP_ECHOONOFF", values: [APP_DEFAULTS.dsp.echoEnabled] },
        {
          command: "AEC_FIXEDBEAMSGATING",
          values: [APP_DEFAULTS.dsp.beamGating]
        }
      ],
      "Reset noise and echo settings to app defaults."
    );
  }

  async function handleResetRoutingSection() {
    await performBatchWrite(
      [
        { command: "AUDIO_MGR_OP_L", values: APP_DEFAULTS.routing.left },
        { command: "AUDIO_MGR_OP_R", values: APP_DEFAULTS.routing.right }
      ],
      "Reset USB routing to processed auto-select."
    );
  }

  async function handleResetLedSection() {
    await performBatchWrite(
      [
        { command: "LED_EFFECT", values: [APP_DEFAULTS.leds.effect] },
        {
          command: "LED_COLOR",
          values: [colorToDecimal(APP_DEFAULTS.leds.single)]
        },
        {
          command: "LED_DOA_COLOR",
          values: [
            colorToDecimal(APP_DEFAULTS.leds.doaBase),
            colorToDecimal(APP_DEFAULTS.leds.doaAccent)
          ]
        }
      ],
      "Reset LED section to app defaults."
    );
  }

  async function handleSaveConfiguration() {
    await deviceStore.saveConfiguration();
  }

  async function handleClearConfiguration() {
    if (!window.confirm("Clear all stored XVF3800 settings and revert to defaults?")) {
      return;
    }

    await deviceStore.clearConfiguration();
  }

  async function handleReboot() {
    if (!window.confirm("Reboot the XVF3800 now? Current unsaved changes will be lost.")) {
      return;
    }

    await deviceStore.reboot();
  }


  const ledEffect = dashboard?.ledEffect ?? 4;
  const ledSingleColor = dashboard?.ledColor ?? "#33a4ff";
  const ledBase = dashboard?.ledDoaColors?.[0] ?? "#1a2b3a";
  const ledAccent = dashboard?.ledDoaColors?.[1] ?? "#3ff2ab";
  const leftSources = CATEGORY_SOURCES[Number(routingLeft[0])] ?? [];
  const rightSources = CATEGORY_SOURCES[Number(routingRight[0])] ?? [];
  const echoEnabled = commandResults.PP_ECHOONOFF?.numericValues[0] === 1;
  const beamGatingEnabled =
    commandResults.AEC_FIXEDBEAMSGATING?.numericValues[0] === 1;
  const statusLabel = busy
    ? "Applying device change..."
    : message || statusText(dashboard);
  const setupRequired = needsControllerSetup(
    statusLabel,
    dashboard,
    binaryPath,
    autoDiscoveredPath
  );

  return (
    <main className="app-shell">
      <div className="app-shell__background app-shell__background--one" />
      <div className="app-shell__background app-shell__background--two" />

      <div className="workspace-toolbar">
        <div
          className={`workspace-toolbar__status ${dashboard?.speechDetected ? "is-active" : ""} ${setupRequired ? "is-setup" : ""}`}
        >
          <Activity size={16} />
          <div className="workspace-toolbar__status-copy">
            <span>{statusLabel}</span>
            {setupRequired ? (
              <small>
                Point the app to the XVF3800 host-control executable to enable
                live preview and controls.
              </small>
            ) : null}
          </div>
          {setupRequired ? (
            <div className="workspace-toolbar__status-tools">
              <button
                className="ghost-button ghost-button--compact"
                type="button"
                disabled={busy}
                onClick={() => setOverlayPanel("system")}
              >
                <SlidersHorizontal size={14} />
                Configure
              </button>
              <button
                className="ghost-button ghost-button--compact"
                type="button"
                disabled={busy}
                onClick={() => void handleAutoDetectBinaryPath()}
              >
                <RotateCcw size={14} />
                Auto-detect
              </button>
              <button
                className="ghost-button ghost-button--compact"
                type="button"
                disabled={busy}
                onClick={() => void handleBrowseBinary()}
              >
                <Cable size={14} />
                Browse
              </button>
            </div>
          ) : null}
        </div>
        <div className="workspace-toolbar__actions">
          <button className="ghost-button ghost-button--compact" type="button" disabled={busy} onClick={() => setOverlayPanel("system")}>
            <SlidersHorizontal size={14} />
            System
          </button>
          <button className="ghost-button ghost-button--compact" type="button" disabled={busy} onClick={() => setOverlayPanel("expert")}>
            <Sparkles size={14} />
            Advanced
          </button>
          <button className="ghost-button ghost-button--compact" type="button" disabled={busy} onClick={() => void handleReboot()}>
            <Disc3 size={14} />
            Reboot
          </button>
          <button className="primary-button ghost-button--compact" type="button" disabled={busy} onClick={() => void handleSaveConfiguration()}>
            <Save size={14} />
            Save
          </button>
        </div>
      </div>

      <div className="workspace-shell">
        <section className="workspace-board-panel">
          {setupRequired ? (
            <div className="workspace-empty-state">
              <div className="workspace-empty-state__card">
                <p className="control-card__eyebrow">Setup</p>
                <h2>Controller path required</h2>
                <p className="microcopy">
                  ReSpeaker USB UI needs the XVF3800 host-control executable
                  `xvf_host.exe` before it can read the device.
                </p>
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setOverlayPanel("system")}
                  >
                    <SlidersHorizontal size={14} />
                    Configure
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAutoDetectBinaryPath()}
                  >
                    <RotateCcw size={14} />
                    Auto-detect
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleBrowseBinary()}
                  >
                    <Cable size={14} />
                    Browse
                  </button>
                </div>
                <p className="microcopy">
                  Active path: {binaryPath ?? "—"}
                  <br />
                  Auto-detected: {autoDiscoveredPath ?? "not found"}
                </p>
              </div>
            </div>
          ) : (
            <BoardView
              mode={dashboard?.mode ?? "unknown"}
              autoSelectDegrees={dashboard?.autoSelectDegrees}
              freeRunningDegrees={dashboard?.freeRunningDegrees}
              selectedAzimuthDegrees={dashboard?.selectedAzimuthDegrees ?? []}
              fixedBeamDegrees={dashboard?.fixedBeamDegrees ?? []}
              speechDetected={dashboard?.speechDetected ?? false}
              ledEffect={dashboard?.ledEffect}
              ledColor={dashboard?.ledColor}
              ledDoaColors={dashboard?.ledDoaColors}
            />
          )}
        </section>

        <section className="workspace-panel">
          {setupRequired ? (
            <div className="workspace-panel__empty">
              <ControlCard eyebrow="Setup" title="Get the controller connected">
                <p className="microcopy">
                  Use <strong>Configure</strong> or <strong>Browse</strong> to
                  point the app to `xvf_host.exe`. <strong>Auto-detect</strong>{" "}
                  checks common development and unpack locations on Windows.
                </p>
                <div className="button-row">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setOverlayPanel("system")}
                  >
                    <SlidersHorizontal size={14} />
                    Open System
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAutoDetectBinaryPath()}
                  >
                    <RotateCcw size={14} />
                    Auto-detect
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void handleBrowseBinary()}
                  >
                    <Cable size={14} />
                    Browse
                  </button>
                </div>
              </ControlCard>
            </div>
          ) : (
            <>
              <div className="workspace-panel__tabs">
                <button type="button" className={workspaceTab === "beams" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setWorkspaceTab("beams")}>
                  <SlidersHorizontal size={14} />
                  <span>Beams</span>
                </button>
                <button type="button" className={workspaceTab === "input" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setWorkspaceTab("input")}>
                  <Mic size={14} />
                  <span>Input</span>
                </button>
                <button type="button" className={workspaceTab === "dsp" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setWorkspaceTab("dsp")}>
                  <Settings2 size={14} />
                  <span>DSP</span>
                </button>
                <button type="button" className={workspaceTab === "leds" ? "workspace-tab is-active" : "workspace-tab"} onClick={() => setWorkspaceTab("leds")}>
                  <Sparkles size={14} />
                  <span>LEDs</span>
                </button>
              </div>

              <div className="workspace-panel__body">
                {workspaceTab === "beams" ? (
              <ControlCard eyebrow="Beams" title="Mode and Focus" actions={<CardActions disabled={busy} onReset={() => void handleResetBeamSection()} />}>
                <div className="inline-hint">
                  <span>Beam mode</span>
                  <InfoTip text="Room lets the XVF3800 follow speech dynamically around the space. Fixed locks the preferred listening window to your chosen angle range." />
                </div>
                <div className="segmented-control">
                  <button type="button" className={dashboard?.mode === "room" ? "is-active" : ""} disabled={busy} onClick={() => void handleModeSwitch("room")}>Room</button>
                  <button type="button" className={dashboard?.mode === "fixed" ? "is-active" : ""} disabled={busy} onClick={() => void handleModeSwitch("fixed")}>Fixed</button>
                </div>
                <div className="stat-grid">
                  <div><span>Auto select</span><strong>{dashboard?.autoSelectDegrees?.toFixed(1) ?? "—"}°</strong></div>
                  <div><span>Selected</span><strong>{dashboard?.selectedAzimuthDegrees?.[0]?.toFixed(1) ?? "—"}°</strong></div>
                </div>
                <div className="beam-status-grid">
                  <BeamStatusItem tone="auto" label="Auto beam" value={formatAngleValue(dashboard?.autoSelectDegrees)} tooltip="Blue line. This is the beam the XVF3800 is actively following while it tracks speech around the room." />
                  <BeamStatusItem tone="processed" label="Processed output" value={formatAngleValue(dashboard?.selectedAzimuthDegrees?.[0])} tooltip="White dashed line. This is the processed direction closest to what the USB output is currently using." />
                  <BeamStatusItem tone="fixed" label="Fixed window" value={formatFixedWindowValue(dashboard?.fixedBeamDegrees ?? [])} tooltip="Green sector. In fixed mode this is the favored listening window, and speech outside it gets pushed down more strongly." />
                  <BeamStatusItem tone="free" label="Free-running beam" value={formatAngleValue(dashboard?.freeRunningDegrees)} tooltip="Scout beam. It explores candidate speech directions before the tracked beam settles on the strongest target." />
                </div>
                <label className="field">
                  <LabelWithTip label="Center" text="The middle angle of the fixed listening window. 0 degrees points at the USB side of the board, 180 degrees points opposite." />
                  <input type="number" step="1" min="0" max="359" value={beamCenterDraft} disabled={busy || dashboard?.mode !== "fixed"} onFocus={() => setBeamEditing((current) => ({ ...current, center: true }))} onChange={(event) => { setBeamEditing((current) => ({ ...current, center: true })); setBeamCenterDraft(event.target.value); }} onBlur={(event) => void handleFixedCenterBlur(event)} onKeyDown={handleFixedCenterKeyDown} />
                </label>
                <label className="field">
                  <LabelWithTip label="Width" text="Angular size of the fixed window. Narrow values isolate a seat more aggressively; wider values tolerate more movement." />
                  <input type="range" min="6" max="180" step="1" value={beamWidthDraft} disabled={busy || dashboard?.mode !== "fixed"} onChange={(event) => { setBeamEditing((current) => ({ ...current, width: true })); setBeamWidthDraft(Number(event.target.value)); }} onMouseUp={(event) => void handleFixedWidthCommit(Number(event.currentTarget.value))} onTouchEnd={(event) => void handleFixedWidthCommit(Number(event.currentTarget.value))} onKeyUp={(event) => { if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") { void handleFixedWidthCommit(Number(event.currentTarget.value)); } }} />
                  <strong>{beamWidthDraft.toFixed(0)}°</strong>
                </label>
              </ControlCard>
            ) : null}
                {workspaceTab === "input" ? (
              <ControlCard eyebrow="Input" title="Mic and AGC" actions={<CardActions disabled={busy} onReset={() => void handleResetInputSection()} />}>
                <label className="field">
                  <LabelWithTip label="Mic gain" text="Base microphone gain before the post-processing chain. Raise this if quiet speech is consistently underpowered." />
                  <input type="number" step="1" value={numericDrafts.micGain} onFocus={() => beginNumericEditing("micGain")} onChange={(event) => updateNumericDraft("micGain", event.target.value)} onBlur={() => void commitNumericDraft("micGain")} onKeyDown={(event) => handleNumericKeyDown(event, "micGain")} />
                </label>
                <label className="field">
                  <LabelWithTip label="Reference gain" text="Reference path level used for echo-related processing. This matters more when the device also has a playback reference." />
                  <input type="number" step="1" value={numericDrafts.refGain} onFocus={() => beginNumericEditing("refGain")} onChange={(event) => updateNumericDraft("refGain", event.target.value)} onBlur={() => void commitNumericDraft("refGain")} onKeyDown={(event) => handleNumericKeyDown(event, "refGain")} />
                </label>
                <div className="toggle-row">
                  <span className="field__label-with-tip">
                    <span>AGC</span>
                    <InfoTip text="Automatic gain control tries to keep speech at a usable level. Good for varying speaking distance, but it can also make noise more audible." />
                  </span>
                  <button className={dashboard?.agcEnabled ? "toggle-button is-on" : "toggle-button"} type="button" disabled={busy} onClick={() => void performWrite("PP_AGCONOFF", [dashboard?.agcEnabled ? "0" : "1"], `AGC ${dashboard?.agcEnabled ? "disabled" : "enabled"}.`)}>{dashboard?.agcEnabled ? "On" : "Off"}</button>
                </div>
                <div className="dual-field">
                  <label className="field">
                    <LabelWithTip label="AGC max gain" text="Upper limit for how aggressively AGC may amplify the signal. Higher values help quiet speech but can also lift room noise." />
                    <input type="number" step="1" value={numericDrafts.agcMaxGain} onFocus={() => beginNumericEditing("agcMaxGain")} onChange={(event) => updateNumericDraft("agcMaxGain", event.target.value)} onBlur={() => void commitNumericDraft("agcMaxGain")} onKeyDown={(event) => handleNumericKeyDown(event, "agcMaxGain")} />
                  </label>
                  <label className="field">
                    <LabelWithTip label="Target level" text="Level AGC tries to reach. Lower values are gentler; higher values push speech louder toward the USB output." />
                    <input type="number" step="0.01" value={numericDrafts.agcDesiredLevel} onFocus={() => beginNumericEditing("agcDesiredLevel")} onChange={(event) => updateNumericDraft("agcDesiredLevel", event.target.value)} onBlur={() => void commitNumericDraft("agcDesiredLevel")} onKeyDown={(event) => handleNumericKeyDown(event, "agcDesiredLevel")} />
                  </label>
                </div>
              </ControlCard>
            ) : null}

                {workspaceTab === "dsp" ? (
              <ControlCard eyebrow="DSP" title="Noise and Echo" actions={<CardActions disabled={busy} onReset={() => void handleResetDspSection()} />}>
                <div className="dual-field">
                  <label className="field">
                    <LabelWithTip label="Stationary noise" text="Suppression for steady background noise like fans or HVAC. Too aggressive can make speech sound thin or metallic." />
                    <input type="number" step="0.01" min="0" max="1" value={numericDrafts.noiseStationary} onFocus={() => beginNumericEditing("noiseStationary")} onChange={(event) => updateNumericDraft("noiseStationary", event.target.value)} onBlur={() => void commitNumericDraft("noiseStationary")} onKeyDown={(event) => handleNumericKeyDown(event, "noiseStationary")} />
                  </label>
                  <label className="field">
                    <LabelWithTip label="Non-stationary noise" text="Suppression for changing background noise such as movement or intermittent sounds. Useful, but high values can hurt low-volume speech." />
                    <input type="number" step="0.01" min="0" max="1" value={numericDrafts.noiseNonStationary} onFocus={() => beginNumericEditing("noiseNonStationary")} onChange={(event) => updateNumericDraft("noiseNonStationary", event.target.value)} onBlur={() => void commitNumericDraft("noiseNonStationary")} onKeyDown={(event) => handleNumericKeyDown(event, "noiseNonStationary")} />
                  </label>
                </div>
                <div className="setting-stack">
                  <div className="toggle-row">
                    <span className="field__label-with-tip">
                      <span>Echo suppression</span>
                      <InfoTip text="Turns echo suppression on or off. Mostly relevant when the board hears audio that is also being played back nearby." />
                    </span>
                    <button className={echoEnabled ? "toggle-button is-on" : "toggle-button"} type="button" disabled={busy} onClick={() => void performWrite("PP_ECHOONOFF", [String(echoEnabled ? 0 : 1)], `Echo suppression ${echoEnabled ? "disabled" : "enabled"}.`)}>
                      <CircleHelp size={14} />
                      {echoEnabled ? "On" : "Off"}
                    </button>
                  </div>
                  <p className="microcopy">Reduces playback echo when the board hears audio from nearby speakers.</p>
                </div>
                <div className="setting-stack">
                  <div className="toggle-row">
                    <span className="field__label-with-tip">
                      <span>Beam gating</span>
                      <InfoTip text="When fixed-beam gating is on, the processor more aggressively favors the configured fixed window over other candidate beams." />
                    </span>
                    <button className={beamGatingEnabled ? "toggle-button is-on" : "toggle-button"} type="button" disabled={busy} onClick={() => void performWrite("AEC_FIXEDBEAMSGATING", [String(beamGatingEnabled ? 0 : 1)], `Beam gating ${beamGatingEnabled ? "disabled" : "enabled"}.`)}>
                      <Settings2 size={14} />
                      {beamGatingEnabled ? "On" : "Off"}
                    </button>
                  </div>
                  <p className="microcopy">Makes the processor favor your fixed listening window more strongly.</p>
                </div>
              </ControlCard>
            ) : null}
                {workspaceTab === "leds" ? (
              <ControlCard eyebrow="Ring" title="LEDs" actions={<CardActions disabled={busy} onReset={() => void handleResetLedSection()} />}>
                <label className="field field--led-effect">
                  <LabelWithTip label="Effect" text="LED behavior mode for the ring. DoA follows the detected direction, Single color stays static, and Off disables the ring." />
                  <select value={String(ledEffect)} onChange={(event) => void performWrite("LED_EFFECT", [event.target.value], "Updated LED effect.")}>
                    <option value="0">Off</option>
                    <option value="1">Breath</option>
                    <option value="2">Rainbow</option>
                    <option value="3">Single color</option>
                    <option value="4">DoA</option>
                  </select>
                </label>
                <div className="led-color-grid">
                  <label className="led-color-card">
                    <div className="led-color-card__header">
                      <LabelWithTip label="Single color" text="Color used when the ring is in single-color mode." />
                      <strong>{ledSingleColor.toUpperCase()}</strong>
                    </div>
                    <input className="led-color-card__picker" type="color" value={ledSingleColor} onChange={(event) => void performWrite("LED_COLOR", [colorToDecimal(event.target.value)], "Updated LED color.")} />
                  </label>
                  <label className="led-color-card">
                    <div className="led-color-card__header">
                      <LabelWithTip label="DoA base" text="Base ring color for non-active LEDs while the direction-of-arrival effect is enabled." />
                      <strong>{ledBase.toUpperCase()}</strong>
                    </div>
                    <input className="led-color-card__picker" type="color" value={ledBase} onChange={(event) => void performWrite("LED_DOA_COLOR", [colorToDecimal(event.target.value), colorToDecimal(ledAccent)], "Updated DoA base color.")} />
                  </label>
                  <label className="led-color-card">
                    <div className="led-color-card__header">
                      <LabelWithTip label="DoA accent" text="Highlight color for the active direction-of-arrival segment." />
                      <strong>{ledAccent.toUpperCase()}</strong>
                    </div>
                    <input className="led-color-card__picker" type="color" value={ledAccent} onChange={(event) => void performWrite("LED_DOA_COLOR", [colorToDecimal(ledBase), colorToDecimal(event.target.value)], "Updated DoA accent color.")} />
                  </label>
                </div>
              </ControlCard>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      {overlayPanel ? (
        <div className="overlay-layer" role="presentation" onClick={() => setOverlayPanel(null)}>
          <section className={`overlay-sheet overlay-sheet--${overlayPanel}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="overlay-sheet__header">
              <div className="overlay-sheet__copy">
                <p className="control-card__eyebrow">{overlayPanel === "system" ? "System" : "Advanced"}</p>
                <h2 className="overlay-sheet__title">{overlayPanel === "system" ? "Device setup" : "Full command surface"}</h2>
                <p className="overlay-sheet__subtitle">
                  {overlayPanel === "system"
                    ? "Controller path, routing and device-wide actions live here, so the main workspace can stay compact."
                    : "Every `xvf_host` command exposed with live read/write access. Search by name, subsystem or description."}
                </p>
              </div>
              <div className="overlay-sheet__header-actions">
                {overlayPanel === "expert" ? (
                  <label className="search-field">
                    <Search size={16} />
                    <input type="search" placeholder="Search commands" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                ) : null}
                <button className="ghost-button ghost-button--compact" type="button" onClick={() => setOverlayPanel(null)}>
                  <X size={14} />
                  Close
                </button>
              </div>
            </header>
            <div className="overlay-sheet__body">
              {overlayPanel === "system" ? (
                <div className="overlay-grid overlay-grid--system">
                  <ControlCard eyebrow="Firmware" title="Device Actions">
                    <div className="meta-list">
                      <div><span>Build</span><strong>{dashboard?.buildMessage ?? "—"}</strong></div>
                      <div><span>Boot</span><strong>{dashboard?.bootStatus ?? "—"}</strong></div>
                      <div><span>Speech</span><strong>{dashboard?.speechDetected ? "Detected" : "Idle"}</strong></div>
                    </div>
                    <p className="microcopy">Active path: {binaryPath ?? "—"}<br />Auto-detected: {autoDiscoveredPath ?? "not found"}</p>
                  </ControlCard>
                  <ControlCard eyebrow="Link" title="Controller Path" actions={<button className="ghost-button ghost-button--compact" type="button" disabled={busy} onClick={() => void deviceStore.reload()}><RefreshCw size={14} />Reload</button>}>
                    <label className="field">
                      <span>xvf_host.exe</span>
                      <input type="text" value={binaryDraft} onChange={(event) => setBinaryDraft(event.target.value)} />
                    </label>
                    <div className="button-row">
                      <button className="primary-button" type="button" disabled={busy} onClick={() => void handleApplyBinaryPath()}><Save size={14} />Apply Path</button>
                      <button className="ghost-button" type="button" disabled={busy} onClick={() => void handleBrowseBinary()}><Cable size={14} />Browse</button>
                      <button className="ghost-button" type="button" disabled={busy} onClick={() => { const discovered = autoDiscoveredPath ?? ""; setBinaryDraft(discovered); void handleApplyBinaryPath(discovered); }}><RotateCcw size={14} />Auto</button>
                    </div>
                  </ControlCard>
                  <ControlCard eyebrow="USB output" title="Routing" actions={<CardActions disabled={busy} onReset={() => void handleResetRoutingSection()} />} className="overlay-grid__span-full">
                    <div className="overlay-grid overlay-grid--routing">
                      <div className="routing-block">
                        <h3>Left</h3>
                        <label className="field">
                          <LabelWithTip label="Category" text="Top-level routing source family for the USB output channel, such as processed beams, raw microphones, or internal signals." />
                          <select value={routingLeft[0]} onChange={(event) => void handleRoutingWrite("left", [event.target.value, "0"])}>
                            {AUDIO_CATEGORIES.map((option) => (
                              <option key={option.value} value={String(option.value)}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <LabelWithTip label="Source" text="Specific source within the selected category. For example, a processed beam, a raw mic channel, or another internal stream." />
                          <select value={routingLeft[1]} onChange={(event) => void handleRoutingWrite("left", [routingLeft[0], event.target.value])}>
                            {leftSources.map((option) => (
                              <option key={option.value} value={String(option.value)}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="routing-block">
                        <h3>Right</h3>
                        <label className="field">
                          <LabelWithTip label="Category" text="Top-level routing source family for the USB output channel, such as processed beams, raw microphones, or internal signals." />
                          <select value={routingRight[0]} onChange={(event) => void handleRoutingWrite("right", [event.target.value, "0"])}>
                            {AUDIO_CATEGORIES.map((option) => (
                              <option key={option.value} value={String(option.value)}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <LabelWithTip label="Source" text="Specific source within the selected category. Use this to decide what Windows actually receives on the channel." />
                          <select value={routingRight[1]} onChange={(event) => void handleRoutingWrite("right", [routingRight[0], event.target.value])}>
                            {rightSources.map((option) => (
                              <option key={option.value} value={String(option.value)}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </ControlCard>
                  <div className="overlay-sheet__footer">
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void handleClearConfiguration()}>
                      <RotateCcw size={14} />
                      Factory Reset All
                    </button>
                    <p className="microcopy">Clears every stored XVF3800 setting in flash and reverts the whole device.</p>
                  </div>
                </div>
              ) : (
                <CommandExplorer commands={commands} results={commandResults} query={deferredQuery} busy={busy} onRead={handleRead} onWrite={(command, values) => performWrite(command, values, `Wrote ${command}.`)} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

