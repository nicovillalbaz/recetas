import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type PrescriptionRecord,
  getEffectivePrescriptionStatus,
  normalizePrescriptionPayload,
} from "./prescription";

type PrescriptionDb = Record<string, PrescriptionRecord>;

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "prescriptions.json");

export async function savePrescriptionRecord(record: PrescriptionRecord) {
  const db = await readPrescriptionDb();
  db[record.id] = record;
  await writePrescriptionDb(db);

  return record;
}

export async function getPrescriptionRecord(id: string) {
  const db = await readPrescriptionDb();

  return db[id] ? normalizeStoredRecord(db[id]) : null;
}

export async function cancelPrescriptionRecord(id: string, token: string) {
  const db = await readPrescriptionDb();
  const record = db[id];

  if (!record || record.token !== token) {
    return null;
  }

  const now = new Date().toISOString();
  const updated: PrescriptionRecord = {
    ...record,
    status: "cancelled",
    cancelledAt: now,
    updatedAt: now,
  };

  db[id] = updated;
  await writePrescriptionDb(db);

  return updated;
}

export function canOpenPrescriptionPdf(record: PrescriptionRecord) {
  return getEffectivePrescriptionStatus(record) === "active";
}

async function readPrescriptionDb(): Promise<PrescriptionDb> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw) as PrescriptionDb;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writePrescriptionDb(db: PrescriptionDb) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function normalizeStoredRecord(record: PrescriptionRecord): PrescriptionRecord {
  const payload = normalizePrescriptionPayload(record.payload);

  return {
    ...record,
    locationId: record.locationId || payload.locationId,
    contactId: record.contactId || payload.contactId,
    expiresAt: record.expiresAt || payload.expiresAt,
    payload,
  };
}
