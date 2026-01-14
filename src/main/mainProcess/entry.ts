import { app, ipcMain } from "electron";

import { setupApp } from "./appSetup";
import { registerIpcBridge } from "./ipcBridge";
import { registerLifecycle, registerActivate } from "./lifecycle";
import { registerProtocols } from "./protocols";
import { registerSandboxIpc } from "./sandbox";
import { state } from "./state";
import { createWindow, registerMessagingIpc } from "./windows";
import { registerWorkspaceSelectionIpc } from "./workspace";

export function start() {
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
