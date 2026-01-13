const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { state, srcDir } = require("./state");
const { isExistingDirectory } = require("./pathSafety");

const { ensureWorkspaceStarterModules } = require(
  path.join(srcDir, "main", "workspaceStarterModules")
);
const { ensureWorkspaceStarterAssets } = require(
  path.join(srcDir, "main", "workspaceStarterAssets")
);

const getLegacyJsonDirForMain = () => path.join(srcDir, "..", "src", "shared", "json");

const getFallbackJsonDirForMain = () => path.join(srcDir, "shared", "json");

const getProjectJsonDirForMain = (projectDir) => {
  if (!projectDir || typeof projectDir !== "string") return null;
  if (!isExistingDirectory(projectDir)) return null;
  const dir = path.join(projectDir, "nw_wrld_data", "json");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
};

const getJsonStatusForProject = (projectDir) => {
  if (!projectDir) {
    return { ok: false, reason: "NO_PROJECT_SELECTED", projectDir: null };
  }
  if (!isExistingDirectory(projectDir)) {
    return { ok: false, reason: "PROJECT_DIR_MISSING", projectDir };
  }
  return { ok: true, projectDir };
};

const getJsonDirForBridge = (projectDir) => {
  const status = getJsonStatusForProject(projectDir);
  if (!status.ok) {
    return getFallbackJsonDirForMain();
  }
  return getProjectJsonDirForMain(projectDir) || getFallbackJsonDirForMain();
};

const maybeMigrateLegacyJsonFileForBridge = (projectDir, filename) => {
  const destDir = getProjectJsonDirForMain(projectDir);
  if (!destDir) return;
  const legacyDir = getFallbackJsonDirForMain();
  if (destDir === legacyDir) return;
  const destPath = path.join(destDir, filename);
  if (fs.existsSync(destPath)) return;
  const legacyPath = path.join(legacyDir, filename);
  if (!fs.existsSync(legacyPath)) return;
  try {
    fs.copyFileSync(legacyPath, destPath);
    const legacyBackupPath = `${legacyPath}.backup`;
    const destBackupPath = `${destPath}.backup`;
    if (!fs.existsSync(destBackupPath) && fs.existsSync(legacyBackupPath)) {
      fs.copyFileSync(legacyBackupPath, destBackupPath);
    }
  } catch {}
};

const maybeMigrateJsonIntoProject = (projectDir) => {
  if (!projectDir || typeof projectDir !== "string") return;
  const destDir = getProjectJsonDirForMain(projectDir);
  if (!destDir) return;
  const legacyDir = getLegacyJsonDirForMain();

  ["userData.json", "appState.json", "config.json", "recordingData.json"].forEach((filename) => {
    const destPath = path.join(destDir, filename);
    if (fs.existsSync(destPath)) return;

    const srcCandidates = [path.join(legacyDir, filename)];
    const srcPath = srcCandidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (!srcPath) return;

    try {
      fs.copyFileSync(srcPath, destPath);
    } catch {}

    const srcBackupPath = `${srcPath}.backup`;
    const destBackupPath = `${destPath}.backup`;
    try {
      if (!fs.existsSync(destBackupPath) && fs.existsSync(srcBackupPath)) {
        fs.copyFileSync(srcBackupPath, destBackupPath);
      }
    } catch {}
  });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForWorkspaceSettle = async (modulesDir, filename) => {
  const maxAttempts = 6;
  const intervalMs = 120;
  const target = filename && typeof filename === "string" ? path.join(modulesDir, filename) : null;

  let prevSig = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (target) {
        const stat = await fs.promises.stat(target);
        const sig = `${stat.size}:${stat.mtimeMs}`;
        if (prevSig && sig === prevSig) return;
        prevSig = sig;
      } else {
        const entries = await fs.promises.readdir(modulesDir);
        const jsFiles = entries.filter((f) => f.endsWith(".js"));
        const stats = await Promise.all(
          jsFiles.map(async (f) => {
            try {
              const s = await fs.promises.stat(path.join(modulesDir, f));
              return `${f}:${s.size}:${s.mtimeMs}`;
            } catch {
              return `${f}:missing`;
            }
          })
        );
        const sig = stats.sort().join("|");
        if (prevSig && sig === prevSig) return;
        prevSig = sig;
      }
    } catch {
      return;
    }
    await delay(intervalMs);
  }
};

const broadcastWorkspaceModulesChanged = () => {
  if (
    state.dashboardWindow &&
    !state.dashboardWindow.isDestroyed() &&
    state.dashboardWindow.webContents &&
    !state.dashboardWindow.webContents.isDestroyed()
  ) {
    state.dashboardWindow.webContents.send("workspace:modulesChanged", {});
  }
  if (
    state.projector1Window &&
    !state.projector1Window.isDestroyed() &&
    state.projector1Window.webContents &&
    !state.projector1Window.webContents.isDestroyed()
  ) {
    state.projector1Window.webContents.send("workspace:modulesChanged", {});
  }
};

const broadcastWorkspaceLostSync = (workspacePath) => {
  const payload = { workspacePath: workspacePath || null };
  if (
    state.dashboardWindow &&
    !state.dashboardWindow.isDestroyed() &&
    state.dashboardWindow.webContents &&
    !state.dashboardWindow.webContents.isDestroyed()
  ) {
    state.dashboardWindow.webContents.send("workspace:lostSync", payload);
  }
  if (
    state.projector1Window &&
    !state.projector1Window.isDestroyed() &&
    state.projector1Window.webContents &&
    !state.projector1Window.webContents.isDestroyed()
  ) {
    state.projector1Window.webContents.send("workspace:lostSync", payload);
  }
};

