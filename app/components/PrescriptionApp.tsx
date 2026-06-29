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

type SignatureMethod = "autofirma" | "browser-p12" | "external" | "";
type SignatureDialogMode = "create" | "sign-existing";

type SignatureSecurityState = {
  method: SignatureMethod;
  certificateFileName: string;
  certificateRegisteredAt: string;
};

const SIGNATURE_SECURITY_STORAGE_KEY = "duran.signatureSecurity";

type AutoScriptApi = {
  KEYSTORE_APPLE?: string;
  KEYSTORE_MOZILLA?: string;
  KEYSTORE_WINDOWS?: string;
  cargarAppAfirma: (clientAddress?: string, keyStore?: string | null) => void;
  enableProgressDialog?: (showDialog: boolean) => void;
  getErrorCode?: () => string;
  getErrorMessage?: () => string;
  setAppName?: (name: string) => void;
  setKeyStore?: (keyStore?: string | null) => void;
  setLocale?: (locale: string) => void;
  setServiceTimeout?: (timeoutMs: number) => void;
  sign: (
    dataB64: string,
    algorithm: string,
    format: string,
    params: string | null,
    successCallback: (signatureB64: string, certificateB64?: string) => void,
    errorCallback: (errorType?: string, errorMessage?: string) => void,
  ) => void;
};

