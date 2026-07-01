import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { type Database } from "sql.js";
import {
  getAppDataDir,
  getLegacyPrescriptionJsonPath,
  getPrescriptionDbPath,
  getSignedPdfDir,
} from "./appData";
import { type GhlSession } from "./authSession";
import {
  type PrescriptionActor,
  type PrescriptionRecord,
  createPdfFileName,
  getEffectivePrescriptionStatus,
  normalizePrescriptionPayload,
} from "./prescription";
import {
  createRandomToken,
  decryptText,
  encryptText,
  hashToken,
} from "./serverCrypto";

type PrescriptionDb = Record<string, PrescriptionRecord>;

type PrescriptionRow = {
  id: string;
  token: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  cancelled_at?: string;
  location_id: string;
  contact_id: string;
  created_by_user_id?: string;
  created_by_name?: string;
  created_by_email?: string;
  signed_pdf_file_name?: string;
  signed_pdf_uploaded_at?: string;
  signed_pdf_size?: number;
  sent_at?: string;
  payload_json: string;
};

export type PrescriptionEventType =
  | "created"
  | "signed_pdf_uploaded"
  | "cancelled"
  | "sent_patient"
  | "ghl_note_created"
  | "ghl_note_failed";

export type PrescriptionHistoryFilters = {
  locationId?: string;
  contactId?: string;
  query?: string;
  status?: "all" | "active" | "cancelled" | "expired";
  signed?: "all" | "signed" | "unsigned";
  sent?: "all" | "sent" | "unsent";
  limit?: number;
};

export type PrescriptionHistoryItem = {
  id: string;
  status: ReturnType<typeof getEffectivePrescriptionStatus>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  patientName: string;
  patientDocumentId: string;
  contactId: string;
  signed: boolean;
  sent: boolean;
  sentAt: string;
  createdByName: string;
  pdfUrlToken: string;
};

export type StoredRubric = {
  fileName: string;
  imageB64: string;
  updatedAt: string;
};

const require = createRequire(import.meta.url);
const LEGACY_SIGNED_PDF_DIR = path.join(getAppDataDir(), "signed-pdfs");
const SIGN_TOKEN_TTL_MS = 10 * 60 * 1000;

let dbPromise: Promise<Database> | null = null;
let writeQueue = Promise.resolve();

export async function savePrescriptionRecord(
  record: PrescriptionRecord,
  actor?: GhlSession | PrescriptionActor | null,
) {
  return withWrite(async (db) => {
    const normalizedRecord = normalizeStoredRecord(record);
    const prescriptionActor = toPrescriptionActor(actor);

    if (prescriptionActor) {
      normalizedRecord.createdBy = prescriptionActor;
    }

    upsertPrescription(db, normalizedRecord);
    insertEvent(db, normalizedRecord.id, "created", prescriptionActor, {
      contactId: normalizedRecord.contactId,
    });

    return normalizedRecord;
  });
}

export async function getPrescriptionRecord(id: string) {
  const db = await getDb();
  const row = firstRow<PrescriptionRow>(
    db,
    "SELECT * FROM prescriptions WHERE id = ?",
    [id],
  );

  return row ? recordFromRow(row) : null;
}

export async function getPrescriptionRecordByReadableToken(
  id: string,
  token: string,
) {
  const record = await getPrescriptionRecord(id);

  if (!record) {
    return null;
  }

  if (record.token === token) {
    return record;
  }

  return (await isValidSignToken(id, token, false)) ? record : null;
}

export async function cancelPrescriptionRecord(
  id: string,
  token: string,
  actor?: GhlSession | PrescriptionActor | null,
) {
  return withWrite(async (db) => {
    const row = firstRow<PrescriptionRow>(
      db,
      "SELECT * FROM prescriptions WHERE id = ?",
      [id],
    );

    if (!row || row.token !== token) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: PrescriptionRecord = {
      ...recordFromRow(row),
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    };
    const prescriptionActor = toPrescriptionActor(actor);

    upsertPrescription(db, updated);
    insertEvent(db, id, "cancelled", prescriptionActor);

    return updated;
  });
}

