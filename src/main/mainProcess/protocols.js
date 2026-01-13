const { app, protocol, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

const { state, srcDir } = require("./state");
const { isExistingDirectory, resolveWithinDir } = require("./pathSafety");

function registerProtocols() {
  try {
    protocol.registerFileProtocol("nw-sandbox", (request, callback) => {
      try {
        const u = new URL(request.url);
        const pathname = u.pathname || "/";
        const allowed = new Map([
          [
            "/moduleSandbox.html",
            app.isPackaged
              ? path.join(srcDir, "projector", "views", "moduleSandbox.prod.html")
              : path.join(srcDir, "projector", "views", "moduleSandbox.html"),
          ],
          ["/moduleSandbox.js", path.join(srcDir, "..", "dist", "moduleSandbox.js")],
          [
            "/moduleSandbox.js.map",
            path.join(srcDir, "..", "dist", "moduleSandbox.js.map"),
          ],
        ]);

        const filePath = allowed.get(pathname);
        if (!filePath) return callback({ error: -6 });
        return callback({ path: filePath });
      } catch {
        return callback({ error: -2 });
      }
    });
  } catch {}

  try {
    protocol.registerFileProtocol("nw-assets", (request, callback) => {
      try {
        const u = new URL(request.url);
        const pathname = u.pathname || "/";
        const raw = pathname.startsWith("/") ? pathname.slice(1) : pathname;
        const parts = raw.split("/").filter(Boolean);
        const token = parts.length ? decodeURIComponent(parts[0]) : null;
        const relPath =
          parts.length > 1
            ? parts
                .slice(1)
                .map((p) => decodeURIComponent(p))
                .join("/")
            : "";

        if (!token || !state.sandboxTokenToProjectDir.has(token)) {
          return callback({ error: -6 });
        }

        if (!relPath) {
          return callback({ error: -6 });
        }

        const entry = state.sandboxTokenToProjectDir.get(token) || null;
        const projectDir = entry?.projectDir || null;
        if (!projectDir || !isExistingDirectory(projectDir)) {
          return callback({ error: -6 });
        }

        const assetsDir = path.join(projectDir, "assets");
        const fullPath = resolveWithinDir(assetsDir, relPath);
        if (!fullPath) {
          return callback({ error: -6 });
        }
        return callback({ path: fullPath });
      } catch {
        return callback({ error: -2 });
      }
    });
  } catch {}

  if (process.platform === "darwin" && !app.isPackaged) {
    try {
      const iconPath = path.join(srcDir, "assets", "images", "blueprint.png");
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    } catch (err) {
      console.error("[Main] Failed to set dock icon:", err?.message || err);
    }
  }
}

module.exports = { registerProtocols };

