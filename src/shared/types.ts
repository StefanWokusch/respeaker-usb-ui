export type CommandAccess = "ro" | "rw" | "wo";
export type CommandValueType =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int32"
  | "float"
  | "radians"
  | "char"
  | "unknown";
export type SuggestedControl =
  | "readonly"
  | "toggle"
  | "number"
  | "text"
  | "color"
  | "select"
  | "tuple";

export interface CommandOption {
  label: string;
  value: string;
}

export interface CommandRange {
  min?: number;
  max?: number;
  step?: number;
}

export interface CommandDefinition {
  name: string;
  access: CommandAccess;
  count: number;
  valueType: CommandValueType;
  description: string;
  group: string;
  keywords: string[];
  suggestedControl: SuggestedControl;
  options?: CommandOption[];
  range?: CommandRange;
}

export interface CommandResponse {
  command: string;
  ok: boolean;
  rawOutput: string;
  payloadText: string;
  tokens: string[];
  numericValues: number[];
  degreeValues: number[];
  timestamp: string;
  error?: string;
}

export interface RoutingSelection {
  left: [number, number] | null;
  right: [number, number] | null;
}

export interface DashboardState {
  connected: boolean;
  generatedAt: string;
  devicePath: string | null;
  commandsLoaded: number;
  mode: "room" | "fixed" | "unknown";
  speechDetected: boolean;
  version?: string;
  buildMessage?: string;
  bootStatus?: string;
  autoSelectDegrees?: number;
  freeRunningDegrees?: number;
  beamDegrees: number[];
  fixedBeamDegrees: number[];
  selectedAzimuthDegrees: number[];
  speechEnergy: number[];
  ledEffect?: number;
  ledColor?: string;
  ledDoaColors?: string[];
  micGain?: number;
  refGain?: number;
  agcEnabled?: boolean;
  agcMaxGain?: number;
  agcDesiredLevel?: number;
  noiseStationary?: number;
  noiseNonStationary?: number;
  routing: RoutingSelection;
  raw: Record<string, CommandResponse>;
  lastError?: string;
}

export interface LiveSnapshot {
  connected: boolean;
  generatedAt: string;
  autoSelectDegrees?: number;
  freeRunningDegrees?: number;
  beamDegrees: number[];
  selectedAzimuthDegrees: number[];
  speechEnergy: number[];
  speechDetected: boolean;
  lastError?: string;
}

export interface PreviewSnapshot {
  connected: boolean;
  generatedAt: string;
  autoSelectDegrees?: number;
  freeRunningDegrees?: number;
  beamDegrees: number[];
  lastError?: string;
}

export interface SignalSnapshot {
  connected: boolean;
  generatedAt: string;
  speechEnergy: number[];
  speechDetected: boolean;
  lastError?: string;
}

export interface LiveDetailSnapshot {
  connected: boolean;
  generatedAt: string;
  selectedAzimuthDegrees: number[];
  lastError?: string;
}

export interface BootstrapPayload {
  binaryPath: string | null;
  autoDiscoveredPath: string | null;
  commands: CommandDefinition[];
  dashboard: DashboardState;
}

export interface WriteCommandPayload {
  name: string;
  values: Array<string | number>;
}

export interface BinaryPathResult {
  binaryPath: string | null;
  autoDiscoveredPath: string | null;
}

export interface FixedBeamWindowPayload {
  centerDegrees: number;
  widthDegrees: number;
}

export interface ReSpeakerApi {
  bootstrap: () => Promise<BootstrapPayload>;
  refreshDashboard: () => Promise<DashboardState>;
  refreshPreview: () => Promise<PreviewSnapshot>;
  refreshSignals: () => Promise<SignalSnapshot>;
  refreshLive: () => Promise<LiveSnapshot>;
  refreshLiveDetails: () => Promise<LiveDetailSnapshot>;
  refreshCommands: (force?: boolean) => Promise<CommandDefinition[]>;
  readCommand: (name: string) => Promise<CommandResponse>;
  readCommands: (names: string[]) => Promise<Record<string, CommandResponse>>;
  writeCommand: (payload: WriteCommandPayload) => Promise<CommandResponse>;
  setBinaryPath: (binaryPath: string | null) => Promise<BinaryPathResult>;
  browseBinaryPath: () => Promise<BinaryPathResult>;
  setRoomMode: () => Promise<DashboardState>;
  setFixedMode: () => Promise<DashboardState>;
  setFixedBeamWindow: (
    payload: FixedBeamWindowPayload
  ) => Promise<DashboardState>;
  saveConfiguration: () => Promise<CommandResponse>;
  clearConfiguration: () => Promise<CommandResponse>;
  reboot: () => Promise<CommandResponse>;
}
