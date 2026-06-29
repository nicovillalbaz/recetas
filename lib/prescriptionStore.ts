import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type PrescriptionRecord,
  createPdfFileName,
  getEffectivePrescriptionStatus,
  normalizePrescriptionPayload,
} from "./prescription";

type PrescriptionDb = Record<string, PrescriptionRecord>;

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "prescriptions.json");
const SIGNED_PDF_DIR = path.join(DATA_DIR, "signed-pdfs");

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

export async function saveSignedPrescriptionPdf(
  id: string,
  token: string,
  pdfBuffer: Buffer,
  originalFileName: string,
) {
  const db = await readPrescriptionDb();
  const record = db[id];

  if (!record || record.token !== token) {
    return null;
  }

  const normalizedRecord = normalizeStoredRecord(record);
  const now = new Date().toISOString();
  const fileName = sanitizePdfFileName(
    originalFileName || `firmada-${createPdfFileName(normalizedRecord.payload)}`,
  );
  const updated: PrescriptionRecord = {
    ...normalizedRecord,
    signedPdf: {
      fileName,
      uploadedAt: now,
      size: pdfBuffer.length,
    },
    updatedAt: now,
  };

  await fs.mkdir(SIGNED_PDF_DIR, { recursive: true });
  await fs.writeFile(getSignedPdfPath(id), pdfBuffer);

  db[id] = updated;
  await writePrescriptionDb(db);

  return updated;
}

export async function getSignedPrescriptionPdf(record: PrescriptionRecord) {
  if (!record.signedPdf) {
    return null;
  }

  try {
    return {
      buffer: await fs.readFile(getSignedPdfPath(record.id)),
      fileName: record.signedPdf.fileName,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
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
    signedPdf: record.signedPdf,
    payload,
  };
}

function getSignedPdfPath(id: string) {
  return path.join(SIGNED_PDF_DIR, `${id}.pdf`);
}

function sanitizePdfFileName(value: string) {
  const clean = value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const withExtension = clean.toLowerCase().endsWith(".pdf")
    ? clean
    : `${clean}.pdf`;

  return withExtension || "receta-firmada.pdf";
}
