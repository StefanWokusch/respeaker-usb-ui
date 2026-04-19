import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type {
  CommandAccess,
  CommandDefinition,
  CommandOption,
  CommandResponse,
  CommandValueType,
  DashboardState,
  LiveDetailSnapshot,
  PreviewSnapshot,
  SignalSnapshot,
  LiveSnapshot,
  SuggestedControl
} from "../src/shared/types";

const execFileAsync = promisify(execFile);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY_RELATIVE = path.join(
  "hardware",
  "respeaker-xvf3800",
  "work",
  "reSpeaker_XVF3800_USB_4MIC_ARRAY",
  "host_control",
  "win32",
  "xvf_host.exe"
);

const BINARY_PATH_SUFFIXES = [
  DEFAULT_BINARY_RELATIVE,
  path.join(
    "reSpeaker_XVF3800_USB_4MIC_ARRAY",
    "host_control",
    "win32",
    "xvf_host.exe"
  ),
  path.join("host_control", "win32", "xvf_host.exe"),
  path.join("win32", "xvf_host.exe"),
  "xvf_host.exe"
];

const ACCESS_MAP: Record<string, CommandAccess> = {
  "READ ONLY": "ro",
  "WRITE ONLY": "wo",
  "READ/WRITE": "rw"
};

const COMMAND_OPTIONS: Record<string, CommandOption[]> = {
  LED_EFFECT: [
    { label: "Off", value: "0" },
    { label: "Breath", value: "1" },
    { label: "Rainbow", value: "2" },
    { label: "Single Color", value: "3" },
    { label: "DoA", value: "4" }
  ],
  AEC_HPFONOFF: [
    { label: "Off", value: "0" },
    { label: "70 Hz", value: "1" },
    { label: "125 Hz", value: "2" },
    { label: "150 Hz", value: "3" },
    { label: "180 Hz", value: "4" }
  ],
  AEC_AECEMPHASISONOFF: [
    { label: "Off", value: "0" },
    { label: "On", value: "1" },
    { label: "On EQ", value: "2" }
  ],
  USB_BIT_DEPTH: [
    { label: "16-bit", value: "16" },
    { label: "24-bit", value: "24" },
    { label: "32-bit", value: "32" }
  ],
  PP_NLAEC_MODE: [
    { label: "Normal", value: "0" },
    { label: "Train", value: "1" },
    { label: "Train 2", value: "2" }
  ]
};