export async function saveSignedPrescriptionPdf(
  id: string,
  token: string,
  pdfBuffer: Buffer,
  originalFileName: string,
  actor?: GhlSession | PrescriptionActor | null,
) {
  return withWrite(async (db) => {
    const row = firstRow<PrescriptionRow>(
      db,
      "SELECT * FROM prescriptions WHERE id = ?",
      [id],
    );

    if (!row) {
      return null;
    }

    const tokenIsPublic = row.token === token;
    const tokenIsTemporary = await isValidSignToken(id, token, true, db);

    if (!tokenIsPublic && !tokenIsTemporary) {
      return null;
    }

    const normalizedRecord = normalizeStoredRecord(recordFromRow(row));
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
    const prescriptionActor = toPrescriptionActor(actor);

    await fs.mkdir(getSignedPdfDir(), { recursive: true });
    await fs.writeFile(getSignedPdfPath(id), pdfBuffer);

    upsertPrescription(db, updated);
    insertEvent(db, id, "signed_pdf_uploaded", prescriptionActor, {
      fileName,
      size: pdfBuffer.length,
      tokenType: tokenIsTemporary ? "temporary" : "record",
    });

    return updated;
  });
}

export async function getSignedPrescriptionPdf(record: PrescriptionRecord) {
  if (!record.signedPdf) {
    return null;
  }

  const currentPath = getSignedPdfPath(record.id);
  const legacyPath = path.join(LEGACY_SIGNED_PDF_DIR, `${record.id}.pdf`);

  try {
    return {
      buffer: await fs.readFile(currentPath),
      fileName: record.signedPdf.fileName,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }
  }

  try {
    return {
      buffer: await fs.readFile(legacyPath),
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

export async function createPrescriptionSignToken(
  id: string,
  actor?: GhlSession | PrescriptionActor | null,
) {
  return withWrite(async (db) => {
    const record = firstRow<Pick<PrescriptionRow, "id">>(
      db,
      "SELECT id FROM prescriptions WHERE id = ?",
      [id],
    );

    if (!record) {
      return null;
    }

    const token = createRandomToken(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SIGN_TOKEN_TTL_MS);
    const prescriptionActor = toPrescriptionActor(actor);

    run(
      db,
      `INSERT INTO prescription_sign_tokens (
        token_hash, prescription_id, created_at, expires_at, actor_user_id
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        hashToken(token),
        id,
        now.toISOString(),
        expiresAt.toISOString(),
        prescriptionActor?.userId || "",
      ],
    );

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function markPrescriptionSent(
  id: string,
  actor?: GhlSession | PrescriptionActor | null,
) {
  return withWrite(async (db) => {
    const row = firstRow<PrescriptionRow>(
      db,
      "SELECT * FROM prescriptions WHERE id = ?",
      [id],
    );

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: PrescriptionRecord = {
      ...recordFromRow(row),
      sentAt: now,
      updatedAt: now,
    };
    const prescriptionActor = toPrescriptionActor(actor);

    upsertPrescription(db, updated);
    insertEvent(db, id, "sent_patient", prescriptionActor);

    return updated;
  });
}

export async function recordPrescriptionEvent(
  prescriptionId: string,
  type: PrescriptionEventType,
  actor?: GhlSession | PrescriptionActor | null,
  detail?: unknown,
) {
  await withWrite(async (db) => {
    insertEvent(db, prescriptionId, type, toPrescriptionActor(actor), detail);
  });
}

export async function listPrescriptionHistory(
  filters: PrescriptionHistoryFilters = {},
) {
  const db = await getDb();
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (filters.locationId) {
    where.push("location_id = ?");
    params.push(filters.locationId);
  }

  if (filters.contactId) {
    where.push("contact_id = ?");
    params.push(filters.contactId);
  }

  if (filters.query) {
    where.push("(id LIKE ? OR payload_json LIKE ?)");
    params.push(`%${filters.query}%`, `%${filters.query}%`);
  }

  if (filters.signed === "signed") {
    where.push("signed_pdf_file_name <> ''");
  } else if (filters.signed === "unsigned") {
    where.push("(signed_pdf_file_name IS NULL OR signed_pdf_file_name = '')");
  }

  if (filters.sent === "sent") {
    where.push("sent_at <> ''");
  } else if (filters.sent === "unsent") {
    where.push("(sent_at IS NULL OR sent_at = '')");
  }

  const limit = Math.max(1, Math.min(filters.limit || 40, 100));
  const sql = `SELECT * FROM prescriptions ${
    where.length ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY created_at DESC LIMIT ?`;
  const rows = allRows<PrescriptionRow>(db, sql, [...params, limit]);

  return rows
    .map(recordFromRow)
    .map(toHistoryItem)
    .filter((item) => {
      if (!filters.status || filters.status === "all") {
        return true;
      }

      return item.status === filters.status;
    });
}

export async function saveGhlUserSession(session: GhlSession) {
  await withWrite(async (db) => {
    run(
      db,
      `INSERT INTO ghl_users (
        user_id, company_id, location_id, role, name, email, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, location_id) DO UPDATE SET
        company_id = excluded.company_id,
        role = excluded.role,
        name = excluded.name,
        email = excluded.email,
        last_seen_at = excluded.last_seen_at`,
      [
        session.userId,
        session.companyId,
        session.locationId,
        session.role,
        session.userName,
        session.email,
        new Date().toISOString(),
      ],
    );
  });
}

export async function saveUserRubric(
  session: GhlSession,
  fileName: string,
  imageB64: string,
) {
  const encrypted = encryptText(imageB64);
  const now = new Date().toISOString();

  await withWrite(async (db) => {
    run(
      db,
      `INSERT INTO user_rubrics (
        location_id, user_id, file_name, encrypted_b64, iv_b64, tag_b64, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id, user_id) DO UPDATE SET
        file_name = excluded.file_name,
        encrypted_b64 = excluded.encrypted_b64,
        iv_b64 = excluded.iv_b64,
        tag_b64 = excluded.tag_b64,
        updated_at = excluded.updated_at`,
      [
        session.locationId,
        session.userId,
        sanitizeFileLabel(fileName || "rubrica.jpg"),
        encrypted.cipherTextB64,
        encrypted.ivB64,
        encrypted.tagB64,
        now,
      ],
    );
  });

  return {
    fileName: sanitizeFileLabel(fileName || "rubrica.jpg"),
    imageB64,
    updatedAt: now,
  };
}

export async function getUserRubric(session: GhlSession) {
  const db = await getDb();
  const row = firstRow<StoredRubricRow>(
    db,
    `SELECT file_name, encrypted_b64, iv_b64, tag_b64, updated_at
     FROM user_rubrics WHERE location_id = ? AND user_id = ?`,
    [session.locationId, session.userId],
  );

  if (!row) {
    return null;
  }

  return {
    fileName: row.file_name,
    imageB64: decryptText({
      cipherTextB64: row.encrypted_b64,
      ivB64: row.iv_b64,
      tagB64: row.tag_b64,
    }),
    updatedAt: row.updated_at,
  } satisfies StoredRubric;
}

export async function getRubricForPrescriptionSignToken(
  prescriptionId: string,
  token: string,
) {
  const db = await getDb();
  const row = firstRow<StoredRubricRow>(
    db,
    `SELECT user_rubrics.file_name, user_rubrics.encrypted_b64,
      user_rubrics.iv_b64, user_rubrics.tag_b64, user_rubrics.updated_at
     FROM prescription_sign_tokens
     INNER JOIN prescriptions
       ON prescriptions.id = prescription_sign_tokens.prescription_id
     INNER JOIN user_rubrics
       ON user_rubrics.location_id = prescriptions.location_id
      AND user_rubrics.user_id = prescription_sign_tokens.actor_user_id
     WHERE prescription_sign_tokens.token_hash = ?
       AND prescription_sign_tokens.prescription_id = ?
       AND (
        prescription_sign_tokens.used_at IS NULL
        OR prescription_sign_tokens.used_at = ''
       )
       AND prescription_sign_tokens.expires_at > ?`,
    [hashToken(token), prescriptionId, new Date().toISOString()],
  );

  if (!row) {
    return null;
  }

  return {
    fileName: row.file_name,
    imageB64: decryptText({
      cipherTextB64: row.encrypted_b64,
      ivB64: row.iv_b64,
      tagB64: row.tag_b64,
    }),
    updatedAt: row.updated_at,
  } satisfies StoredRubric;
}

export async function deleteUserRubric(session: GhlSession) {
  await withWrite(async (db) => {
    run(db, "DELETE FROM user_rubrics WHERE location_id = ? AND user_id = ?", [
      session.locationId,
      session.userId,
    ]);
  });
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = initDb();
  }

  return dbPromise;
}

async function initDb() {
  await fs.mkdir(getAppDataDir(), { recursive: true });
  await fs.mkdir(getSignedPdfDir(), { recursive: true });

  const initSqlJs = require("sql.js") as typeof import("sql.js").default;
  const wasmPath = path.join(
    process.cwd(),
    "node_modules",
    "sql.js",
    "dist",
    "sql-wasm.wasm",
  );
  const wasmBuffer = await fs.readFile(wasmPath);
  const wasmBinary = wasmBuffer.buffer.slice(
    wasmBuffer.byteOffset,
    wasmBuffer.byteOffset + wasmBuffer.byteLength,
  );
  const SQL = await initSqlJs({ wasmBinary });
  const dbBytes = await fs.readFile(getPrescriptionDbPath()).catch(() => null);
  const db = dbBytes ? new SQL.Database(dbBytes) : new SQL.Database();

  createSchema(db);
  await importLegacyJsonIfNeeded(db);
  await persistDb(db);

  return db;
}

function createSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      cancelled_at TEXT,
      location_id TEXT,
      contact_id TEXT,
      created_by_user_id TEXT,
      created_by_name TEXT,
      created_by_email TEXT,
      signed_pdf_file_name TEXT,
      signed_pdf_uploaded_at TEXT,
      signed_pdf_size INTEGER,
      sent_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescription_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      actor_user_id TEXT,
      actor_name TEXT,
      actor_email TEXT,
      detail_json TEXT
    );

    CREATE TABLE IF NOT EXISTS prescription_sign_tokens (
      token_hash TEXT PRIMARY KEY,
      prescription_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      actor_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS ghl_users (
      user_id TEXT NOT NULL,
      company_id TEXT,
      location_id TEXT NOT NULL,
      role TEXT,
      name TEXT,
      email TEXT,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (user_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS user_rubrics (
      location_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      encrypted_b64 TEXT NOT NULL,
      iv_b64 TEXT NOT NULL,
      tag_b64 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (location_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_prescriptions_location_created
      ON prescriptions(location_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_contact_created
      ON prescriptions(contact_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prescription_events_prescription
      ON prescription_events(prescription_id, created_at);
  `);
}

async function importLegacyJsonIfNeeded(db: Database) {
  const existing = firstRow<{ total: number }>(
    db,
    "SELECT COUNT(*) as total FROM prescriptions",
  );

  if ((existing?.total || 0) > 0) {
    return;
  }

  const raw = await fs.readFile(getLegacyPrescriptionJsonPath(), "utf8").catch(
    () => "",
  );

  if (!raw) {
    return;
  }

  const legacyDb = JSON.parse(raw) as PrescriptionDb;

  Object.values(legacyDb).forEach((record) => {
    const normalized = normalizeStoredRecord(record);
    upsertPrescription(db, normalized);
    insertEvent(db, normalized.id, "created", normalized.createdBy, {
      migratedFrom: "prescriptions.json",
    });
  });
}

async function withWrite<T>(operation: (db: Database) => T | Promise<T>) {
  const runOperation = async () => {
    const db = await getDb();
    const result = await operation(db);
    await persistDb(db);

    return result;
  };

  const next = writeQueue.then(runOperation, runOperation);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}

async function persistDb(db: Database) {
  await fs.mkdir(getAppDataDir(), { recursive: true });
  await fs.writeFile(getPrescriptionDbPath(), Buffer.from(db.export()));
}

function upsertPrescription(db: Database, record: PrescriptionRecord) {
  run(
    db,
    `INSERT INTO prescriptions (
      id, token, status, created_at, updated_at, expires_at, cancelled_at,
      location_id, contact_id, created_by_user_id, created_by_name,
      created_by_email, signed_pdf_file_name, signed_pdf_uploaded_at,
      signed_pdf_size, sent_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      token = excluded.token,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at,
      cancelled_at = excluded.cancelled_at,
      location_id = excluded.location_id,
      contact_id = excluded.contact_id,
      created_by_user_id = excluded.created_by_user_id,
      created_by_name = excluded.created_by_name,
      created_by_email = excluded.created_by_email,
      signed_pdf_file_name = excluded.signed_pdf_file_name,
      signed_pdf_uploaded_at = excluded.signed_pdf_uploaded_at,
      signed_pdf_size = excluded.signed_pdf_size,
      sent_at = excluded.sent_at,
      payload_json = excluded.payload_json`,
    [
      record.id,
      record.token,
      record.status,
      record.createdAt,
      record.updatedAt,
      record.expiresAt,
      record.cancelledAt || "",
      record.locationId,
      record.contactId,
      record.createdBy?.userId || "",
      record.createdBy?.name || "",
      record.createdBy?.email || "",
      record.signedPdf?.fileName || "",
      record.signedPdf?.uploadedAt || "",
      record.signedPdf?.size || 0,
      record.sentAt || "",
      JSON.stringify(record.payload),
    ],
  );
}

function recordFromRow(row: PrescriptionRow): PrescriptionRecord {
  const payload = normalizePrescriptionPayload(JSON.parse(row.payload_json));
  const createdBy =
    row.created_by_user_id || row.created_by_name || row.created_by_email
      ? {
          userId: row.created_by_user_id || "",
          name: row.created_by_name || "",
          email: row.created_by_email || "",
        }
      : undefined;
  const signedPdf = row.signed_pdf_file_name
    ? {
        fileName: row.signed_pdf_file_name,
        uploadedAt: row.signed_pdf_uploaded_at || "",
        size: Number(row.signed_pdf_size || 0),
      }
    : undefined;

  return normalizeStoredRecord({
    id: row.id,
    token: row.token,
    status: row.status === "cancelled" ? "cancelled" : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at || undefined,
    locationId: row.location_id || payload.locationId,
    contactId: row.contact_id || payload.contactId,
    createdBy,
    signedPdf,
    sentAt: row.sent_at || undefined,
    payload,
  });
}

function normalizeStoredRecord(record: PrescriptionRecord): PrescriptionRecord {
  const payload = normalizePrescriptionPayload(record.payload);

  return {
    ...record,
    locationId: record.locationId || payload.locationId,
    contactId: record.contactId || payload.contactId,
    expiresAt: record.expiresAt || payload.expiresAt,
    createdBy: record.createdBy,
    signedPdf: record.signedPdf,
    sentAt: record.sentAt,
    payload,
  };
}

function toHistoryItem(record: PrescriptionRecord): PrescriptionHistoryItem {
  return {
    id: record.id,
    status: getEffectivePrescriptionStatus(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    patientName: record.payload.patient.name,
    patientDocumentId: record.payload.patient.documentId,
    contactId: record.contactId,
    signed: Boolean(record.signedPdf),
    sent: Boolean(record.sentAt),
    sentAt: record.sentAt || "",
    createdByName: record.createdBy?.name || "",
    pdfUrlToken: record.token,
  };
}

async function isValidSignToken(
  prescriptionId: string,
  token: string,
  consume: boolean,
  providedDb?: Database,
) {
  if (!token) {
    return false;
  }

  const db = providedDb || (await getDb());
  const row = firstRow<{
    expires_at: string;
    used_at?: string;
  }>(
    db,
    `SELECT expires_at, used_at FROM prescription_sign_tokens
     WHERE token_hash = ? AND prescription_id = ?`,
    [hashToken(token), prescriptionId],
  );

  if (!row || row.used_at) {
    return false;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return false;
  }

  if (consume) {
    run(
      db,
      "UPDATE prescription_sign_tokens SET used_at = ? WHERE token_hash = ?",
      [new Date().toISOString(), hashToken(token)],
    );
  }

  return true;
}

function insertEvent(
  db: Database,
  prescriptionId: string,
  type: PrescriptionEventType,
  actor?: PrescriptionActor | null,
  detail?: unknown,
) {
  run(
    db,
    `INSERT INTO prescription_events (
      prescription_id, type, created_at, actor_user_id, actor_name,
      actor_email, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      prescriptionId,
      type,
      new Date().toISOString(),
      actor?.userId || "",
      actor?.name || "",
      actor?.email || "",
      detail ? JSON.stringify(detail) : "",
    ],
  );
}

function toPrescriptionActor(
  actor?: GhlSession | PrescriptionActor | null,
): PrescriptionActor | undefined {
  if (!actor) {
    return undefined;
  }

  if ("userName" in actor) {
    return {
      userId: actor.userId,
      name: actor.userName,
      email: actor.email,
    };
  }

  return actor;
}

function getSignedPdfPath(id: string) {
  return path.join(getSignedPdfDir(), `${id}.pdf`);
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

function sanitizeFileLabel(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

type StoredRubricRow = {
  file_name: string;
  encrypted_b64: string;
  iv_b64: string;
  tag_b64: string;
  updated_at: string;
};

function firstRow<T extends Record<string, unknown>>(
  db: Database,
  sql: string,
  params: Array<string | number> = [],
) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);

    return stmt.step() ? (stmt.getAsObject() as T) : null;
  } finally {
    stmt.free();
  }
}

function allRows<T extends Record<string, unknown>>(
  db: Database,
  sql: string,
  params: Array<string | number> = [],
) {
  const stmt = db.prepare(sql);
  const rows: T[] = [];

  try {
    stmt.bind(params);

    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }

    return rows;
  } finally {
    stmt.free();
  }
}

function run(
  db: Database,
  sql: string,
  params: Array<string | number> = [],
) {
  const stmt = db.prepare(sql);

  try {
    stmt.run(params);
  } finally {
    stmt.free();
  }
}
