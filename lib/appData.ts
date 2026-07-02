import path from "node:path";

export function getAppDataDir() {
  const configuredDir = process.env.APP_DATA_DIR?.trim();

  if (configuredDir) {
    return configuredDir;
  }

  return process.env.NODE_ENV === "production"
    ? "/app/.data"
    : path.join(process.cwd(), ".data");
}

export function getAppDataPath(...segments: string[]) {
  return path.join(getAppDataDir(), ...segments);
}

export function getPrescriptionDbPath() {
  return getAppDataPath("recetas.db");
}

export function getSignedPdfDir() {
  return getAppDataPath("files", "signed-pdfs");
}

export function getLegacyPrescriptionJsonPath() {
  return getAppDataPath("prescriptions.json");
}
