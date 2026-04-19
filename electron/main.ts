import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BinaryPathResult,
  BootstrapPayload,
  FixedBeamWindowPayload,
  WriteCommandPayload
} from "../src/shared/types";
import { ReSpeakerController, discoverBinaryPath } from "./respeakerCli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let controller = new ReSpeakerController();

function getConfigPath() {
  return path.join(app.getPath("userData"), "respeaker-ui.json");
}

function loadSavedBinaryPath() {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as { binaryPath?: string | null };
    return parsed.binaryPath ?? null;
  } catch {
    return null;
  }
}

function saveBinaryPath(binaryPath: string | null) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(
    getConfigPath(),
    JSON.stringify({ binaryPath }, null, 2),
    "utf8"
  );
}

function binaryPathResult(): BinaryPathResult {
  return {
    binaryPath: controller.getBinaryPath(),
    autoDiscoveredPath: controller.getAutoDiscoveredPath()
  };
}

async function buildBootstrap(): Promise<BootstrapPayload> {
  const commands = await controller.listCommands();
  const dashboard = await controller.readDashboardState(commands);

  return {
    binaryPath: controller.getBinaryPath(),
    autoDiscoveredPath: controller.getAutoDiscoveredPath(),
    commands,
    dashboard
  };
}

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.mjs");

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 1040,
    minWidth: 1280,
    minHeight: 880,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#09101c",
    title: "ReSpeaker USB UI",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("app:bootstrap", async () => buildBootstrap());
  ipcMain.handle("device:refresh-dashboard", async () =>
    controller.readDashboardState()
  );
  ipcMain.handle("device:refresh-preview", async () =>
    controller.readPreviewState()
  );
  ipcMain.handle("device:refresh-signals", async () =>
    controller.readSignalState()
  );
  ipcMain.handle("device:refresh-live", async () => controller.readLiveState());
  ipcMain.handle("device:refresh-live-details", async () =>
    controller.readLiveDetailState()
  );
  ipcMain.handle("device:refresh-commands", async (_event, force: boolean) =>
    controller.listCommands(force)
  );
  ipcMain.handle("device:read-command", async (_event, name: string) =>
    controller.readCommand(name)
  );
  ipcMain.handle("device:read-commands", async (_event, names: string[]) =>
    controller.readCommands(names)
  );
  ipcMain.handle(
    "device:write-command",
    async (_event, payload: WriteCommandPayload) =>
      controller.writeCommand(payload.name, payload.values)
  );
  ipcMain.handle(
    "device:set-binary-path",
    async (_event, binaryPath: string | null) => {
      controller.setBinaryPath(binaryPath);
      saveBinaryPath(binaryPath);
      return binaryPathResult();
    }
  );
  ipcMain.handle("device:browse-binary-path", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select xvf_host.exe",
      properties: ["openFile"],
      filters: [{ name: "Executable", extensions: ["exe"] }]
    });

    if (!result.canceled && result.filePaths[0]) {
      controller.setBinaryPath(result.filePaths[0]);
      saveBinaryPath(result.filePaths[0]);
    }

    return binaryPathResult();
  });
  ipcMain.handle("device:set-room-mode", async () => controller.setRoomMode());
  ipcMain.handle("device:set-fixed-mode", async () => controller.setFixedMode());
  ipcMain.handle(
    "device:set-fixed-beam-window",
    async (_event, payload: FixedBeamWindowPayload) =>
      controller.setFixedBeamWindow(payload.centerDegrees, payload.widthDegrees)
  );
  ipcMain.handle("device:save-configuration", async () =>
    controller.saveConfiguration()
  );
  ipcMain.handle("device:clear-configuration", async () =>
    controller.clearConfiguration()
  );
  ipcMain.handle("device:reboot", async () => controller.reboot());
}

app.whenReady().then(() => {
  const savedBinaryPath = loadSavedBinaryPath();
  controller = new ReSpeakerController(
    savedBinaryPath ?? discoverBinaryPath() ?? null
  );
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
