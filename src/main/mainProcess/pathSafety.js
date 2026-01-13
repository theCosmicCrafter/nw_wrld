const fs = require("fs");
const path = require("path");

const isExistingDirectory = (dirPath) => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
};

const resolveWithinDir = (baseDir, relPath) => {
  if (!baseDir || typeof baseDir !== "string") return null;
  if (!relPath || typeof relPath !== "string") return null;
  const safeRel = String(relPath).replace(/^[/\\]+/, "");
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, safeRel);
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`;
  if (!resolved.startsWith(baseWithSep) && resolved !== resolvedBase) {
    return null;
  }

  try {
    if (fs.existsSync(resolvedBase)) {
      try {
        if (fs.lstatSync(resolvedBase).isSymbolicLink()) return null;
      } catch {
        return null;
      }

      const baseReal = fs.realpathSync(resolvedBase);
      const baseRealWithSep = baseReal.endsWith(path.sep) ? baseReal : `${baseReal}${path.sep}`;

      const relFromBase = path.relative(resolvedBase, resolved);
      const parts = relFromBase
        .split(path.sep)
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .filter((p) => p !== ".");

      let cursor = resolvedBase;
      for (const part of parts) {
        cursor = path.join(cursor, part);
        if (!fs.existsSync(cursor)) break;
        try {
          if (fs.lstatSync(cursor).isSymbolicLink()) return null;
        } catch {
          return null;
        }
      }

      if (fs.existsSync(resolved)) {
        const targetReal = fs.realpathSync(resolved);
        if (!(targetReal === baseReal || targetReal.startsWith(baseRealWithSep))) {
          return null;
        }
      } else {
        const parent = path.dirname(resolved);
        if (fs.existsSync(parent)) {
          const parentReal = fs.realpathSync(parent);
          if (!(parentReal === baseReal || parentReal.startsWith(baseRealWithSep))) {
            return null;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return resolved;
};

const safeModuleName = (moduleName) => {
  const safe = String(moduleName || "").trim();
  if (!safe) return null;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(safe)) return null;
  return safe;
};

const safeJsonFilename = (filename) => {
  const safe = String(filename || "").trim();
  if (!safe) return null;
  if (
    safe !== "userData.json" &&
    safe !== "appState.json" &&
    safe !== "config.json" &&
    safe !== "recordingData.json"
  ) {
    return null;
  }
  return safe;
};

module.exports = {
  isExistingDirectory,
  resolveWithinDir,
  safeModuleName,
  safeJsonFilename,
};
