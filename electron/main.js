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

const { app, BrowserWindow, ipcMain, dialog, session, protocol } = electron;
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const os = require("os");
const { buildVlcInvocation } = require("./vlcInvocation.js");

// Must be called before app.whenReady — registers app:// as a secure standard scheme
// so root-relative paths in the expo build (/_expo/...) resolve within the scheme
// instead of resolving to file:///C:/_expo/... (filesystem root)
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } },
]);

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
    backgroundColor: "#0A0E1A",
    title: "Suvo",
  });

  mainWindow.maximize();

  if (isDev) {
    // Hide Expo's Fast Refresh badge (the flashing lightning-bolt in the
    // bottom-left). It's dev-server-only overlay UI; hiding it keeps hot
    // reload working. Re-inject on every load since navigations reset CSS.
    mainWindow.webContents.on("dom-ready", () => {
      mainWindow.webContents.insertCSS(
        ".__expo_fast_refresh { display: none !important; }",
      );
    });
    mainWindow.loadURL("http://localhost:3001");
  } else {
    mainWindow.loadURL("app://localhost/index.html");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const distPath = path.join(__dirname, "../dist");

  // Serve built expo web assets via app:// — standard scheme parses URLs like http,
  // so use URL.pathname to get the file path (strips scheme + host correctly)
  protocol.registerFileProtocol("app", (request, callback) => {
    const { pathname } = new URL(request.url);
    const filePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    callback({ path: path.join(distPath, filePath) });
  });

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

ipcMain.handle("open-in-vlc", async (_event, streamUrl, options = {}) => {
  // Untrusted streamUrl/name — build an argv array and spawn without a shell.
  // buildVlcInvocation validates the URL (http/https only) and returns null on
  // anything unsafe, so a crafted stream name/URL cannot inject a command.
  const invocation = buildVlcInvocation(streamUrl, options, os.platform());
  if (!invocation) {
    return { success: false, error: "Invalid or unsupported stream URL" };
  }

  return new Promise((resolve) => {
    execFile(invocation.file, invocation.args, (error, _stdout, stderr) => {
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
