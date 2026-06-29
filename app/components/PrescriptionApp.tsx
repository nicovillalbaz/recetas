"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  type DoctorProfile,
  type PatientProfile,
  type PrescriptionDetails,
  type PrescriptionPayload,
  type PrescriptionRecord,
  buildPrescriptionId,
  createPdfFileName,
  defaultDoctorProfile,
  emptyPatientProfile,
  emptyPrescriptionDetails,
  formatDate,
  getDefaultExpiryDate,
  getPrescriptionText,
  normalizePrescriptionPayload,
  validatePrescriptionPayload,
} from "@/lib/prescription";

type CreatedPrescription = {
  record: PrescriptionRecord;
  verificationUrl: string;
  pdfUrl: string;
};

type GhlContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  documentId: string;
  birthDate: string;
  insurance: string;
};

type GhlContactSearchResponse = {
  contacts?: GhlContact[];
  error?: string;
};

const signatureLines = [
  "EN CORIA A 20/06/2026",
  "Fdo : Dra Durán Caballero, María del Sol",
  "Especialista en Ginecología y Obstetricia",
  "Col: 06/4993",
  "76012671V",
];

export default function PrescriptionApp() {
  const params = useSearchParams();
  const locationId = params.get("locationId") || params.get("location_id") || "";
  const contactId = params.get("contactId") || params.get("contact_id") || "";
  const [selectedContactId, setSelectedContactId] = useState(contactId);
  const [doctor, setDoctor] = useState<DoctorProfile>(defaultDoctorProfile);
  const [patient, setPatient] = useState<PatientProfile>({
    ...emptyPatientProfile,
    email:
      params.get("email") ||
      params.get("patientEmail") ||
      params.get("contact.email") ||
      "",
    name:
      params.get("name") ||
      params.get("patientName") ||
      params.get("contact.name") ||
      "",
    phone:
      params.get("phone") ||
      params.get("patientPhone") ||
      params.get("contact.phone") ||
      "",
  });
  const [contactSearch, setContactSearch] = useState(
    patient.name || patient.email || patient.phone,
  );
  const [contactResults, setContactResults] = useState<GhlContact[]>([]);
  const [isSearchingContacts, setIsSearchingContacts] = useState(false);
  const [contactSearchError, setContactSearchError] = useState("");
  const [prescription, setPrescription] = useState<PrescriptionDetails>({
    ...emptyPrescriptionDetails,
    freeText:
      params.get("receta") ||
      params.get("prescription") ||
      params.get("medication") ||
      "",
  });
  const [created, setCreated] = useState<CreatedPrescription | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const draftPayload = useMemo<PrescriptionPayload>(
    () =>
      normalizePrescriptionPayload({
        id: buildPrescriptionId(),
        createdAt: new Date().toISOString(),
        expiresAt: getDefaultExpiryDate(),
        locationId,
        contactId: selectedContactId,
        doctor,
        patient,
        prescription,
      }),
    [doctor, locationId, patient, prescription, selectedContactId],
  );
  const validationErrors = validatePrescriptionPayload(draftPayload);
  const visibleErrors = serverErrors.length > 0 ? serverErrors : validationErrors;
  const canGenerate = validationErrors.length === 0 && !isSaving;
  const previewPrescription = getPrescriptionText(prescription);

  useEffect(() => {
    if (!created?.verificationUrl) {
      setQrImage("");
      return;
    }

    QRCode.toDataURL(created.verificationUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260,
      color: {
        dark: "#9d2f63",
        light: "#ffffff",
      },
    }).then(setQrImage);
  }, [created]);

  useEffect(() => {
    const query = contactSearch.trim();

    if (query.length < 2) {
      setContactResults([]);
      setContactSearchError("");
      setIsSearchingContacts(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearchingContacts(true);
      setContactSearchError("");

      try {
        const response = await fetch(
          `/api/ghl/contacts?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as GhlContactSearchResponse;

        if (!response.ok) {
          setContactResults([]);
          setContactSearchError(
            data.error || "No se pudieron cargar los contactos de GHL.",
          );
          return;
        }

        setContactResults(data.contacts || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setContactResults([]);
          setContactSearchError("No se pudieron cargar los contactos de GHL.");
        }
      } finally {
        setIsSearchingContacts(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [contactSearch]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerErrors([]);

    if (!canGenerate) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/recetas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...draftPayload,
          id: buildPrescriptionId(),
          createdAt: new Date().toISOString(),
          expiresAt: getDefaultExpiryDate(),
        }),
      });
      const data = (await response.json()) as
        | CreatedPrescription
        | { errors?: string[] };

      if (!response.ok || !("record" in data)) {
        const errors = "errors" in data ? data.errors : undefined;
        setServerErrors(errors || ["No se pudo crear la receta."]);
        return;
      }

      setCreated(data);
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelPrescription() {
    if (!created) {
      return;
    }

    const shouldCancel = window.confirm("¿Anular esta receta?");

    if (!shouldCancel) {
      return;
    }

    const response = await fetch(`/api/recetas/${created.record.id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: created.record.token }),
    });

    if (!response.ok) {
      setServerErrors(["No se pudo anular la receta."]);
      return;
    }

    const data = (await response.json()) as { record: PrescriptionRecord };
    setCreated((current) =>
      current
        ? {
            ...current,
            record: data.record,
          }
        : current,
    );
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Durán Ginecología</p>
        </div>
      </section>

      <form className="workspace" onSubmit={handleSubmit}>
        <section className="form-column" aria-label="Formulario de receta">
          <fieldset>
            <legend>Paciente</legend>
            <div className="contact-picker">
              <label className="field">
                <span>Buscar paciente en GHL</span>
                <input
                  type="search"
                  value={contactSearch}
                  placeholder="Nombre, email o teléfono"
                  onChange={(event) => setContactSearch(event.target.value)}
                />
              </label>
              {(isSearchingContacts ||
                contactResults.length > 0 ||
                contactSearchError ||
                selectedContactId) && (
                <div className="contact-search-panel">
                  {isSearchingContacts && (
                    <p className="contact-search-status">Buscando...</p>
                  )}
                  {contactSearchError && (
                    <p className="contact-search-error">{contactSearchError}</p>
                  )}
                  {contactResults.length > 0 && (
                    <div className="contact-results">
                      {contactResults.map((contact) => (
                        <button
                          className="contact-result"
                          key={contact.id || `${contact.name}-${contact.phone}`}
                          type="button"
                          onClick={() => selectContact(contact)}
                        >
                          <span className="contact-result-main">
                            {contact.name || "Sin nombre"}
                          </span>
                          <span className="contact-result-meta">
                            {[
                              contact.email || "sin email",
                              contact.phone,
                              contact.documentId,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedContactId && (
                    <p className="contact-selected">
                      Contacto GHL: {selectedContactId}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="grid two">
              <TextField
                label="Nombre y dos apellidos"
                value={patient.name}
                required
                onChange={(value) => updatePatient("name", value)}
              />
              <TextField
                label="DNI / NIE"
                value={patient.documentId}
                required
                onChange={(value) => updatePatient("documentId", value)}
              />
              <TextField
                label="Fecha de nacimiento"
                value={patient.birthDate}
                required
                type="date"
                onChange={(value) => updatePatient("birthDate", value)}
              />
              <TextField
                label="Email del paciente (opcional)"
                value={patient.email}
                type="email"
                onChange={(value) => updatePatient("email", value)}
              />
              <TextField
                label="Teléfono"
                value={patient.phone}
                onChange={(value) => updatePatient("phone", value)}
              />
              <TextField
                label="Mutua / aseguradora"
                value={patient.insurance}
                onChange={(value) => updatePatient("insurance", value)}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Receta</legend>
            <TextArea
              label="Receta"
              value={prescription.freeText}
              required
              rows={9}
              placeholder="La doctora escribirá aquí la receta completa."
              onChange={(value) => updatePrescription("freeText", value)}
            />
          </fieldset>

          <fieldset>
            <legend>Datos de la doctora</legend>
            <div className="grid two">
              <TextField
                label="Profesional"
                value={doctor.name}
                required
                onChange={(value) => updateDoctor("name", value)}
              />
              <TextField
                label="Especialidad"
                value={doctor.specialty}
                required
                onChange={(value) => updateDoctor("specialty", value)}
              />
              <TextField
                label="N.º de colegiado"
                value={doctor.registration}
                required
                onChange={(value) => updateDoctor("registration", value)}
              />
              <TextField
                label="NIF"
                value={doctor.documentId}
                onChange={(value) => updateDoctor("documentId", value)}
              />
              <TextField
                label="Consulta / centro médico"
                value={doctor.clinicName}
                required
                onChange={(value) => updateDoctor("clinicName", value)}
              />
              <TextField
                label="Tipo de negocio"
                value={doctor.businessType}
                onChange={(value) => updateDoctor("businessType", value)}
              />
              <TextField
                label="Teléfono"
                value={doctor.phone}
                onChange={(value) => updateDoctor("phone", value)}
              />
            </div>
            <TextField
              label="Dirección profesional en España"
              value={doctor.address}
              required
              onChange={(value) => updateDoctor("address", value)}
            />
            <TextField
              label="Email profesional"
              value={doctor.email}
              type="email"
              onChange={(value) => updateDoctor("email", value)}
            />
            <TextField
              label="Web"
              value={doctor.website}
              type="url"
              onChange={(value) => updateDoctor("website", value)}
            />
            <TextField
              label="Identidad de firma digital"
              value={doctor.signatureIdentity}
              onChange={(value) => updateDoctor("signatureIdentity", value)}
            />
          </fieldset>

          {visibleErrors.length > 0 && (
            <div className="validation-panel">
              <strong>Faltan datos obligatorios</strong>
              <ul>
                {visibleErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!canGenerate}>
              {isSaving ? "Generando..." : "Generar receta y QR"}
            </button>
          </div>
        </section>

        <aside className="preview-column" aria-label="Vista previa">
          <div className="preview-paper prescription-preview">
            <header className="letterhead">
              <BrandHeader />
            </header>

            <h2>RECETA MÉDICA PARA ASISTENCIA SANITARIA PRIVADA</h2>

            <section className="preview-patient-data">
              <p>
                <span>Paciente:</span>
                {patient.name || "Nombre y apellidos"}
              </p>
              <p>
                <span>DNI/NIE:</span>
                {patient.documentId || "Documento"}
              </p>
              <p>
                <span>Fecha de nacimiento:</span>
                {patient.birthDate ? formatDate(patient.birthDate) : "dd/mm/aaaa"}
              </p>
              <p>
                <span>Email:</span>
                {patient.email || "No informado"}
              </p>
            </section>

            <section className="preview-recipe-text">
              <h3>RECETA MÉDICA PARA ASISTENCIA SANITARIA PRIVADA</h3>
              <p>{previewPrescription || "La doctora escribirá aquí la receta."}</p>
            </section>

            <section className="preview-signature-block">
              {signatureLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>

            <footer className="preview-clinic-footer">
              <p>C: / Cáceres, 2 | Cita Previa: 623 190 797 | 10800 Coria</p>
              <p>info@duranginecologia.com | www.duranginecologia.com</p>
            </footer>
          </div>

          <div className="qr-panel">
            {created && qrImage ? (
              <>
                <Image
                  src={qrImage}
                  alt="QR de verificación de la receta"
                  width={220}
                  height={220}
                  unoptimized
                />
                <div>
                  <p className="qr-title">
                    {created.record.status === "cancelled"
                      ? "Receta anulada"
                      : "Verificación lista"}
                  </p>
                  <p className="qr-meta">{created.record.id}</p>
                  <p className="qr-meta">
                    Validez hasta {formatDate(created.record.expiresAt)}
                  </p>
                </div>
                <div className="actions-row">
                  <a
                    className="secondary-button"
                    href={created.verificationUrl}
                    target="_blank"
                  >
                    Verificar
                  </a>
                  <a
                    className="secondary-button"
                    href={created.pdfUrl}
                    target="_blank"
                    download={createPdfFileName(created.record.payload)}
                  >
                    PDF
                  </a>
                </div>
                {created.record.status !== "cancelled" && (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={cancelPrescription}
                  >
                    Anular receta
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>El QR aparecerá aquí cuando generes la receta.</p>
                <span>
                  El QR abrirá una página de verificación con token; no incluirá
                  los datos médicos dentro del enlace.
                </span>
              </div>
            )}
          </div>
        </aside>
      </form>
    </main>
  );

  function selectContact(contact: GhlContact) {
    setCreated(null);
    setServerErrors([]);
    setSelectedContactId(contact.id || "");
    setPatient({
      name: contact.name || "",
      documentId: contact.documentId || "",
      birthDate: contact.birthDate || "",
      email: contact.email || "",
      phone: contact.phone || "",
      insurance: contact.insurance || "",
    });
    setContactSearch(contact.name || contact.email || contact.phone || "");
    setContactResults([]);
    setContactSearchError("");
  }

  function updateDoctor(key: keyof DoctorProfile, value: string) {
    setCreated(null);
    setServerErrors([]);
    setDoctor((current) => ({ ...current, [key]: value }));
  }

  function updatePatient(key: keyof PatientProfile, value: string) {
    setCreated(null);
    setServerErrors([]);
    setPatient((current) => ({ ...current, [key]: value }));
  }

  function updatePrescription(key: keyof PrescriptionDetails, value: string) {
    setCreated(null);
    setServerErrors([]);
    setPrescription((current) => ({ ...current, [key]: value }));
  }
}

function BrandHeader() {
  return (
    <>
      <Image
        src="/duran-caballero-header.png"
        alt="Dra. Durán Caballero - Ginecología y Obstetricia"
        width={320}
        height={255}
        className="brand-header-image"
        priority
      />
      <p className="brand-registration">Número de Colegiada&nbsp;&nbsp;06/4993</p>
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