function existingFilePath(candidate: string) {
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function matchBinaryFromRoot(start: string) {
  let current = path.resolve(start);

  while (true) {
    for (const suffix of BINARY_PATH_SUFFIXES) {
      const candidate = existingFilePath(path.join(current, suffix));
      if (candidate) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function executableDirectoryCandidates() {
  const execDirectory = process.execPath ? path.dirname(process.execPath) : null;
  if (!execDirectory) {
    return [];
  }

  return [
    execDirectory,
    path.resolve(execDirectory, ".."),
    path.resolve(execDirectory, "..", ".."),
    path.resolve(execDirectory, "..", "..", "..")
  ];
}

function environmentDirectoryCandidates() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const homeRoots = userProfile
    ? [
        userProfile,
        path.join(userProfile, "Desktop"),
        path.join(userProfile, "Documents"),
        path.join(userProfile, "Downloads"),
        path.join(userProfile, "Development"),
        path.join(userProfile, "source", "repos")
      ]
    : [];

  return [
    ...homeRoots,
    "C:\\Development",
    "D:\\Development"
  ];
}

function dedupePaths(paths: string[]) {
  return Array.from(
    new Set(
      paths
        .filter(Boolean)
        .map((entry) => path.resolve(entry))
    )
  );
}

export function discoverBinaryPath() {
  const roots = dedupePaths([
    process.cwd(),
    ...executableDirectoryCandidates(),
    ...environmentDirectoryCandidates(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", "..")
  ]);

  for (const root of roots) {
    const match = matchBinaryFromRoot(root);
    if (match) {
      return match;
    }
  }

  return null;
}

function normalizeOutput(...parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/\0/g, "")
    .replace(/\r/g, "")
    .trim();
}

function commandGroup(commandName: string) {
  if (commandName.startsWith("AEC_") || commandName.startsWith("SHF_")) {
    return "Beamforming & AEC";
  }

  if (commandName.startsWith("PP_")) {
    return "Post Processing";
  }

  if (
    commandName.startsWith("AUDIO_MGR_") ||
    commandName.startsWith("I2S_") ||
    commandName.startsWith("USB_") ||
    commandName.startsWith("PLL_") ||
    commandName === "MAX_CONTROL_TIME" ||
    commandName === "RESET_MAX_CONTROL_TIME"
  ) {
    return "Audio Routing";
  }

  if (
    commandName.startsWith("LED_") ||
    commandName.startsWith("GPI_") ||
    commandName.startsWith("GPO_")
  ) {
    return "LEDs & GPIO";
  }

  if (
    commandName.startsWith("VERSION") ||
    commandName.startsWith("BLD_") ||
    commandName.startsWith("BOOT_") ||
    commandName.startsWith("SAVE_") ||
    commandName.startsWith("CLEAR_") ||
    commandName === "REBOOT"
  ) {
    return "Device";
  }

  return "Advanced";
}

function inferRange(description: string) {
  const match = description.match(
    /\[\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*\]/i
  );
  if (!match) {
    return undefined;
  }

  const min = Number(match[1]);
  const max = Number(match[2]);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return undefined;
  }

  return {
    min,
    max,
    step: Math.abs(max - min) <= 5 ? 0.01 : 1
  };
}

function inferControl(
  commandName: string,
  access: CommandAccess,
  count: number,
  valueType: CommandValueType,
  description: string
): SuggestedControl {
  if (access === "ro") {
    return "readonly";
  }

  if (COMMAND_OPTIONS[commandName]) {
    return "select";
  }

  if (count === 1 && commandName.includes("COLOR")) {
    return "color";
  }

  if (
    count === 1 &&
    (/Valid range:\s*0,1/.test(description) ||
      /\(off,on\)/i.test(description) ||
      /\(false,true\)/i.test(description))
  ) {
    return "toggle";
  }

  if (count > 1) {
    return "tuple";
  }

  if (valueType === "char") {
    return "text";
  }

  return "number";
}

function parseCatalog(listOutput: string) {
  const lines = listOutput.split("\n");
  const commands: CommandDefinition[] = [];
  const startPattern =
    /^([A-Z0-9_]+)\s+(READ ONLY|WRITE ONLY|READ\/WRITE)\s+(\d+)\s+([A-Za-z0-9]+)\s+(.*)$/;

  let current:
    | {
        name: string;
        access: CommandAccess;
        count: number;
        valueType: CommandValueType;
        description: string;
      }
    | undefined;

  for (const line of lines) {
    const match = line.match(startPattern);

    if (match) {
      if (current) {
        commands.push({
          ...current,
          group: commandGroup(current.name),
          keywords: [
            current.name,
            commandGroup(current.name),
            current.description
          ],
          suggestedControl: inferControl(
            current.name,
            current.access,
            current.count,
            current.valueType,
            current.description
          ),
          options: COMMAND_OPTIONS[current.name],
          range: inferRange(current.description)
        });
      }

      current = {
        name: match[1],
        access: ACCESS_MAP[match[2]],
        count: Number(match[3]),
        valueType: (match[4] as CommandValueType) ?? "unknown",
        description: match[5].trim()
      };
      continue;
    }

    if (current && line.trim()) {
      current.description = `${current.description} ${line.trim()}`;
    }
  }

  if (current) {
    commands.push({
      ...current,
      group: commandGroup(current.name),
      keywords: [current.name, commandGroup(current.name), current.description],
      suggestedControl: inferControl(
        current.name,
        current.access,
        current.count,
        current.valueType,
        current.description
      ),
      options: COMMAND_OPTIONS[current.name],
      range: inferRange(current.description)
    });
  }

  return commands;
}

function extractPayloadLine(output: string, command: string) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line === command) {
      return "";
    }

    if (line.startsWith(`${command} `)) {
      return line.slice(command.length).trim();
    }
  }

  return null;
}

function extractNumbers(payload: string) {
  return Array.from(payload.matchAll(/-?\d+(?:\.\d+)?/g), (match) =>
    Number(match[0])
  );
}

function extractDegrees(payload: string) {
  return Array.from(
    payload.matchAll(/\((-?\d+(?:\.\d+)?) deg\)/g),
    (match) => Number(match[1])
  );
}

function toHexColor(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }

  return `#${Math.max(0, value).toString(16).padStart(6, "0").slice(-6)}`;
}

