const { app, ipcMain } = require("electron");

const { state } = require("./state");
const { setupApp } = require("./appSetup");
const { registerIpcBridge } = require("./ipcBridge");
const { registerSandboxIpc } = require("./sandbox");
const { registerProtocols } = require("./protocols");
const { createWindow, registerMessagingIpc } = require("./windows");
const { registerWorkspaceSelectionIpc } = require("./workspace");
const { registerLifecycle, registerActivate } = require("./lifecycle");

function start() {
  setupApp();

  registerIpcBridge();
  registerSandboxIpc();
  registerMessagingIpc({ ipcMain });
  registerWorkspaceSelectionIpc({ createWindow });
  registerLifecycle({ createWindow });

  app.whenReady().then(() => {
    registerProtocols();
    state.currentProjectDir = null;
    registerActivate({ createWindow });
    createWindow(null);
  });
}

module.exports = { start };