declare global {
  interface Window {
    AutoScript?: AutoScriptApi;
    duranAutoScriptLoading?: Promise<void>;
  }
}

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
  const [isAutoSigning, setIsAutoSigning] = useState(false);
  const [isBrowserSigning, setIsBrowserSigning] = useState(false);
  const [isUploadingSignedPdf, setIsUploadingSignedPdf] = useState(false);
  const [autoSignStatus, setAutoSignStatus] = useState("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signatureDialogMode, setSignatureDialogMode] =
    useState<SignatureDialogMode>("create");
  const [browserCertificateFile, setBrowserCertificateFile] =
    useState<File | null>(null);
  const [browserCertificatePassphrase, setBrowserCertificatePassphrase] =
    useState("");
  const [signatureSecurity, setSignatureSecurity] =
    useState<SignatureSecurityState>({
      method: "autofirma",
      certificateFileName: "",
      certificateRegisteredAt: "",
    });

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
  const isSigning = isAutoSigning || isBrowserSigning;
  const canGenerate =
    validationErrors.length === 0 && !isSaving && !isSigning;
  const previewPrescription = getPrescriptionText(prescription);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIGNATURE_SECURITY_STORAGE_KEY);

    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as SignatureSecurityState;
      setSignatureSecurity({
        method:
          parsed.method === "external"
            ? "external"
            : parsed.method === "browser-p12"
              ? "browser-p12"
              : parsed.method
              ? "autofirma"
              : "autofirma",
        certificateFileName: parsed.certificateFileName || "",
        certificateRegisteredAt: parsed.certificateRegisteredAt || "",
      });
    } catch {
      window.localStorage.removeItem(SIGNATURE_SECURITY_STORAGE_KEY);
    }
  }, []);

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

    setSignatureDialogMode("create");
    setIsSignatureDialogOpen(true);
  }

  async function generatePrescription({
    signatureMethod = "external",
  }: { signatureMethod?: SignatureMethod } = {}) {
    setServerErrors([]);

    setIsSaving(true);
    let createdPrescription: CreatedPrescription | null = null;

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
      createdPrescription = data;
      setIsSignatureDialogOpen(false);
    } finally {
      setIsSaving(false);
    }

    if (createdPrescription && signatureMethod === "autofirma") {
      await signPrescriptionWithAutoFirma(createdPrescription);
    }

    if (createdPrescription && signatureMethod === "browser-p12") {
      await signPrescriptionWithBrowserCertificate(createdPrescription);
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

  async function saveSignedPdf(target: CreatedPrescription, file: File) {
    const formData = new FormData();
    formData.set("token", target.record.token);
    formData.set("file", file);

    const response = await fetch(
      `/api/recetas/${target.record.id}/signed-pdf`,
      {
        method: "POST",
        body: formData,
      },
    );
    const data = (await response.json()) as
      | { record: PrescriptionRecord }
      | { errors?: string[] };

    if (!response.ok || !("record" in data)) {
      const errors = "errors" in data ? data.errors : undefined;
      setServerErrors(errors || ["No se pudo subir el PDF firmado."]);
      return null;
    }

    return data.record;
  }

  async function uploadSignedPdf(file?: File) {
    if (!created || !file) {
      return;
    }

    setIsUploadingSignedPdf(true);
    setServerErrors([]);

    try {
      const record = await saveSignedPdf(created, file);

      if (!record) {
        return;
      }

      setCreated((current) =>
        current
          ? {
              ...current,
              record,
            }
          : current,
      );
    } finally {
      setIsUploadingSignedPdf(false);
    }
  }

  async function signPrescriptionWithAutoFirma(target: CreatedPrescription) {
    setIsAutoSigning(true);
    setServerErrors([]);
    setAutoSignStatus("Preparando PDF base para AutoFirma...");

    try {
      const signedFile = await signPdfWithAutoFirma(
        getGeneratedPdfUrl(target.pdfUrl),
        createSignedPdfFileName(target.record.payload),
        setAutoSignStatus,
      );

      setAutoSignStatus("Guardando PDF firmado en la receta...");
      const record = await saveSignedPdf(target, signedFile);

      if (!record) {
        return;
      }

      setCreated((current) =>
        current
          ? {
              ...current,
              record,
            }
          : {
              ...target,
              record,
            },
      );
      setAutoSignStatus("PDF firmado guardado.");
    } catch (error) {
      setServerErrors([getAutoFirmaErrorMessage(error)]);
    } finally {
      window.setTimeout(() => setAutoSignStatus(""), 1800);
      setIsAutoSigning(false);
    }
  }

  async function signPrescriptionWithBrowserCertificate(
    target: CreatedPrescription,
  ) {
    if (!browserCertificateFile) {
      setServerErrors(["Sube un certificado .p12 o .pfx para probar esta firma."]);
      setSignatureSecurity((current) => ({
        ...current,
        method: "browser-p12",
      }));
      setSignatureDialogMode("sign-existing");
      setIsSignatureDialogOpen(true);
      return;
    }

    setIsBrowserSigning(true);
    setServerErrors([]);
    setAutoSignStatus("Preparando firma en navegador...");

    try {
      const signedFile = await signPdfWithBrowserCertificate(
        getGeneratedPdfUrl(target.pdfUrl, { signaturePlaceholder: true }),
        createSignedPdfFileName(target.record.payload),
        browserCertificateFile,
        browserCertificatePassphrase,
        setAutoSignStatus,
      );

      setAutoSignStatus("Guardando PDF firmado en la receta...");
      const record = await saveSignedPdf(target, signedFile);

      if (!record) {
        return;
      }

      setCreated((current) =>
        current
          ? {
              ...current,
              record,
            }
          : {
              ...target,
              record,
            },
      );
      setAutoSignStatus("PDF firmado guardado.");
    } catch (error) {
      setServerErrors([getBrowserCertificateErrorMessage(error)]);
    } finally {
      window.setTimeout(() => setAutoSignStatus(""), 1800);
      setIsBrowserSigning(false);
    }
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
              {isSaving || isAutoSigning ? "Procesando..." : "Generar receta y QR"}
            </button>
          </div>
        </section>

        <aside className="preview-column" aria-label="Vista previa">
          <div className="preview-paper prescription-preview">
            <header className="letterhead">
              <BrandHeader />
            </header>

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
                    href={getGeneratedPdfUrl(created.pdfUrl)}
                    target="_blank"
                    download={createPdfFileName(created.record.payload)}
                  >
                    PDF base
                  </a>
                </div>
                <div className="signed-pdf-panel">
                  <div>
                    <p className="signed-pdf-title">
                      {created.record.signedPdf
                        ? "PDF firmado cargado"
                        : "PDF firmado pendiente"}
                    </p>
                    <span>
                      {created.record.signedPdf
                        ? created.record.signedPdf.fileName
                        : "Firma con AutoFirma o sube aqui el PDF firmado."}
                    </span>
                  </div>
                  {!created.record.signedPdf && (
                    <div className="signature-method-actions">
                      <button
                        className="primary-button compact-action"
                        disabled={isSigning || isUploadingSignedPdf}
                        type="button"
                        onClick={() => signPrescriptionWithAutoFirma(created)}
                      >
                        {isAutoSigning ? "Firmando..." : "Firmar con AutoFirma"}
                      </button>
                      <button
                        className="secondary-button compact-action"
                        disabled={isSigning || isUploadingSignedPdf}
                        type="button"
                        onClick={() => {
                          updateSignatureSecurity("browser-p12");
                          setSignatureDialogMode("sign-existing");
                          setIsSignatureDialogOpen(true);
                        }}
                      >
                        {isBrowserSigning ? "Firmando..." : "Firmar con .p12"}
                      </button>
                    </div>
                  )}
                  {autoSignStatus && (
                    <p className="signature-inline-status">{autoSignStatus}</p>
                  )}
                  <label className="upload-signed-pdf">
                    <input
                      accept="application/pdf,.pdf"
                      disabled={isUploadingSignedPdf || isSigning}
                      type="file"
                      onChange={(event) => {
                        void uploadSignedPdf(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    {isUploadingSignedPdf ? "Subiendo..." : "Subir PDF firmado"}
                  </label>
                  <a
                    className="secondary-button"
                    href={created.pdfUrl}
                    target="_blank"
                  >
                    {created.record.signedPdf ? "Abrir PDF firmado" : "PDF actual"}
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

      {isSignatureDialogOpen && (
        <div className="modal-backdrop">
          <section
            aria-labelledby="signature-dialog-title"
            aria-modal="true"
            className="signature-dialog"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Seguridad de firma</p>
              <h2 id="signature-dialog-title">Firma digital del documento</h2>
              <p className="signature-dialog-copy">
                Elige si quieres usar AutoFirma o probar la firma experimental
                con certificado .p12/.pfx dentro del navegador.
              </p>
            </div>

            <div className="signature-status-card">
              <span>Estado</span>
              <strong>
                {signatureSecurity.method
                  ? "Metodo de firma preparado"
                  : "Firma pendiente"}
              </strong>
              <small>
                {signatureSecurity.method === "autofirma"
                  ? "AutoFirma usara el certificado instalado en el equipo cuando este disponible."
                  : signatureSecurity.method === "browser-p12"
                    ? browserCertificateFile
                      ? browserCertificateFile.name
                      : "Sube el archivo de certificado para firmar en el navegador."
                  : signatureSecurity.method === "external"
                    ? "Se generara el PDF base sin firma."
                    : "Selecciona como se firmara el PDF."}
              </small>
            </div>

            <div className="signature-options">
              <button
                className={`signature-option ${
                  signatureSecurity.method === "autofirma"
                    ? "selected"
                    : ""
                }`}
                type="button"
                onClick={() => updateSignatureSecurity("autofirma")}
              >
                <span>Firmar ahora con AutoFirma</span>
                <small>
                  Abre la aplicacion local de firma y devuelve el PDF firmado a
                  esta receta.
                </small>
              </button>

              <button
                className={`signature-option ${
                  signatureSecurity.method === "browser-p12" ? "selected" : ""
                }`}
                type="button"
                onClick={() => updateSignatureSecurity("browser-p12")}
              >
                <span>Firmar en navegador con .p12/.pfx</span>
                <small>
                  Procesa el certificado en esta pantalla para crear un PDF
                  firmado sin abrir AutoFirma.
                </small>
              </button>
            </div>

            {signatureSecurity.method === "browser-p12" && (
              <div className="browser-certificate-panel">
                <label className="field">
                  <span>Certificado .p12 / .pfx</span>
                  <input
                    accept=".p12,.pfx,application/x-pkcs12"
                    type="file"
                    onChange={(event) =>
                      updateBrowserCertificate(event.target.files?.[0])
                    }
                  />
                </label>
                <label className="field">
                  <span>Contraseña del certificado</span>
                  <input
                    autoComplete="off"
                    type="password"
                    value={browserCertificatePassphrase}
                    onChange={(event) =>
                      setBrowserCertificatePassphrase(event.target.value)
                    }
                  />
                </label>
                <p className="signature-caution">
                  Prueba experimental: la clave se procesa en este navegador y
                  no se guarda en GHL ni en el servidor.
                </p>
              </div>
            )}

            <div className="signature-dialog-actions">
              <button
                className="secondary-button"
                disabled={isSaving || isSigning}
                type="button"
                onClick={() => setIsSignatureDialogOpen(false)}
              >
                Cancelar
              </button>
              {signatureDialogMode === "create" && (
                <button
                  className="secondary-button"
                  disabled={isSaving || isSigning}
                  type="button"
                  onClick={() =>
                    generatePrescription({ signatureMethod: "external" })
                  }
                >
                  Solo PDF base
                </button>
              )}
              <button
                className="primary-button"
                disabled={isSaving || isSigning}
                type="button"
                onClick={runSelectedSignatureFlow}
              >
                {isSaving || isSigning
                  ? "Procesando..."
                  : signatureSecurity.method === "external"
                    ? "Generar PDF base y QR"
                    : signatureDialogMode === "sign-existing"
                      ? "Firmar PDF actual"
                      : signatureSecurity.method === "browser-p12"
                        ? "Generar y firmar con .p12"
                        : "Generar y firmar con AutoFirma"}
              </button>
            </div>
          </section>
        </div>
      )}
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

  function updateBrowserCertificate(file?: File) {
    setBrowserCertificateFile(file || null);
    setServerErrors([]);

    const next = {
      ...signatureSecurity,
      method: "browser-p12" as SignatureMethod,
      certificateFileName: file?.name || "",
      certificateRegisteredAt: file ? new Date().toISOString() : "",
    };

    setSignatureSecurity(next);
    window.localStorage.setItem(
      SIGNATURE_SECURITY_STORAGE_KEY,
      JSON.stringify(next),
    );
  }

  function updateSignatureSecurity(method: SignatureMethod) {
    const next = {
      ...signatureSecurity,
      method,
    };

    setSignatureSecurity(next);
    window.localStorage.setItem(
      SIGNATURE_SECURITY_STORAGE_KEY,
      JSON.stringify(next),
    );
  }

  async function runSelectedSignatureFlow() {
    const signatureMethod = signatureSecurity.method || "autofirma";

    if (signatureDialogMode === "sign-existing" && created) {
      setIsSignatureDialogOpen(false);

      if (signatureMethod === "browser-p12") {
        await signPrescriptionWithBrowserCertificate(created);
        return;
      }

      await signPrescriptionWithAutoFirma(created);
      return;
    }

    await generatePrescription({ signatureMethod });
  }

}

function getGeneratedPdfUrl(
  pdfUrl: string,
  options: { signaturePlaceholder?: boolean } = {},
) {
  const separator = pdfUrl.includes("?") ? "&" : "?";

  return `${pdfUrl}${separator}version=generated${
    options.signaturePlaceholder ? "&signaturePlaceholder=browser" : ""
  }`;
}

function createSignedPdfFileName(payload: PrescriptionPayload) {
  return createPdfFileName(payload).replace(/\.pdf$/i, "-firmado.pdf");
}

async function signPdfWithAutoFirma(
  pdfUrl: string,
  fileName: string,
  updateStatus: (status: string) => void,
) {
  if (isMobileUserAgent()) {
    throw new Error(
      "AutoFirma desde navegador no esta disponible en moviles. Abre la app desde un ordenador con AutoFirma instalada.",
    );
  }

  updateStatus("Cargando el cliente oficial de AutoFirma...");
  await loadAutoScript();

  updateStatus("Descargando PDF base...");
  const pdfResponse = await fetch(pdfUrl, { cache: "no-store" });

  if (!pdfResponse.ok) {
    throw new Error("No se pudo descargar el PDF base para firmarlo.");
  }

  const pdfBlob = await pdfResponse.blob();

  if (pdfBlob.size === 0) {
    throw new Error("El PDF base esta vacio.");
  }

  updateStatus("Abriendo AutoFirma para seleccionar certificado...");
  const pdfB64 = await blobToBase64(pdfBlob);
  const signedPdfB64 = await signBase64WithAutoFirma(pdfB64);
  const signedPdfBlob = base64ToPdfBlob(signedPdfB64);
  const header = await signedPdfBlob.slice(0, 5).text();

  if (!header.startsWith("%PDF-")) {
    throw new Error("AutoFirma no devolvio un PDF firmado valido.");
  }

  return new File([signedPdfBlob], fileName, { type: "application/pdf" });
}

async function signPdfWithBrowserCertificate(
  pdfUrl: string,
  fileName: string,
  certificateFile: File,
  passphrase: string,
  updateStatus: (status: string) => void,
) {
  updateStatus("Cargando firmador experimental en navegador...");
  const [bufferModule, signpdfModule, signerModule] = await Promise.all([
    import("buffer"),
    import("@signpdf/signpdf"),
    import("@signpdf/signer-p12"),
  ]);
  const runtimeGlobal = globalThis as typeof globalThis & {
    Buffer?: typeof bufferModule.Buffer;
  };

  runtimeGlobal.Buffer = bufferModule.Buffer;

  updateStatus("Descargando PDF base...");
  const pdfResponse = await fetch(pdfUrl, { cache: "no-store" });

  if (!pdfResponse.ok) {
    throw new Error("No se pudo descargar el PDF base para firmarlo.");
  }

  const pdfBuffer = bufferModule.Buffer.from(await pdfResponse.arrayBuffer());

  updateStatus("Leyendo certificado .p12/.pfx...");
  const certificateBuffer = bufferModule.Buffer.from(
    await certificateFile.arrayBuffer(),
  );

  updateStatus("Firmando PDF en este navegador...");
  const signer = new signerModule.P12Signer(certificateBuffer, { passphrase });
  const signedPdfBuffer = await signpdfModule.default.sign(pdfBuffer, signer);
  const signedBytes = Uint8Array.from(signedPdfBuffer);
  const signedBlob = new Blob([signedBytes], { type: "application/pdf" });
  const header = await signedBlob.slice(0, 5).text();

  if (!header.startsWith("%PDF-")) {
    throw new Error("La firma en navegador no devolvio un PDF valido.");
  }

  return new File([signedBlob], fileName, { type: "application/pdf" });
}

function loadAutoScript() {
  if (window.AutoScript) {
    return Promise.resolve();
  }

  if (window.duranAutoScriptLoading) {
    return window.duranAutoScriptLoading;
  }

  window.duranAutoScriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "/autoscript.js";
    script.onload = () =>
      window.AutoScript
        ? resolve()
        : reject(new Error("No se pudo inicializar AutoFirma."));
    script.onerror = () =>
      reject(new Error("No se pudo cargar el cliente web de AutoFirma."));
    document.body.appendChild(script);
  });

  return window.duranAutoScriptLoading;
}

function signBase64WithAutoFirma(pdfB64: string) {
  const autoScript = window.AutoScript;

  if (!autoScript) {
    throw new Error("AutoFirma no esta disponible en esta pagina.");
  }

  const keyStore = getPreferredAutoFirmaKeyStore(autoScript);

  autoScript.setLocale?.("es_ES");
  autoScript.setAppName?.("Duran Ginecologia");
  autoScript.setServiceTimeout?.(120000);
  autoScript.enableProgressDialog?.(true);
  autoScript.cargarAppAfirma(undefined, keyStore);

  if (keyStore) {
    autoScript.setKeyStore?.(keyStore);
  }

  return new Promise<string>((resolve, reject) => {
    autoScript.sign(
      pdfB64,
      "SHA256withRSA",
      "PAdES",
      null,
      (signatureB64) => resolve(signatureB64),
      (errorType, errorMessage) =>
        reject(
          new Error(
            [errorType, errorMessage].filter(Boolean).join(": ") ||
              "AutoFirma cancelo o no completo la firma.",
          ),
        ),
    );
  });
}

function getPreferredAutoFirmaKeyStore(autoScript: AutoScriptApi) {
  const platform = window.navigator.platform.toLowerCase();
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes("firefox") && autoScript.KEYSTORE_MOZILLA) {
    return autoScript.KEYSTORE_MOZILLA;
  }

  if (platform.includes("win") && autoScript.KEYSTORE_WINDOWS) {
    return autoScript.KEYSTORE_WINDOWS;
  }

  if (platform.includes("mac") && autoScript.KEYSTORE_APPLE) {
    return autoScript.KEYSTORE_APPLE;
  }

  return null;
}

function getAutoFirmaErrorMessage(error: unknown) {
  const autoScript = window.AutoScript;
  const autoFirmaMessage = autoScript?.getErrorMessage?.();
  const autoFirmaCode = autoScript?.getErrorCode?.();
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const details = [autoFirmaCode, autoFirmaMessage || rawMessage]
    .filter(Boolean)
    .join(" ");

  return `No se pudo firmar con AutoFirma.${details ? ` ${details}` : ""}`;
}

function getBrowserCertificateErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("mac verify failure") ||
    lowerMessage.includes("invalid password") ||
    lowerMessage.includes("pkcs12")
  ) {
    return "No se pudo firmar con el certificado .p12/.pfx. Revisa el archivo y la contraseña.";
  }

  return `No se pudo firmar en el navegador.${rawMessage ? ` ${rawMessage}` : ""}`;
}

function isMobileUserAgent() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el PDF base."));
    reader.readAsDataURL(blob);
  });
}

function base64ToPdfBlob(base64: string) {
  const cleanBase64 = base64.replace(/\s/g, "");
  const binary = window.atob(cleanBase64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: "application/pdf" });
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