function parseRoutingPair(payload?: string) {
  if (!payload) {
    return null;
  }

  const muxMatch = payload.match(/\[(\d+)\]\s+(-?\d+(?:\.\d+)?)/);
  if (muxMatch) {
    return [Number(muxMatch[1]), Number(muxMatch[2])] as [number, number];
  }

  const numbers = extractNumbers(payload);
  if (numbers.length >= 2) {
    return [numbers[0], numbers[1]] as [number, number];
  }

  return null;
}

function emptyDashboard(
  devicePath: string | null,
  commandsLoaded = 0
): DashboardState {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    devicePath,
    commandsLoaded,
    mode: "unknown",
    speechDetected: false,
    beamDegrees: [],
    fixedBeamDegrees: [],
    selectedAzimuthDegrees: [],
    speechEnergy: [],
    routing: {
      left: null,
      right: null
    },
    raw: {}
  };
}

function emptyLiveSnapshot(): LiveSnapshot {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    beamDegrees: [],
    selectedAzimuthDegrees: [],
    speechEnergy: [],
    speechDetected: false
  };
}

function emptyPreviewSnapshot(): PreviewSnapshot {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    beamDegrees: []
  };
}

function emptySignalSnapshot(): SignalSnapshot {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    speechEnergy: [],
    speechDetected: false
  };
}

function emptyLiveDetailSnapshot(): LiveDetailSnapshot {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    selectedAzimuthDegrees: []
  };
}

export class ReSpeakerController {
  private commandCache: CommandDefinition[] | null = null;
  private autoDiscoveredPath = discoverBinaryPath();
  private binaryPath: string | null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(binaryPath?: string | null) {
    this.binaryPath = binaryPath ?? this.autoDiscoveredPath;
  }

  getBinaryPath() {
    return this.binaryPath;
  }

  getAutoDiscoveredPath() {
    return this.autoDiscoveredPath;
  }

  setBinaryPath(binaryPath: string | null) {
    this.autoDiscoveredPath = discoverBinaryPath();
    this.binaryPath = binaryPath || this.autoDiscoveredPath;
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async run(args: string[]) {
    if (!this.binaryPath) {
      throw new Error("xvf_host.exe konnte nicht gefunden werden.");
    }

    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(`xvf_host.exe fehlt unter ${this.binaryPath}`);
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
        cwd: path.dirname(this.binaryPath),
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024
      });

