const { BrowserView, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const { state, srcDir } = require("./state");
const { isExistingDirectory, resolveWithinDir } = require("./pathSafety");

const {
  normalizeSandboxResult,
  normalizeSandboxRequestProps,
} = require(path.join(
  srcDir,
  "..",
  "dist",
  "runtime",
  "shared",
  "validation",
  "sandboxValidation.js"
));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SANDBOX_ASSET_TEXT_MAX_BYTES = 2 * 1024 * 1024;

const readFileUtf8WithLimit = async (filePath, maxBytes) => {
  try {
    const stat = await fs.promises.stat(filePath);
    const limit = Math.max(0, Number(maxBytes) || 0);
    if (limit && stat.size > limit) return null;
    return await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
};

const getProjectDirForEvent = (event) => {
  try {
    const senderId = event?.sender?.id;
    if (
      typeof senderId === "number" &&
      state.webContentsToProjectDir.has(senderId)
    ) {
      return state.webContentsToProjectDir.get(senderId) || null;
    }
  } catch {}
  return state.currentProjectDir || null;
};

const registerSandboxToken = (event, token, projectDir) => {
  const safeToken = String(token || "").trim();
  if (!safeToken) return { ok: false, reason: "INVALID_TOKEN" };
  const ownerWebContentsId =
    typeof event?.sender?.id === "number" ? event.sender.id : null;
  if (ownerWebContentsId == null)
    return { ok: false, reason: "INVALID_SENDER" };

  state.sandboxTokenToProjectDir.set(safeToken, {
    projectDir,
    ownerWebContentsId,
    createdAt: Date.now(),
  });

  if (!state.sandboxOwnerWebContentsIdToTokens.has(ownerWebContentsId)) {
    state.sandboxOwnerWebContentsIdToTokens.set(ownerWebContentsId, new Set());
  }
  state.sandboxOwnerWebContentsIdToTokens.get(ownerWebContentsId).add(safeToken);

  if (!state.sandboxOwnerCleanupHooked.has(ownerWebContentsId)) {
    state.sandboxOwnerCleanupHooked.add(ownerWebContentsId);
    try {
      event.sender.once("destroyed", () => {
        const tokens =
          state.sandboxOwnerWebContentsIdToTokens.get(ownerWebContentsId);
        if (tokens && tokens.size) {
          for (const t of tokens) {
            try {
              state.sandboxTokenToProjectDir.delete(t);
            } catch {}
          }
        }
        try {
          state.sandboxOwnerWebContentsIdToTokens.delete(ownerWebContentsId);
        } catch {}
        try {
          state.sandboxOwnerCleanupHooked.delete(ownerWebContentsId);
        } catch {}
      });
    } catch {}
  }

  return { ok: true };
};

const unregisterSandboxToken = (token) => {
  const safeToken = String(token || "").trim();
  if (!safeToken) return false;
  const entry = state.sandboxTokenToProjectDir.get(safeToken) || null;
  const ownerWebContentsId =
    entry && typeof entry.ownerWebContentsId === "number"
      ? entry.ownerWebContentsId
      : null;
  try {
    state.sandboxTokenToProjectDir.delete(safeToken);
  } catch {}
  if (typeof ownerWebContentsId === "number") {
    const tokens = state.sandboxOwnerWebContentsIdToTokens.get(ownerWebContentsId);
    if (tokens) {
      try {
        tokens.delete(safeToken);
      } catch {}
      if (tokens.size === 0) {
        try {
          state.sandboxOwnerWebContentsIdToTokens.delete(ownerWebContentsId);
        } catch {}
      }
    }
  }
  return true;
};

const updateSandboxViewBounds = () => {
  if (
    !state.sandboxView ||
    !state.projector1Window ||
    state.projector1Window.isDestroyed()
  ) {
    return;
  }
  try {
    const [width, height] = state.projector1Window.getContentSize();
    state.sandboxView.setBounds({ x: 0, y: 0, width, height });
  } catch {}
};

const destroySandboxView = () => {
  if (!state.sandboxView) return;
  try {
    state.projector1Window?.setBrowserView?.(null);
  } catch {}
  try {
    state.sandboxView?.webContents?.destroy?.();
  } catch {}
  state.sandboxView = null;
  state.sandboxViewWebContentsId = null;
};

const ensureSandboxView = (projectDir) => {
  if (!state.projector1Window || state.projector1Window.isDestroyed()) return null;
  if (
    state.sandboxView &&
    state.sandboxView.webContents &&
    !state.sandboxView.webContents.isDestroyed()
  ) {
    try {
      state.projector1Window.setBrowserView(state.sandboxView);
      updateSandboxViewBounds();
    } catch {}
    return state.sandboxView;
  }

  try {
    destroySandboxView();
  } catch {}

  state.sandboxView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(srcDir, "sandboxPreload.js"),
      enableRemoteModule: false,
      backgroundThrottling: false,
      webgl: true,
      enableHardwareAcceleration: true,
      additionalArguments: [
        "--nwWrldRequireProject=1",
        projectDir && typeof projectDir === "string"
          ? `--nwWrldProjectDir=${projectDir}`
          : null,
      ].filter(Boolean),
    },
  });

  try {
    const wc = state.sandboxView.webContents;
    state.sandboxViewWebContentsId = typeof wc?.id === "number" ? wc.id : null;
    wc.on("render-process-gone", () => {
      try {
        if (state.activeSandboxToken) {
          try {
            unregisterSandboxToken(state.activeSandboxToken);
          } catch {}
        }
        state.sandboxViewWebContentsId = null;
        state.activeSandboxToken = null;
        destroySandboxView();
      } catch {}
    });
    wc.on("unresponsive", () => {
      try {
        if (state.activeSandboxToken) {
          try {
            unregisterSandboxToken(state.activeSandboxToken);
          } catch {}
        }
        state.sandboxViewWebContentsId = null;
        state.activeSandboxToken = null;
        destroySandboxView();
      } catch {}
    });
  } catch {}

  try {
    state.projector1Window.setBrowserView(state.sandboxView);
    updateSandboxViewBounds();
  } catch {}

  return state.sandboxView;
};

