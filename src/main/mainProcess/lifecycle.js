const { app, BrowserWindow } = require("electron");

const { state } = require("./state");

function registerLifecycle({ createWindow }) {
  app.on("before-quit", (event) => {
    if (state.didRunShutdownCleanup) return;
    state.didRunShutdownCleanup = true;
    event.preventDefault();

    (async () => {
      if (state.inputManager) {
        try {
          await state.inputManager.disconnect();
        } catch (e) {
          console.error("[Main] Failed to disconnect InputManager on quit:", e);
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        try {
          app.quit();
        } catch {}
      });
  });
}

function registerActivate({ createWindow }) {
  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      state.currentProjectDir = null;
      createWindow(null);
    }
  });
}

module.exports = { registerLifecycle, registerActivate };

