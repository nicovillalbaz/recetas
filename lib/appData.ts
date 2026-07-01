import path from "node:path";

export function getAppDataDir() {
  return process.env.APP_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
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
