let electron;
try {
  electron = require("electron");
  if (!electron || !electron.app) {
    throw new Error("Electron module loaded but APIs not available");
  }
} catch (error) {
  console.error("Failed to load electron:", error);
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, dialog, session } = electron;
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const os = require("os");

let mainWindow;

function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    backgroundColor: "#1a1a1a",
    title: "IPTV Player",
  });

  mainWindow.maximize();

  if (isDev) {
    mainWindow.loadURL("http://localhost:3001"); // expo start --web --port 3001
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html")); // expo export output
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Inject IPTV-compatible headers for all outgoing requests
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      try {
        const urlObj = new URL(details.url);
        details.requestHeaders["User-Agent"] =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) IPTVSmartersPro/1.1.1 Chrome/53.0.2785.143 Electron/1.4.16 Safari/537.36";
        details.requestHeaders["Referer"] = `${urlObj.protocol}//${urlObj.host}/`;
        details.requestHeaders["Accept-Language"] = "en-US";
      } catch (_e) {
        // ignore malformed URLs
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle("select-playlist", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "M3U Playlist", extensions: ["m3u", "m3u8"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const content = fs.readFileSync(result.filePaths[0], "utf-8");
      return { success: true, content, path: result.filePaths[0] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: "No file selected" };
});

ipcMain.handle("save-playlist", async (_event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: "M3U Playlist", extensions: ["m3u"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!result.canceled && result.filePath) {
    try {
      fs.writeFileSync(result.filePath, content, "utf-8");
      return { success: true, path: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: "Save canceled" };
});

function buildVLCCommand(streamUrl, vlcArgs, platform) {
  const argsString = vlcArgs.length > 0 ? vlcArgs.join(" ") : "";

  switch (platform) {
    case "darwin":
      return `open -a VLC "${streamUrl}"${argsString ? ` --args ${argsString}` : ""}`;
    case "win32":
      return `"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"${argsString ? ` ${argsString}` : ""} "${streamUrl}"`;
    default:
      return `vlc${argsString ? ` ${argsString}` : ""} "${streamUrl}"`;
  }
}

ipcMain.handle("open-in-vlc", async (_event, streamUrl, options = {}) => {
  const { startTime = 0, name = "Stream" } = options;
  const platform = os.platform();
  const vlcArgs = [];

  if (startTime > 0) {
    vlcArgs.push(`--start-time=${Math.floor(startTime)}`);
  }
  if (name) {
    vlcArgs.push(`--meta-title="${name}"`);
  }

  const vlcCommand = buildVLCCommand(streamUrl, vlcArgs, platform);

  return new Promise((resolve) => {
    exec(vlcCommand, (error, _stdout, stderr) => {
      if (error) {
        console.error("Error opening VLC:", error);
        console.error("stderr:", stderr);
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});