const startWorkspaceWatcher = (workspacePath) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    state.currentWorkspacePath = null;
    if (state.workspaceWatcher) {
      try {
        state.workspaceWatcher.close();
      } catch {}
      state.workspaceWatcher = null;
    }
    if (state.workspaceWatcherDebounce) {
      try {
        clearTimeout(state.workspaceWatcherDebounce);
      } catch {}
      state.workspaceWatcherDebounce = null;
    }
    return;
  }

  if (workspacePath === state.currentWorkspacePath && state.workspaceWatcher) {
    return;
  }

  if (!isExistingDirectory(workspacePath)) {
    state.currentWorkspacePath = null;
    if (state.workspaceWatcher) {
      try {
        state.workspaceWatcher.close();
      } catch {}
      state.workspaceWatcher = null;
    }
    if (state.workspaceWatcherDebounce) {
      try {
        clearTimeout(state.workspaceWatcherDebounce);
      } catch {}
      state.workspaceWatcherDebounce = null;
    }
    broadcastWorkspaceLostSync(workspacePath);
    return;
  }

  state.currentWorkspacePath = workspacePath;

  if (state.workspaceWatcher) {
    try {
      state.workspaceWatcher.close();
    } catch {}
    state.workspaceWatcher = null;
  }
  if (state.workspaceWatcherDebounce) {
    try {
      clearTimeout(state.workspaceWatcherDebounce);
    } catch {}
    state.workspaceWatcherDebounce = null;
  }

  const modulesDir = path.join(workspacePath, "modules");
  try {
    fs.mkdirSync(modulesDir, { recursive: true });
  } catch {}

  try {
    state.workspaceWatcher = fs.watch(modulesDir, (eventType, filename) => {
      if (filename && !String(filename).endsWith(".js")) return;
      if (state.workspaceWatcherDebounce) {
        clearTimeout(state.workspaceWatcherDebounce);
      }
      state.workspaceWatcherDebounce = setTimeout(async () => {
        state.workspaceWatcherDebounce = null;
        try {
          await waitForWorkspaceSettle(modulesDir, filename);
        } catch {}
        broadcastWorkspaceModulesChanged();
      }, 350);
    });
    state.workspaceWatcher.on("error", () => {
      try {
        state.workspaceWatcher.close();
      } catch {}
      state.workspaceWatcher = null;
      broadcastWorkspaceLostSync(workspacePath);
    });
  } catch {
    state.workspaceWatcher = null;
  }
};

const ensureWorkspaceScaffold = async (workspacePath) => {
  if (!workspacePath || typeof workspacePath !== "string") return;

  try {
    fs.mkdirSync(workspacePath, { recursive: true });
  } catch {}
  if (!isExistingDirectory(workspacePath)) return;

  const modulesDir = path.join(workspacePath, "modules");
  try {
    fs.mkdirSync(modulesDir, { recursive: true });
  } catch {}

  try {
    ensureWorkspaceStarterAssets(workspacePath);
  } catch {}

  try {
    fs.mkdirSync(path.join(workspacePath, "nw_wrld_data", "json"), {
      recursive: true,
    });
  } catch {}

  const readmePath = path.join(workspacePath, "README.md");
  if (!fs.existsSync(readmePath)) {
    try {
      fs.writeFileSync(
        readmePath,
        [
          "# nw_wrld Modules Workspace",
          "",
          "Edit files in `modules/` and nw_wrld will reload them automatically.",
          "",
        ].join("\n"),
        "utf-8"
      );
    } catch {}
  }

  const moduleDevGuidePath = path.join(workspacePath, "MODULE_DEVELOPMENT.md");
  if (!fs.existsSync(moduleDevGuidePath)) {
    try {
      const sourcePath = path.join(srcDir, "..", "MODULE_DEVELOPMENT.md");
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, moduleDevGuidePath);
      }
    } catch {}
  }

  try {
    ensureWorkspaceStarterModules(modulesDir);
  } catch {}
};

function registerWorkspaceSelectionIpc({ createWindow }) {
  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    const workspacePath = result.filePaths[0];
    await ensureWorkspaceScaffold(workspacePath);
    maybeMigrateJsonIntoProject(workspacePath);
    state.currentProjectDir = workspacePath;

    if (state.inputManager) {
      try {
        await state.inputManager.disconnect();
      } catch {}
      state.inputManager = null;
    }

    const closeWindow = (win) =>
      new Promise((resolve) => {
        if (!win || win.isDestroyed()) return resolve();
        win.once("closed", () => resolve());
        try {
          win.close();
        } catch {
          resolve();
        }
      });

    await Promise.all([closeWindow(state.dashboardWindow), closeWindow(state.projector1Window)]);
    state.dashboardWindow = null;
    state.projector1Window = null;

    createWindow(workspacePath);
    return { cancelled: false, workspacePath };
  });
}

module.exports = {
  getProjectJsonDirForMain,
  getJsonStatusForProject,
  getJsonDirForBridge,
  maybeMigrateLegacyJsonFileForBridge,
  maybeMigrateJsonIntoProject,
  startWorkspaceWatcher,
  ensureWorkspaceScaffold,
  registerWorkspaceSelectionIpc,
};
