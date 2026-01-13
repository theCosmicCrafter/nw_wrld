const path = require("path");

const srcDir = path.resolve(__dirname, "..", "..");

const state = {
  projector1Window: null,
  dashboardWindow: null,
  inputManager: null,
  workspaceWatcher: null,
  workspaceWatcherDebounce: null,
  currentWorkspacePath: null,
  currentProjectDir: null,
  didRegisterAppLifecycleHandlers: false,
  webContentsToProjectDir: new Map(),
  sandboxTokenToProjectDir: new Map(),
  sandboxOwnerWebContentsIdToTokens: new Map(),
  sandboxOwnerCleanupHooked: new Set(),
  sandboxView: null,
  sandboxViewWebContentsId: null,
  activeSandboxToken: null,
  sandboxEnsureInFlight: null,
  projectorDefaultBounds: null,
  pendingSandboxRequests: new Map(),
  didRunShutdownCleanup: false,
};

module.exports = { state, srcDir };
