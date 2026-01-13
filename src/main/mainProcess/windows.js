const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const { state, srcDir } = require("./state");
const { isExistingDirectory, safeModuleName, resolveWithinDir } = require("./pathSafety");
const { startWorkspaceWatcher, getProjectJsonDirForMain } = require("./workspace");
const { updateSandboxViewBounds, destroySandboxView } = require("./sandbox");

const InputManagerModule = require(path.join(
  srcDir,
  "..",
  "dist",
  "runtime",
  "main",
  "InputManager.js"
));
const InputManager = InputManagerModule?.default || InputManagerModule;

const { DEFAULT_USER_DATA } = require(path.join(srcDir, "shared", "config", "defaultConfig"));

const getProjectorAspectRatioValue = (aspectRatioId) => {
  const id = String(aspectRatioId || "").trim();
  if (!id || id === "default" || id === "landscape") return 0;
  if (id === "16-9") return 16 / 9;
  if (id === "9-16") return 9 / 16;
  if (id === "4-5") return 4 / 5;
  return 0;
};

const applyProjectorWindowAspectRatio = (aspectRatioId) => {
  if (!state.projector1Window || state.projector1Window.isDestroyed()) return;

  const id = String(aspectRatioId || "").trim();

  try {
    state.projector1Window.setAspectRatio(getProjectorAspectRatioValue(aspectRatioId));
  } catch {}

  if (id === "fullscreen") {
    try {
      const bounds = state.projector1Window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const workArea = display?.workArea || bounds;
      state.projector1Window.setBounds(
        {
          x: workArea.x,
          y: workArea.y,
          width: workArea.width,
          height: workArea.height,
        },
        false
      );
    } catch {}
    return;
  }

  const ratio = getProjectorAspectRatioValue(aspectRatioId);

  if (!ratio) {
    if ((id === "default" || id === "landscape" || !id) && state.projectorDefaultBounds) {
      try {
        state.projector1Window.setBounds(state.projectorDefaultBounds, false);
      } catch {}
    }
    return;
  }

  try {
    const bounds = state.projector1Window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display?.workArea || bounds;

    let available = {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
    };

    const MIN_SIZE = 200;
    const safeAvailWidth = Math.max(MIN_SIZE, Math.floor(available.width || 0));
    const safeAvailHeight = Math.max(MIN_SIZE, Math.floor(available.height || 0));

    let nextWidth;
    let nextHeight;

    if (ratio >= 1) {
      nextWidth = Math.max(MIN_SIZE, safeAvailWidth);
      nextHeight = Math.max(MIN_SIZE, Math.floor(nextWidth / ratio));
      if (nextHeight > safeAvailHeight) {
        nextHeight = Math.max(MIN_SIZE, safeAvailHeight);
        nextWidth = Math.max(MIN_SIZE, Math.floor(nextHeight * ratio));
      }
    } else {
      nextHeight = Math.max(MIN_SIZE, safeAvailHeight);
      nextWidth = Math.max(MIN_SIZE, Math.floor(nextHeight * ratio));
      if (nextWidth > safeAvailWidth) {
        nextWidth = Math.max(MIN_SIZE, safeAvailWidth);
        nextHeight = Math.max(MIN_SIZE, Math.floor(nextWidth / ratio));
      }
    }

    const centerX = workArea.x + Math.round(workArea.width / 2);
    const centerY = workArea.y + Math.round(workArea.height / 2);

    const maxX = available.x + safeAvailWidth - nextWidth;
    const maxY = available.y + safeAvailHeight - nextHeight;

    let nextX = ratio < 1 ? maxX : centerX - Math.round(nextWidth / 2);
    let nextY = centerY - Math.round(nextHeight / 2);

    nextX = Math.max(available.x, Math.min(nextX, maxX));
    nextY = Math.max(available.y, Math.min(nextY, maxY));

    state.projector1Window.setBounds(
      {
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      },
      false
    );
  } catch {}
};

const getProjectDirForEvent = (event) => {
  try {
    const senderId = event?.sender?.id;
    if (typeof senderId === "number" && state.webContentsToProjectDir.has(senderId)) {
      return state.webContentsToProjectDir.get(senderId) || null;
    }
  } catch {}
  return state.currentProjectDir || null;
};

function loadConfig(projectDir) {
  const baseDir = getProjectJsonDirForMain(projectDir);
  if (!baseDir) return DEFAULT_USER_DATA;
  const configPath = path.join(baseDir, "userData.json");

  try {
    const data = fs.readFileSync(configPath, "utf-8");

    try {
      const parsed = JSON.parse(data);
      return parsed;
    } catch (parseErr) {
      console.error("[Main] JSON parse error - config file is corrupted:", parseErr.message);
      console.error("[Main] Using default configuration");
      return DEFAULT_USER_DATA;
    }
  } catch (readErr) {
    if (readErr.code === "ENOENT") {
      console.warn("[Main] Config file not found, using defaults");
    } else {
      console.error("[Main] Failed to read config file:", readErr.message);
    }
    return DEFAULT_USER_DATA;
  }
}

