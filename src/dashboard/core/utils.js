import { produce } from "immer";
import { migrateToSets, getActiveSet } from "../../shared/utils/setUtils.ts";
import {
  DEFAULT_GLOBAL_MAPPINGS,
  DEFAULT_INPUT_CONFIG,
} from "../../shared/config/defaultConfig.js";
import {
  getJsonFilePath,
  loadJsonFile,
  saveJsonFile,
  saveJsonFileSync,
} from "../../shared/json/jsonFileBase.ts";

const getMethodsByLayer = (module, moduleBase, threeBase) => {
  if (!module || !module.methods) return [];

  const layers = [];
  const allModuleMethods = module.methods.map((m) => m.name);

  const baseMethodsInModule = allModuleMethods.filter((name) => moduleBase.includes(name));
  if (baseMethodsInModule.length > 0) {
    layers.push({
      name: "Base",
      methods: baseMethodsInModule,
    });
  }

  const threeBaseMethodsOnly = threeBase.filter((name) => !moduleBase.includes(name));
  const threeMethodsInModule = allModuleMethods.filter((name) =>
    threeBaseMethodsOnly.includes(name)
  );
  if (threeMethodsInModule.length > 0) {
    layers.push({
      name: "Three.js Base",
      methods: threeMethodsInModule,
    });
  }

  const allBaseMethods = [...moduleBase, ...threeBase];
  const moduleMethods = allModuleMethods.filter((name) => !allBaseMethods.includes(name));
  if (moduleMethods.length > 0) {
    layers.push({
      name: module.name,
      methods: moduleMethods,
    });
  }

  return layers;
};

const getMethodCode = (moduleName, methodName) => {
  try {
    const bridge = globalThis.nwWrldBridge;
    if (!bridge || !bridge.app || typeof bridge.app.getMethodCode !== "function") {
      return { code: null, filePath: null };
    }
    const res = bridge.app.getMethodCode(moduleName, methodName);
    return {
      code: res?.code || null,
      filePath: res?.filePath || null,
    };
  } catch (error) {
    console.error("Error extracting method code:", error);
    return { code: null, filePath: null };
  }
};

const updateUserData = (setUserData, updater) => {
  setUserData((prev) =>
    produce(prev, (draft) => {
      updater(draft);
    })
  );
};

const getUserDataPath = () => {
  return getJsonFilePath("userData.json");
};

const loadUserData = async () => {
  const defaultData = {
    config: {
      activeSetId: "set_1",
      trackMappings: DEFAULT_GLOBAL_MAPPINGS.trackMappings,
      channelMappings: DEFAULT_GLOBAL_MAPPINGS.channelMappings,
      input: DEFAULT_INPUT_CONFIG,
    },
    sets: [
      {
        id: "set_1",
        name: "Set 1",
        tracks: [],
      },
    ],
    _isDefaultData: true,
  };

  const parsedData = await loadJsonFile(
    "userData.json",
    defaultData,
    "Could not load userData.json, initializing with empty data."
  );

  const migratedData = migrateToSets(parsedData);

  if (!migratedData.config) {
    migratedData.config = {};
  }
  if (!Array.isArray(migratedData.sets)) {
    migratedData.sets = [];
  }

  if (!migratedData.config.trackMappings) {
    migratedData.config.trackMappings = DEFAULT_GLOBAL_MAPPINGS.trackMappings;
  } else if (migratedData.config.trackMappings?.midi) {
    const currentMidi = migratedData.config.trackMappings.midi;
    if (
      typeof currentMidi === "object" &&
      currentMidi !== null &&
      !("pitchClass" in currentMidi) &&
      !("exactNote" in currentMidi)
    ) {
      migratedData.config.trackMappings.midi = {
        pitchClass: currentMidi,
        exactNote: { ...DEFAULT_GLOBAL_MAPPINGS.trackMappings.midi.exactNote },
      };
    }
  }
  if (!migratedData.config.channelMappings) {
    migratedData.config.channelMappings = DEFAULT_GLOBAL_MAPPINGS.channelMappings;
  } else if (migratedData.config.channelMappings?.midi) {
    const currentMidi = migratedData.config.channelMappings.midi;
    if (
      typeof currentMidi === "object" &&
      currentMidi !== null &&
      !("pitchClass" in currentMidi) &&
      !("exactNote" in currentMidi)
    ) {
      migratedData.config.channelMappings.midi = {
        pitchClass: currentMidi,
        exactNote: { ...DEFAULT_GLOBAL_MAPPINGS.channelMappings.midi.exactNote },
      };
    }
  }
  if (!migratedData.config.input) {
    migratedData.config.input = DEFAULT_INPUT_CONFIG;
  } else {
    migratedData.config.input = {
      ...DEFAULT_INPUT_CONFIG,
      ...migratedData.config.input,
    };
  }

  migratedData._loadedSuccessfully = !Boolean(migratedData._isDefaultData);
  return migratedData;
};

const saveUserData = async (data) => {
  if (data?._isDefaultData) {
    console.warn(
      "Skipping save: data is default empty data returned from loadUserData error. Not overwriting file."
    );
    return;
  }
  if (Array.isArray(data?.sets) && data.sets.length === 0) {
    console.warn("Skipping save: data has empty sets array. Not overwriting file with empty data.");
    return;
  }
  try {
    const dataToSave = { ...data };
    delete dataToSave._isDefaultData;
    delete dataToSave._loadedSuccessfully;
    await saveJsonFile("userData.json", dataToSave);
  } catch (error) {
    console.error("Error writing userData to JSON file:", error);
  }
};

const saveUserDataSync = (data) => {
  if (data?._isDefaultData) {
    console.warn(
      "Skipping save (sync): data is default empty data returned from loadUserData error. Not overwriting file."
    );
    return;
  }
  if (Array.isArray(data?.sets) && data.sets.length === 0) {
    console.warn(
      "Skipping save (sync): data has empty sets array. Not overwriting file with empty data."
    );
    return;
  }
  try {
    const dataToSave = { ...data };
    delete dataToSave._isDefaultData;
    delete dataToSave._loadedSuccessfully;
    saveJsonFileSync("userData.json", dataToSave);
  } catch (error) {
    console.error("Error writing userData to JSON file (sync):", error);
  }
};

const updateActiveSet = (setUserData, activeSetId, updater) => {
  updateUserData(setUserData, (draft) => {
    const activeSet = getActiveSet(draft, activeSetId);
    if (!activeSet) return;
    updater(activeSet, draft);
  });
};

export {
  getMethodsByLayer,
  getMethodCode,
  updateUserData,
  getUserDataPath,
  loadUserData,
  saveUserData,
  saveUserDataSync,
  updateActiveSet,
};
