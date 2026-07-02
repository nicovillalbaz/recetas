const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const DEFAULT_GHL_VERSION = "2021-07-28";

type JsonRecord = Record<string, unknown>;

type GhlConfig = {
  token: string;
  locationId: string;
  version: string;
};

type ContactFieldKind = "documentId" | "birthDate" | "insurance";

export type GhlContactSummary = {
  id: string;
  name: string;
  email: string;
  phone: string;
  documentId: string;
  birthDate: string;
  insurance: string;
};

export class GhlConfigurationError extends Error {
  constructor() {
    super("Configura el token privado y la cuenta en EasyPanel.");
    this.name = "GhlConfigurationError";
  }
}

export async function searchGhlContacts(query: string) {
  const cleanQuery = query.trim();

  if (cleanQuery.length < 2) {
    return [];
  }

  const config = getGhlConfig();

  try {
    const contacts = await searchContactsWithPost(config, cleanQuery);

    if (contacts.length > 0) {
      return contacts;
    }
  } catch {
    // Some accounts respond better to the list endpoint; try that below.
  }

  return searchContactsWithGet(config, cleanQuery);
}

export async function getGhlContact(contactId: string) {
  const config = getGhlConfig();
  const response = await fetchGhlJson(`/contacts/${encodeURIComponent(contactId)}`, {
    method: "GET",
  }, config);
  const records = extractContactRecords(response);
  const contact = records.map(normalizeContact).find((item) => item.id);

  return contact || null;
}

export async function sendGhlSmsToContact(contactId: string, message: string) {
  const cleanContactId = contactId.trim();
  const cleanMessage = message.trim();

  if (!cleanContactId || !cleanMessage) {
    throw new Error("Faltan el contacto o el mensaje para enviar el SMS.");
  }

  const config = getGhlConfig();

  return fetchGhlJson("/conversations/messages", {
    method: "POST",
    body: JSON.stringify({
      type: "SMS",
      contactId: cleanContactId,
      message: cleanMessage,
    }),
  }, config);
}

export async function createGhlContactNote(contactId: string, body: string) {
  const cleanContactId = contactId.trim();
  const cleanBody = body.trim();

  if (!cleanContactId || !cleanBody) {
    throw new Error("Faltan el contacto o el texto de la nota.");
  }

  const config = getGhlConfig();

  return fetchGhlJson(`/contacts/${encodeURIComponent(cleanContactId)}/notes`, {
    method: "POST",
    body: JSON.stringify({
      body: cleanBody,
    }),
  }, config);
}

async function searchContactsWithPost(config: GhlConfig, query: string) {
  const response = await fetchGhlJson("/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      locationId: config.locationId,
      page: 1,
      pageLimit: 12,
      query,
    }),
  }, config);

  return normalizeContactList(response);
}

async function searchContactsWithGet(config: GhlConfig, query: string) {
  const params = new URLSearchParams({
    locationId: config.locationId,
    query,
    limit: "12",
  });
  const response = await fetchGhlJson(`/contacts/?${params.toString()}`, {
    method: "GET",
  }, config);

  return normalizeContactList(response);
}

async function fetchGhlJson(
  path: string,
  init: RequestInit,
  config: GhlConfig,
) {
  const response = await fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Version: config.version,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` ${body.slice(0, 240)}` : "";

    throw new Error(`API ${response.status}.${detail}`);
  }

  return response.json().catch(() => ({})) as Promise<unknown>;
}

function normalizeContactList(response: unknown) {
  return extractContactRecords(response)
    .map(normalizeContact)
    .filter((contact) => contact.id || contact.name || contact.email || contact.phone)
    .slice(0, 12);
}

function extractContactRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  const directCollections = [
    value.contacts,
    value.results,
    value.items,
    value.data,
  ];

  for (const collection of directCollections) {
    if (Array.isArray(collection)) {
      return collection.filter(isRecord);
    }
  }

  for (const key of ["contact", "data"]) {
    const nested = value[key];

    if (isRecord(nested)) {
      const nestedRecords = extractContactRecords(nested);

      return nestedRecords.length > 0 ? nestedRecords : [nested];
    }
  }

  return [value];
}

function normalizeContact(contact: JsonRecord): GhlContactSummary {
  const firstName = getString(contact.firstName);
  const lastName = getString(contact.lastName);
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    id: getString(contact.id) || getString(contact.contactId),
    name:
      getString(contact.name) ||
      getString(contact.contactName) ||
      getString(contact.fullName) ||
      joinedName,
    email: getString(contact.email),
    phone: getString(contact.phone),
    documentId:
      getString(contact.documentId) ||
      getString(contact.dni) ||
      getString(contact.nie) ||
      getCustomFieldValue(contact, "documentId"),
    birthDate: normalizeDateInput(
      getContactBirthDate(contact) || getCustomFieldValue(contact, "birthDate"),
    ),
    insurance:
      getString(contact.insurance) ||
      getString(contact.mutua) ||
      getString(contact.aseguradora) ||
      getCustomFieldValue(contact, "insurance"),
  };
}