function registerMessagingIpc({ ipcMain }) {
  const messageChannels = {
    "dashboard-to-projector": (data) => {
      try {
        if (data?.type === "toggleAspectRatioStyle") {
          applyProjectorWindowAspectRatio(data?.props?.name);
        }
      } catch {}
      if (
        state.projector1Window &&
        !state.projector1Window.isDestroyed() &&
        state.projector1Window.webContents &&
        !state.projector1Window.webContents.isDestroyed()
      ) {
        state.projector1Window.webContents.send("from-dashboard", data);
      }
    },
    "projector-to-dashboard": (data) => {
      if (
        state.dashboardWindow &&
        !state.dashboardWindow.isDestroyed() &&
        state.dashboardWindow.webContents &&
        !state.dashboardWindow.webContents.isDestroyed()
      ) {
        state.dashboardWindow.webContents.send("from-projector", data);
      }
    },
  };

  Object.entries(messageChannels).forEach(([channel, handler]) => {
    ipcMain.on(channel, (event, data) => {
      handler(data);
    });
  });
}

function createWindow(projectDir) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: screenX, y: screenY } = primaryDisplay.workArea;

  const halfWidth = Math.floor(screenWidth / 2);
  const additionalArgs = ["--nwWrldRequireProject=1"];
  if (projectDir && typeof projectDir === "string") {
    additionalArgs.push(`--nwWrldProjectDir=${projectDir}`);
  }

  state.projector1Window = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(srcDir, "preload.js"),
      enableRemoteModule: false,
      backgroundThrottling: false,
      webgl: true,
      enableHardwareAcceleration: true,
      additionalArguments: additionalArgs,
      pageVisibility: true,
      autoplayPolicy: "no-user-gesture-required",
    },
    x: screenX + halfWidth,
    y: screenY,
    width: halfWidth,
    height: screenHeight,
    title: "Projector 1",
    show: false,
    paintWhenInitiallyHidden: true,
    frame: false,
  });

  try {
    state.projectorDefaultBounds = state.projector1Window.getBounds();
  } catch {}

  try {
    const initialConfig = loadConfig(projectDir);
    applyProjectorWindowAspectRatio(initialConfig?.config?.aspectRatio);
  } catch {}

  state.projector1Window.once("ready-to-show", () => {
    state.projector1Window.show();
  });

  state.projector1Window.loadFile(path.join(srcDir, "projector", "views", "projector.html"));
  state.projector1Window.on("resize", () => {
    updateSandboxViewBounds();
  });
  state.projector1Window.on("closed", () => {
    try {
      destroySandboxView();
    } catch {}
  });

  state.dashboardWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(srcDir, "preload.js"),
      enableHardwareAcceleration: true,
      backgroundThrottling: false,
      additionalArguments: additionalArgs,
    },
    x: screenX,
    y: screenY,
    width: halfWidth,
    height: screenHeight,
    title: "nw_wrld",
    show: false,
  });

  state.dashboardWindow.once("ready-to-show", () => {
    state.dashboardWindow.show();
  });

  try {
    if (state.dashboardWindow?.webContents?.id != null) {
      state.webContentsToProjectDir.set(state.dashboardWindow.webContents.id, projectDir || null);
      state.dashboardWindow.on("closed", () => {
        try {
          state.webContentsToProjectDir.delete(state.dashboardWindow.webContents.id);
        } catch {}
      });
    }
  } catch {}

  try {
    if (state.projector1Window?.webContents?.id != null) {
      state.webContentsToProjectDir.set(state.projector1Window.webContents.id, projectDir || null);
      state.projector1Window.on("closed", () => {
        try {
          state.webContentsToProjectDir.delete(state.projector1Window.webContents.id);
        } catch {}
      });
    }
  } catch {}

  state.dashboardWindow.loadFile(path.join(srcDir, "dashboard", "views", "dashboard.html"));

  state.dashboardWindow.webContents.once("did-finish-load", () => {
    const fullConfig = loadConfig(projectDir);
    state.inputManager = new InputManager(state.dashboardWindow, state.projector1Window);
    const { DEFAULT_INPUT_CONFIG } = require(path.join(srcDir, "shared", "config", "defaultConfig"));
    const inputConfig = fullConfig.config?.input || DEFAULT_INPUT_CONFIG;
    if (fullConfig.config?.sequencerMode !== true) {
      state.inputManager.initialize(inputConfig).catch((err) => {
        console.error("[Main] Failed to initialize InputManager:", err);
      });
    }
  });

  if (projectDir && typeof projectDir === "string") {
    startWorkspaceWatcher(projectDir);
  }

  if (!state.didRegisterAppLifecycleHandlers) {
    state.didRegisterAppLifecycleHandlers = true;
    app.on("window-all-closed", function () {
      if (process.platform !== "darwin") app.quit();
    });
  }
}

module.exports = {
  createWindow,
  registerMessagingIpc,
  loadConfig,
  applyProjectorWindowAspectRatio,
  getProjectDirForEvent,
};

