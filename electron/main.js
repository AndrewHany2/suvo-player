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
const { resolveAppAssetPath } = require("./appAssetPath.js");

// The only origins our own renderer is ever served from: the packaged app://
// scheme, and the Expo dev server in development. Everything else is untrusted.
const ALLOWED_ORIGINS = ["app://localhost", "http://localhost:3001"];

// Gate every IPC handler on the sender's origin so a stray/injected frame (or a
// page navigated away from our origin) can't reach the file/dialog/VLC bridge.
function isTrustedSender(event) {
  const url = event.senderFrame?.url || "";
  return ALLOWED_ORIGINS.some((o) => url.startsWith(o));
}

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
      // NOTE: kept off because the renderer fetches cross-origin http(s) IPTV
      // streams directly; removing it needs a main-process fetch proxy (or a
      // scoped CORS rewrite) and Electron+real-stream verification. The nav
      // guards + IPC origin-gate below are the defense-in-depth that don't
      // require that rework.
      //
      // A companion CSP is likewise deferred (runtime-gated): to avoid breaking
      // the app it must allow, at minimum —
      //   connect-src / media-src / img-src : http: https: blob: data:
      //       (arbitrary USER-configured IPTV stream origins + TMDB artwork —
      //        the set isn't known ahead of time, so these can't be narrowed)
      //   frame-src : https://www.youtube.com https://www.youtube-nocookie.com
      //       (trailer embeds in MovieDetail/SeriesDetail + the TV screens)
      //   script-src / worker-src : must include blob:
      //       (hls.js runs with enableWorker:true → spins a blob: Web Worker;
      //        omit and playback silently fails)
      //   style-src : 'unsafe-inline'  (react-native-web injects inline styles)
      // Any omission white-screens the app or kills playback/trailers — none of
      // which is catchable without launching a packaged Electron build against
      // real streams, so it stays out until that verification is possible.
      webSecurity: false,
    },
    backgroundColor: "#0A0E1A",
    title: "Suvo",
  });

  mainWindow.maximize();

  // Lock the renderer down (defense-in-depth even with contextIsolation on):
  // deny all popups, and block navigating the main frame away from our origin.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!ALLOWED_ORIGINS.some((o) => url.startsWith(o))) event.preventDefault();
  });

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

  // Serve built expo web assets via app://. resolveAppAssetPath enforces that the
  // resolved file stays inside distPath (rejects encoded traversal), so this file
  // server can never read arbitrary disk even if a crafted app:// URL reaches it.
  protocol.registerFileProtocol("app", (request, callback) => {
    callback(resolveAppAssetPath(distPath, request.url));
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
ipcMain.handle("select-playlist", async (event) => {
  if (!isTrustedSender(event)) return { success: false, error: "Untrusted sender" };
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

ipcMain.handle("save-playlist", async (event, content) => {
  if (!isTrustedSender(event)) return { success: false, error: "Untrusted sender" };
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

ipcMain.handle("open-in-vlc", async (event, streamUrl, options = {}) => {
  if (!isTrustedSender(event)) return { success: false, error: "Untrusted sender" };
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
