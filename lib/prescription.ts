export type DoctorProfile = {
  name: string;
  specialty: string;
  registration: string;
  documentId: string;
  clinicName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  businessType: string;
  signatureIdentity: string;
};

export type PatientProfile = {
  name: string;
  documentId: string;
  birthDate: string;
  email: string;
  phone: string;
  insurance: string;
};

export type PrescriptionDetails = {
  freeText: string;
  diagnosis: string;
  medication: string;
  nationalCode: string;
  presentation: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

export type PrescriptionPayload = {
  id: string;
  createdAt: string;
  expiresAt: string;
  locationId: string;
  contactId: string;
  doctor: DoctorProfile;
  patient: PatientProfile;
  prescription: PrescriptionDetails;
};

export type PrescriptionStatus = "active" | "cancelled";

export type EffectivePrescriptionStatus =
  | "active"
  | "cancelled"
  | "expired";

export type PrescriptionRecord = {
  id: string;
  token: string;
  status: PrescriptionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  cancelledAt?: string;
  locationId: string;
  contactId: string;
  signedPdf?: SignedPrescriptionPdf;
  payload: PrescriptionPayload;
};

export type SignedPrescriptionPdf = {
  fileName: string;
  uploadedAt: string;
  size: number;
};

export type DigitalSignatureStamp = {
  signerName: string;
  signerId?: string;
  signedAt: string;
};

export const defaultDoctorProfile: DoctorProfile = {
  name: "Dra. Durán Caballero, María del Sol",
  specialty: "Ginecología y Obstetricia",
  registration: "06/4993",
  documentId: "76012671V",
  clinicName: "Durán Ginecología",
  address: "C. Cáceres, 2, 10800 Coria, Cáceres, España",
  phone: "623 190 797",
  email: "info@duranginecologia.com",
  website: "https://www.duranginecologia.com/",
  businessType: "Clínica médica",
  signatureIdentity: "DURAN CABALLERO MARIA SOL - 76012671V",
};

export const emptyPatientProfile: PatientProfile = {
  name: "",
  documentId: "",
  birthDate: "",
  email: "",
  phone: "",
  insurance: "",
};

export const emptyPrescriptionDetails: PrescriptionDetails = {
  freeText: "",
  diagnosis: "",
  medication: "",
  nationalCode: "",
  presentation: "",
  dosage: "",
  route: "Oral",
  frequency: "",
  duration: "",
  quantity: "",
  instructions: "",
};

export function buildPrescriptionId(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `RDG-${yyyy}${mm}${dd}-${getRandomToken(4)}`;
}

export function buildRecordToken() {
  return getRandomToken(12);
}

export function getDefaultExpiryDate(date = new Date()) {
  const expiresAt = new Date(date);
  expiresAt.setDate(expiresAt.getDate() + 10);
  expiresAt.setHours(23, 59, 59, 999);

  return expiresAt.toISOString();
}

export function normalizePrescriptionPayload(
  payload: Partial<PrescriptionPayload>,
): PrescriptionPayload {
  const createdAt = payload.createdAt || new Date().toISOString();
  const prescription = normalizePrescriptionDetails(payload.prescription);

  return {
    id: payload.id || buildPrescriptionId(new Date(createdAt)),
    createdAt,
    expiresAt: payload.expiresAt || getDefaultExpiryDate(new Date(createdAt)),
    locationId: payload.locationId || "",
    contactId: payload.contactId || "",
    doctor: {
      ...defaultDoctorProfile,
      ...(payload.doctor || {}),
    },
    patient: {
      ...emptyPatientProfile,
      ...(payload.patient || {}),
    },
    prescription,
  };
}

export function createPrescriptionRecord(
  payload: PrescriptionPayload,
): PrescriptionRecord {
  const normalizedPayload = normalizePrescriptionPayload(payload);
  const now = new Date().toISOString();

  return {
    id: normalizedPayload.id,
    token: buildRecordToken(),
    status: "active",
    createdAt: normalizedPayload.createdAt,
    updatedAt: now,
    expiresAt: normalizedPayload.expiresAt,
    locationId: normalizedPayload.locationId,
    contactId: normalizedPayload.contactId,
    payload: normalizedPayload,
  };
}

export function validatePrescriptionPayload(payload: PrescriptionPayload) {
  const errors: string[] = [];
  const requiredChecks: Array<[string, string]> = [
    [payload.patient.name, "Nombre y dos apellidos del paciente"],
    [payload.patient.documentId, "DNI/NIE del paciente"],
    [payload.patient.birthDate, "Fecha de nacimiento del paciente"],
    [getPrescriptionText(payload.prescription), "Receta"],
    [payload.doctor.name, "Nombre de la doctora"],
    [payload.doctor.specialty, "Especialidad"],
    [payload.doctor.registration, "N.º de colegiado"],
    [payload.doctor.clinicName, "Consulta o centro médico"],
    [payload.doctor.address, "Dirección profesional en España"],
  ];

  requiredChecks.forEach(([value, label]) => {
    if (!isFilled(value)) {
      errors.push(label);
    }
  });

  if (!isFilled(payload.doctor.phone) && !isFilled(payload.doctor.email)) {
    errors.push("Teléfono o email profesional");
  }

  if (payload.patient.email && !isValidEmail(payload.patient.email)) {
    errors.push("Email del paciente válido");
  }

  if (payload.doctor.email && !isValidEmail(payload.doctor.email)) {
    errors.push("Email profesional válido");
  }

  return errors;
}

export function getEffectivePrescriptionStatus(
  record: PrescriptionRecord,
  now = new Date(),
): EffectivePrescriptionStatus {
  if (record.status === "cancelled") {
    return "cancelled";
  }

  if (new Date(record.expiresAt).getTime() < now.getTime()) {
    return "expired";
  }

  return "active";
}

export function buildVerificationUrl(
  record: Pick<PrescriptionRecord, "id" | "token">,
  origin: string,
) {
  const url = new URL(`/recetas/${record.id}`, origin);
  url.searchParams.set("token", record.token);

  return url.toString();
}

export function buildPrescriptionPdfUrl(
  record: Pick<PrescriptionRecord, "id" | "token">,
  origin: string,
) {
  const url = new URL(`/api/recetas/${record.id}/pdf`, origin);
  url.searchParams.set("token", record.token);

  return url.toString();
}

export function formatDate(value: string) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");

    return `${day}/${month}/${year}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDigitalSignatureDate(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getDigitalSignatureStampLines(stamp: DigitalSignatureStamp) {
  const signerName = cleanDigitalSignatureLine(stamp.signerName);
  const signerId = cleanDigitalSignatureLine(stamp.signerId || "");
  const signedAt = formatDigitalSignatureDate(stamp.signedAt);

  return [
    "Firmado digitalmente por",
    signerName,
    signerId,
    signedAt ? `Fecha: ${signedAt}` : "",
  ].filter(Boolean);
}

function cleanDigitalSignatureLine(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function getPrescriptionText(prescription: PrescriptionDetails) {
  return (
    prescription.freeText.trim() ||
    buildLegacyPrescriptionText(prescription).trim()
  );
}

export function createPdfFileName(payload: PrescriptionPayload) {
  const patient = payload.patient.name || payload.patient.email || "paciente";
  const safePatient = patient
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `receta-duran-${safePatient || "paciente"}-${payload.id}.pdf`;
}

export function maskDocumentId(value: string) {
  const clean = value.trim();

  if (clean.length <= 4) {
    return clean ? "****" : "";
  }

  return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
}

export function maskEmail(value: string) {
  const [user, domain] = value.split("@");

  if (!user || !domain) {
    return "";
  }

  return `${user.slice(0, 2)}***@${domain}`;
}

function isFilled(value: string) {
  const normalized = value.trim().toLowerCase();

  return Boolean(
    normalized &&
      !normalized.includes("pendiente") &&
      !normalized.includes("configurar"),
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizePrescriptionDetails(
  prescription?: Partial<PrescriptionDetails>,
): PrescriptionDetails {
  const normalized = {
    ...emptyPrescriptionDetails,
    ...(prescription || {}),
  };

  if (!normalized.freeText.trim()) {
    normalized.freeText = buildLegacyPrescriptionText(normalized);
  }

  return normalized;
}

function buildLegacyPrescriptionText(prescription: PrescriptionDetails) {
  const hasLegacyContent = [
    prescription.medication,
    prescription.nationalCode,
    prescription.presentation,
    prescription.dosage,
    prescription.frequency,
    prescription.duration,
    prescription.quantity,
    prescription.instructions,
  ].some((value) => value.trim());

  if (!hasLegacyContent) {
    return "";
  }

  const lines = [
    compactLine(
      prescription.medication,
      prescription.nationalCode
        ? `Código nacional/CIMA: ${prescription.nationalCode}`
        : "",
    ),
    compactLine("Presentación:", prescription.presentation),
    compactLine("Dosis:", prescription.dosage),
    compactLine("Vía:", prescription.route),
    compactLine("Frecuencia:", prescription.frequency),
    compactLine("Duración:", prescription.duration),
    compactLine("Cantidad:", prescription.quantity),
    prescription.instructions,
  ];

  return lines.filter(Boolean).join("\n");
}

function compactLine(labelOrValue: string, value?: string) {
  if (value === undefined) {
    return labelOrValue.trim();
  }

  const cleanValue = value.trim();

  return cleanValue ? `${labelOrValue} ${cleanValue}`.trim() : "";
}

function getRandomToken(bytesLength: number) {
  const cryptoRef = globalThis.crypto;

  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(bytesLength);
    cryptoRef.getRandomValues(bytes);

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  return Array.from({ length: bytesLength }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}