const isProjectorEvent = (event) => {
  try {
    const senderId = event?.sender?.id;
    return (
      typeof senderId === "number" &&
      state.projector1Window &&
      !state.projector1Window.isDestroyed() &&
      state.projector1Window.webContents &&
      !state.projector1Window.webContents.isDestroyed() &&
      senderId === state.projector1Window.webContents.id
    );
  } catch {
    return false;
  }
};

const sandboxRequestAllowedTypes = new Set([
  "initTrack",
  "invokeOnInstance",
  "introspectModule",
  "destroyTrack",
  "setMatrixForInstance",
]);

const sendToSandbox = (payload) => {
  if (
    !state.sandboxView ||
    !state.sandboxView.webContents ||
    state.sandboxView.webContents.isDestroyed()
  ) {
    return false;
  }
  try {
    state.sandboxView.webContents.send("sandbox:fromMain", payload);
    return true;
  } catch {
    return false;
  }
};

const destroySandboxForProjector = (ownerWebContentsId) => {
  if (state.activeSandboxToken) {
    try {
      unregisterSandboxToken(state.activeSandboxToken);
    } catch {}
    state.activeSandboxToken = null;
  }

  if (typeof ownerWebContentsId === "number") {
    const tokens =
      state.sandboxOwnerWebContentsIdToTokens.get(ownerWebContentsId);
    if (tokens && tokens.size) {
      for (const t of tokens) {
        try {
          unregisterSandboxToken(t);
        } catch {}
      }
    }
  }

  for (const [requestId, entry] of state.pendingSandboxRequests.entries()) {
    try {
      clearTimeout(entry.timeout);
    } catch {}
    try {
      entry.resolve({ ok: false, error: "SANDBOX_DESTROYED" });
    } catch {}
    state.pendingSandboxRequests.delete(requestId);
  }

  try {
    destroySandboxView();
  } catch {}
};