      return normalizeOutput(stdout, stderr);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      throw new Error(
        normalizeOutput(
          failure.stdout,
          failure.stderr,
          failure.message ?? "Unbekannter xvf_host-Fehler"
        )
      );
    }
  }

  async listCommands(force = false) {
    if (this.commandCache && !force) {
      return this.commandCache;
    }

    const output = await this.enqueue(() => this.run(["-l"]));
    this.commandCache = parseCatalog(output);
    return this.commandCache;
  }

  private buildCommandResponse(
    command: string,
    output: string,
    options?: { allowMissingPayload?: boolean }
  ): CommandResponse {
    const payloadText = extractPayloadLine(output, command);

    if (payloadText === null) {
      if (!options?.allowMissingPayload) {
        throw new Error(output || `Keine Rueckgabe fuer ${command}`);
      }

      return {
        command,
        ok: true,
        rawOutput: output,
        payloadText: "",
        tokens: [],
        numericValues: [],
        degreeValues: [],
        timestamp: new Date().toISOString()
      };
    }

    return {
      command,
      ok: true,
      rawOutput: output,
      payloadText,
      tokens: payloadText.split(/\s+/).filter(Boolean),
      numericValues: extractNumbers(payloadText),
      degreeValues: extractDegrees(payloadText),
      timestamp: new Date().toISOString()
    };
  }

  private async runReadCommand(command: string) {
    const output = await this.run([command]);
    return this.buildCommandResponse(command, output);
  }

  async readCommand(command: string): Promise<CommandResponse> {
    return this.enqueue(() => this.runReadCommand(command));
  }

  async readCommands(commands: string[]) {
    return this.enqueue(async () => {
      const responses: Record<string, CommandResponse> = {};

      for (const command of commands) {
        responses[command] = await this.runReadCommand(command);
      }

      return responses;
    });
  }

  async writeCommand(command: string, values: Array<string | number>) {
    const output = await this.enqueue(() =>
      this.run([command, ...values.map((value) => String(value))])
    );

    return this.buildCommandResponse(command, output, {
      allowMissingPayload: true
    });
  }

  private async waitForModeValue(expected: 0 | 1, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.readCommand("AEC_FIXEDBEAMSONOFF");
      if (result.numericValues[0] === expected) {
        return true;
      }

      await sleep(100);
    }

    return false;
  }

  async setRoomMode() {
    await this.writeCommand("AEC_FIXEDBEAMSONOFF", [0]);
    await this.waitForModeValue(0);
    return this.readDashboardState();
  }

  async setFixedMode() {
    await this.writeCommand("AEC_FIXEDBEAMSONOFF", [1]);
    await this.waitForModeValue(1);
    return this.readDashboardState();
  }

  async setFixedBeamWindow(centerDegrees: number, widthDegrees: number) {
    const normalizedCenter = ((centerDegrees % 360) + 360) % 360;
    const boundedWidth = Math.max(6, Math.min(widthDegrees, 180));
    const halfWidth = boundedWidth / 2;
    const start = ((normalizedCenter - halfWidth) % 360 + 360) % 360;
    const end = ((normalizedCenter + halfWidth) % 360 + 360) % 360;
    const degToRad = Math.PI / 180;

    await this.writeCommand("AEC_FIXEDBEAMSAZIMUTH_VALUES", [
      (start * degToRad).toFixed(5),
      (end * degToRad).toFixed(5)
    ]);
    await this.writeCommand("AEC_FIXEDBEAMSONOFF", [1]);
    await this.waitForModeValue(1);
    return this.readDashboardState();
  }

  async saveConfiguration() {
    return this.writeCommand("SAVE_CONFIGURATION", [1]);
  }

  async clearConfiguration() {
    return this.writeCommand("CLEAR_CONFIGURATION", [1]);
  }

  async reboot() {
    return this.writeCommand("REBOOT", [1]);
  }

  async readLiveState() {
    return this.enqueue(async () => {
      const live = emptyLiveSnapshot();

      try {
        const azimuths = await this.runReadCommand("AEC_AZIMUTH_VALUES");
        live.connected = true;
        live.beamDegrees = azimuths.degreeValues;
        live.freeRunningDegrees = azimuths.degreeValues[2];
        live.autoSelectDegrees = azimuths.degreeValues[3];

        const speechEnergy = await this.runReadCommand("AEC_SPENERGY_VALUES");
        live.speechEnergy = speechEnergy.numericValues;
        live.speechDetected = speechEnergy.numericValues.some((value) => value > 0);
      } catch (error) {
        live.lastError = error instanceof Error ? error.message : String(error);
      }

      live.generatedAt = new Date().toISOString();
      return live;
    });
  }

  async readPreviewState() {
    return this.enqueue(async () => {
      const preview = emptyPreviewSnapshot();

      try {
        const azimuths = await this.runReadCommand("AEC_AZIMUTH_VALUES");
        preview.connected = true;
        preview.beamDegrees = azimuths.degreeValues;
        preview.freeRunningDegrees = azimuths.degreeValues[2];
        preview.autoSelectDegrees = azimuths.degreeValues[3];
      } catch (error) {
        preview.lastError = error instanceof Error ? error.message : String(error);
      }

      preview.generatedAt = new Date().toISOString();
      return preview;
    });
  }

  async readSignalState() {
    return this.enqueue(async () => {
      const signal = emptySignalSnapshot();

      try {
        const speechEnergy = await this.runReadCommand("AEC_SPENERGY_VALUES");
        signal.connected = true;
        signal.speechEnergy = speechEnergy.numericValues;
        signal.speechDetected = speechEnergy.numericValues.some((value) => value > 0);
      } catch (error) {
        signal.lastError = error instanceof Error ? error.message : String(error);
      }

      signal.generatedAt = new Date().toISOString();
      return signal;
    });
  }

  async readLiveDetailState() {
    return this.enqueue(async () => {
      const live = emptyLiveDetailSnapshot();

      try {
        const selected = await this.runReadCommand("AUDIO_MGR_SELECTED_AZIMUTHS");
        live.connected = true;
        live.selectedAzimuthDegrees = selected.degreeValues;
      } catch (error) {
        live.lastError = error instanceof Error ? error.message : String(error);
      }

      live.generatedAt = new Date().toISOString();
      return live;
    });
  }

  async readDashboardState(commands?: CommandDefinition[]) {
    const availableCommands = commands ?? (await this.listCommands());
    return this.enqueue(async () => {
      const dashboard = emptyDashboard(
        this.binaryPath,
        availableCommands.length
      );

      try {
        dashboard.raw.VERSION = await this.runReadCommand("VERSION");
        dashboard.version = dashboard.raw.VERSION.payloadText;
        dashboard.connected = true;
      } catch (error) {
        dashboard.lastError = error instanceof Error ? error.message : String(error);
        return dashboard;
      }

      const reads = [
        "BLD_MSG",
        "BOOT_STATUS",
        "AEC_FIXEDBEAMSONOFF",
        "AEC_FIXEDBEAMSAZIMUTH_VALUES",
        "AEC_AZIMUTH_VALUES",
        "AEC_SPENERGY_VALUES",
        "AUDIO_MGR_SELECTED_AZIMUTHS",
        "AUDIO_MGR_OP_L",
        "AUDIO_MGR_OP_R",
        "AUDIO_MGR_MIC_GAIN",
        "AUDIO_MGR_REF_GAIN",
        "PP_AGCONOFF",
        "PP_AGCMAXGAIN",
        "PP_AGCDESIREDLEVEL",
        "PP_MIN_NS",
        "PP_MIN_NN",
        "PP_ECHOONOFF",
        "AEC_FIXEDBEAMSGATING",
        "LED_EFFECT",
        "LED_COLOR",
        "LED_DOA_COLOR"
      ];

      for (const command of reads) {
        try {
          dashboard.raw[command] = await this.runReadCommand(command);
        } catch (error) {
          dashboard.lastError = error instanceof Error ? error.message : String(error);
        }
      }

      dashboard.buildMessage = dashboard.raw.BLD_MSG?.payloadText;
      dashboard.bootStatus = dashboard.raw.BOOT_STATUS?.payloadText;

      const fixedModeValue = dashboard.raw.AEC_FIXEDBEAMSONOFF?.numericValues[0];
      dashboard.mode =
        fixedModeValue === 1 ? "fixed" : fixedModeValue === 0 ? "room" : "unknown";

      dashboard.beamDegrees = dashboard.raw.AEC_AZIMUTH_VALUES?.degreeValues ?? [];
      dashboard.fixedBeamDegrees =
        dashboard.raw.AEC_FIXEDBEAMSAZIMUTH_VALUES?.degreeValues ?? [];
      dashboard.selectedAzimuthDegrees =
        dashboard.raw.AUDIO_MGR_SELECTED_AZIMUTHS?.degreeValues ?? [];
      dashboard.freeRunningDegrees = dashboard.beamDegrees[2];
      dashboard.autoSelectDegrees = dashboard.beamDegrees[3];
      dashboard.speechEnergy =
        dashboard.raw.AEC_SPENERGY_VALUES?.numericValues ?? [];
      dashboard.speechDetected = dashboard.speechEnergy.some((value) => value > 0);

      dashboard.ledEffect = dashboard.raw.LED_EFFECT?.numericValues[0];
      dashboard.ledColor = toHexColor(dashboard.raw.LED_COLOR?.numericValues[0]);
      dashboard.ledDoaColors = (
        dashboard.raw.LED_DOA_COLOR?.numericValues ?? []
      )
        .map((value) => toHexColor(value))
        .filter((value): value is string => Boolean(value));

      dashboard.micGain = dashboard.raw.AUDIO_MGR_MIC_GAIN?.numericValues[0];
      dashboard.refGain = dashboard.raw.AUDIO_MGR_REF_GAIN?.numericValues[0];
      dashboard.agcEnabled =
        dashboard.raw.PP_AGCONOFF?.numericValues[0] === 1;
      dashboard.agcMaxGain = dashboard.raw.PP_AGCMAXGAIN?.numericValues[0];
      dashboard.agcDesiredLevel =
        dashboard.raw.PP_AGCDESIREDLEVEL?.numericValues[0];
      dashboard.noiseStationary = dashboard.raw.PP_MIN_NS?.numericValues[0];
      dashboard.noiseNonStationary = dashboard.raw.PP_MIN_NN?.numericValues[0];
      dashboard.routing = {
        left: parseRoutingPair(dashboard.raw.AUDIO_MGR_OP_L?.payloadText),
        right: parseRoutingPair(dashboard.raw.AUDIO_MGR_OP_R?.payloadText)
      };

      dashboard.generatedAt = new Date().toISOString();
      return dashboard;
    });
  }
}

export function parseCatalogOutput(output: string) {
  return parseCatalog(output);
}