function getContactBirthDate(contact: JsonRecord) {
  return (
    getString(contact.dateOfBirth) ||
    getString(contact.birthDate) ||
    getString(contact.birthday) ||
    getString(contact.dob) ||
    getString(contact.date_of_birth) ||
    getString(contact.birth_date)
  );
}

function getCustomFieldValue(contact: JsonRecord, kind: ContactFieldKind) {
  const customSources = [
    contact.customFields,
    contact.customField,
    contact.customFieldsValues,
    contact.customFieldValues,
  ];

  for (const source of customSources) {
    const value = readCustomFieldSource(source, kind);

    if (value) {
      return value;
    }
  }

  return "";
}

function readCustomFieldSource(source: unknown, kind: ContactFieldKind) {
  if (Array.isArray(source)) {
    for (const item of source) {
      if (!isRecord(item) || !matchesCustomField(item, kind)) {
        continue;
      }

      const value =
        getString(item.value) ||
        getString(item.fieldValue) ||
        getString(item.field_value) ||
        getString(item.fieldValueString) ||
        getString(item.field_value_string) ||
        getString(item.values);

      if (value) {
        return value;
      }
    }

    return "";
  }

  if (!isRecord(source)) {
    return "";
  }

  for (const [key, rawValue] of Object.entries(source)) {
    if (!matchesCustomFieldKey(key, kind)) {
      continue;
    }

    const value = isRecord(rawValue)
      ? getString(rawValue.value) ||
        getString(rawValue.fieldValue) ||
        getString(rawValue.field_value) ||
        getString(rawValue.fieldValueString) ||
        getString(rawValue.field_value_string)
      : getString(rawValue);

    if (value) {
      return value;
    }
  }

  return "";
}

function matchesCustomField(field: JsonRecord, kind: ContactFieldKind) {
  return [
    field.id,
    field.key,
    field.fieldKey,
    field.name,
    field.label,
  ].some((value) => matchesCustomFieldKey(getString(value), kind));
}

function matchesCustomFieldKey(value: string, kind: ContactFieldKind) {
  const normalized = normalizeLookupText(value);

  if (!normalized) {
    return false;
  }

  return (
    getConfiguredFieldKeys(kind).some((key) => normalizeLookupText(key) === normalized) ||
    getFieldAliases(kind).some((alias) => normalized.includes(alias))
  );
}

function getConfiguredFieldKeys(kind: ContactFieldKind) {
  const envMap: Record<ContactFieldKind, string[]> = {
    documentId: [
      process.env.GHL_PATIENT_DOCUMENT_FIELD_ID || "",
      process.env.GHL_PATIENT_DNI_FIELD_ID || "",
      process.env.GHL_PATIENT_NIF_FIELD_ID || "",
    ],
    birthDate: [process.env.GHL_PATIENT_BIRTH_DATE_FIELD_ID || ""],
    insurance: [process.env.GHL_PATIENT_INSURANCE_FIELD_ID || ""],
  };

  return envMap[kind].flatMap(splitConfiguredKeys).filter(Boolean);
}

function getFieldAliases(kind: ContactFieldKind) {
  const aliases: Record<ContactFieldKind, string[]> = {
    documentId: ["dni", "nie", "nif", "document", "documento"],
    birthDate: ["birth", "nacimiento", "fecha de nacimiento"],
    insurance: ["mutua", "aseguradora", "insurance", "seguro"],
  };

  return aliases[kind].map(normalizeLookupText);
}

function normalizeDateInput(value: string) {
  const clean = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }

  const shortDate = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (shortDate) {
    const [, day, month, year] = shortDate;

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const date = new Date(clean);

  if (Number.isNaN(date.getTime())) {
    return clean;
  }

  return date.toISOString().slice(0, 10);
}

function getString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean).join(", ");
  }

  return "";
}

function normalizeLookupText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitConfiguredKeys(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getGhlConfig(): GhlConfig {
  const token = process.env.GHL_PRIVATE_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();

  if (!token || !locationId) {
    throw new GhlConfigurationError();
  }

  return {
    token,
    locationId,
    version: process.env.GHL_API_VERSION?.trim() || DEFAULT_GHL_VERSION,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