function registerSandboxIpc() {
  ipcMain.on("bridge:sandbox:registerToken", (event, token) => {
    const projectDir = getProjectDirForEvent(event);
    if (!projectDir || !isExistingDirectory(projectDir)) {
      event.returnValue = { ok: false, reason: "PROJECT_DIR_MISSING" };
      return;
    }
    event.returnValue = registerSandboxToken(event, token, projectDir);
  });

  ipcMain.on("bridge:sandbox:unregisterToken", (event, token) => {
    event.returnValue = unregisterSandboxToken(token);
  });

  ipcMain.handle("sandbox:ensure", async (event) => {
    if (!isProjectorEvent(event)) return { ok: false, reason: "FORBIDDEN" };
    const projectDir = getProjectDirForEvent(event);
    if (!projectDir || !isExistingDirectory(projectDir)) {
      return { ok: false, reason: "PROJECT_DIR_MISSING" };
    }

    if (state.sandboxEnsureInFlight) {
      try {
        await state.sandboxEnsureInFlight;
      } catch {}
    }

    const view = ensureSandboxView(projectDir);
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { ok: false, reason: "SANDBOX_VIEW_UNAVAILABLE" };
    }

    if (state.activeSandboxToken) {
      const entry =
        state.sandboxTokenToProjectDir.get(state.activeSandboxToken) || null;
      if (entry?.projectDir === projectDir) {
        return { ok: true, token: state.activeSandboxToken };
      }
      try {
        unregisterSandboxToken(state.activeSandboxToken);
      } catch {}
      state.activeSandboxToken = null;
    }

    const p = (async () => {
      const token = `nw_${Math.random().toString(16).slice(2)}_${Date.now()}`;
      const reg = registerSandboxToken(event, token, projectDir);
      if (!reg || reg.ok !== true) {
        return { ok: false, reason: reg?.reason || "TOKEN_REGISTER_FAILED" };
      }

      const url = `nw-sandbox://app/moduleSandbox.html#token=${encodeURIComponent(
        token
      )}`;
      try {
        await view.webContents.loadURL(url);
      } catch {
        unregisterSandboxToken(token);
        return { ok: false, reason: "SANDBOX_LOAD_FAILED" };
      }

      state.activeSandboxToken = token;
      return { ok: true, token };
    })();

    state.sandboxEnsureInFlight = p;
    try {
      return await p;
    } finally {
      if (state.sandboxEnsureInFlight === p) state.sandboxEnsureInFlight = null;
    }
  });

  ipcMain.handle("sandbox:destroy", async (event) => {
    if (!isProjectorEvent(event)) return { ok: false, reason: "FORBIDDEN" };
    const ownerId =
      typeof event?.sender?.id === "number" ? event.sender.id : null;
    destroySandboxForProjector(ownerId);
    return { ok: true };
  });

  ipcMain.handle("sandbox:request", async (event, payload) => {
    if (!isProjectorEvent(event)) return { ok: false, error: "FORBIDDEN" };
    const ownerId =
      typeof event?.sender?.id === "number" ? event.sender.id : null;
    const token = String(payload?.token || "").trim();
    const type = String(payload?.type || "").trim();
    const props = payload?.props || {};
    if (!token) return { ok: false, error: "INVALID_TOKEN" };
    if (!type || !sandboxRequestAllowedTypes.has(type)) {
      return { ok: false, error: "INVALID_TYPE" };
    }
    const entry = state.sandboxTokenToProjectDir.get(token) || null;
    if (!entry || entry.ownerWebContentsId !== ownerId) {
      return { ok: false, error: "TOKEN_NOT_OWNED" };
    }

    let safeProps = {};
    try {
      const normalized = normalizeSandboxRequestProps(type, props);
      if (!normalized || normalized.ok !== true) {
        return { ok: false, error: normalized?.error || "INVALID_PROPS" };
      }
      safeProps = normalized.props || {};
    } catch (e) {
      return { ok: false, error: e?.message || "INVALID_PROPS" };
    }

    const requestId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const sent = sendToSandbox({
      __nwWrldSandbox: true,
      token,
      type,
      requestId,
      props: safeProps,
    });
    if (!sent) return { ok: false, error: "SANDBOX_UNAVAILABLE" };

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!state.pendingSandboxRequests.has(requestId)) return;
        state.pendingSandboxRequests.delete(requestId);
        resolve({ ok: false, error: "TIMEOUT" });
      }, 8000);
      state.pendingSandboxRequests.set(requestId, { resolve, timeout, token });
    });
  });

  ipcMain.on("sandbox:toMain", async (event, payload) => {
    const senderId =
      typeof event?.sender?.id === "number" ? event.sender.id : null;
    if (!senderId || senderId !== state.sandboxViewWebContentsId) return;
    const data = payload;
    if (!data || typeof data !== "object") return;

    const token = String(data.token || "").trim();
    const requestId = String(data.requestId || "").trim();
    if (!token || !requestId) return;

    if (data.__nwWrldSandboxResult) {
      const pending = state.pendingSandboxRequests.get(requestId);
      if (!pending) return;
      if (pending.token !== token) return;
      state.pendingSandboxRequests.delete(requestId);
      try {
        clearTimeout(pending.timeout);
      } catch {}
      try {
        pending.resolve(normalizeSandboxResult(String(data.type || ""), data.result));
      } catch {}
      return;
    }

    if (data.__nwWrldSandbox && data.type === "sdk:readAssetText") {
      if (!state.activeSandboxToken || token !== state.activeSandboxToken) {
        return;
      }
      const entry = state.sandboxTokenToProjectDir.get(token) || null;
      const projectDir = entry?.projectDir || null;
      const relPath = String(data.props?.relPath || "");
      let result = { ok: false, text: null };
      if (projectDir && isExistingDirectory(projectDir)) {
        const assetsDir = path.join(projectDir, "assets");
        const fullPath = resolveWithinDir(assetsDir, relPath);
        if (fullPath) {
          const text = await readFileUtf8WithLimit(
            fullPath,
            SANDBOX_ASSET_TEXT_MAX_BYTES
          );
          if (typeof text === "string") {
            result = { ok: true, text };
          }
        }
      }
      sendToSandbox({
        __nwWrldSandboxResult: true,
        token,
        requestId,
        result,
      });
    }

    if (data.__nwWrldSandbox && data.type === "sdk:listAssets") {
      if (!state.activeSandboxToken || token !== state.activeSandboxToken) {
        return;
      }
      const entry = state.sandboxTokenToProjectDir.get(token) || null;
      const projectDir = entry?.projectDir || null;
      const relDir = String(data.props?.relDir || "");
      let result = { ok: false, entries: [] };
      if (projectDir && isExistingDirectory(projectDir)) {
        const assetsDir = path.join(projectDir, "assets");
        const fullPath = resolveWithinDir(assetsDir, relDir);
        if (fullPath) {
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat && stat.isDirectory()) {
              const dirents = await fs.promises.readdir(fullPath, {
                withFileTypes: true,
              });
              const entries = dirents
                .filter((d) => d && d.isFile && d.isFile())
                .map((d) => String(d.name || ""))
                .filter(Boolean);
              result = { ok: true, entries };
            }
          } catch {}
        }
      }
      sendToSandbox({
        __nwWrldSandboxResult: true,
        token,
        requestId,
        result,
      });
    }
  });
}

module.exports = {
  registerSandboxIpc,
  updateSandboxViewBounds,
  destroySandboxView,
  ensureSandboxView,
  unregisterSandboxToken,
  registerSandboxToken,
};

