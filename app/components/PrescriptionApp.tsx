"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  type DigitalSignatureStamp,
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

type GhlContactDetailResponse = {
  contact?: GhlContact;
  error?: string;
};

type GhlSessionUser = {
  userId: string;
  companyId: string;
  locationId: string;
  role: string;
  userName: string;
  email: string;
  isAgencyOwner: boolean;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

type AuthResponse = {
  token?: string;
  expiresAt?: string;
  user?: GhlSessionUser;
  errors?: string[];
};

type PrescriptionLookupResponse =
  | CreatedPrescription
  | {
      errors?: string[];
    };

type SendPatientPdfResponse = {
  sent?: boolean;
  record?: PrescriptionRecord;
  errors?: string[];
};

type SignTokenResponse = {
  token?: string;
  expiresAt?: string;
  errors?: string[];
};

type RubricResponse = {
  rubric?: SignatureRubricState | null;
  errors?: string[];
};

type PrescriptionHistoryItem = {
  id: string;
  status: "active" | "cancelled" | "expired";
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

type PrescriptionHistoryResponse = {
  items?: PrescriptionHistoryItem[];
  errors?: string[];
};

type SignatureMethod = "autofirma" | "browser-p12" | "external" | "";
type SignatureDialogMode = "create" | "sign-existing";

type SignatureSecurityState = {
  method: SignatureMethod;
  certificateFileName: string;
  certificateRegisteredAt: string;
};

type SignatureRubricState = {
  fileName: string;
  imageB64: string;
  updatedAt: string;
};

const SIGNATURE_SECURITY_STORAGE_KEY = "duran.signatureSecurity";
const GHL_SESSION_STORAGE_KEY = "duran.ghlSession";
const DURAN_GHL_LOCATION_ID =
  (process.env.NEXT_PUBLIC_GHL_LOCATION_ID || "oHE4xQTwNInUOTgcLcJJ").trim();
const AUTOFIRMA_OPERATION_TIMEOUT_MS = 180000;
const MAX_SIGNATURE_RUBRIC_WIDTH = 900;
const MAX_SIGNATURE_RUBRIC_HEIGHT = 260;

type AutoScriptApi = {
  AUTOFIRMA_CONNECTION_RETRIES?: number;
  AUTOFIRMA_LAUNCHING_TIME?: number;
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
  setPortRange?: (minPort: number, maxPort: number) => void;
  setServiceTimeout?: (timeoutMs: number) => void;
  setStickySignatory?: (sticky: boolean) => void;
  selectCertificate?: (
    params: string | null,
    successCallback: (certificateB64: string) => void,
    errorCallback: (errorType?: string, errorMessage?: string) => void,
  ) => void;
  sign: (
    dataB64: string,
    algorithm: string,
    format: string,
    params: string | null,
    successCallback: (signatureB64: string, certificateB64?: string) => void,
    errorCallback: (errorType?: string, errorMessage?: string) => void,
  ) => void;
};

type ForgeCertificateAttribute = {
  name?: string;
  shortName?: string;
  type?: string;
  value?: unknown;
};

type ForgeCertificate = {
  subject?: {
    attributes?: ForgeCertificateAttribute[];
  };
};

type ForgePkcs12 = {
  getBags: (query: {
    bagType: string;
  }) => Record<string, Array<{ cert?: ForgeCertificate }>>;
};

type ForgeModule = {
  asn1: {
    fromDer: (der: string) => unknown;
  };
  pki: {
    certificateFromAsn1: (asn1: unknown) => ForgeCertificate;
    oids: {
      certBag: string;
    };
  };
  pkcs12: {
    pkcs12FromAsn1: (
      asn1: unknown,
      strict: boolean,
      password: string,
    ) => ForgePkcs12;
  };
  util: {
    decode64: (value: string) => string;
  };
};

declare global {
  interface Window {
    AutoScript?: AutoScriptApi;
    SupportDialog?: {
      enableSupportDialog?: (isEnabled: boolean) => void;
      enableLoadingDialog?: (isEnabled: boolean) => void;
      enableErrorDialog?: (isEnabled: boolean) => void;
    };
    duranAutoScriptLoading?: Promise<void>;
    exposeSessionDetails?: (appId?: string) => Promise<string>;
  }
}

const signatureLines = [
  "EN CORIA A 20/06/2026",
  "Fdo : Dra Durán Caballero, María del Sol",
  "Especialista en Ginecología y Obstetricia",
  "Col: 06/4993",
  "76012671V",
];

const emptySignatureRubric: SignatureRubricState = {
  fileName: "",
  imageB64: "",
  updatedAt: "",
};

export default function PrescriptionApp() {
  const params = useSearchParams();
  const locationId = resolveLocationIdFromContext(params);
  const effectiveLocationId = locationId || DURAN_GHL_LOCATION_ID;
  const contactId = params.get("contactId") || params.get("contact_id") || "";
  const signRecordId =
    params.get("signRecordId") ||
    params.get("recordId") ||
    params.get("prescriptionId") ||
    "";
  const signRecordToken =
    params.get("signToken") ||
    params.get("recordToken") ||
    params.get("token") ||
    "";
  const isExternalSignFlow = Boolean(
    params.get("externalSign") === "1" && signRecordId && signRecordToken,
  );
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
  const [isLoadingContactDetails, setIsLoadingContactDetails] = useState(false);
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
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoSigning, setIsAutoSigning] = useState(false);
  const [isBrowserSigning, setIsBrowserSigning] = useState(false);
  const [isSendingPatientPdf, setIsSendingPatientPdf] = useState(false);
  const [autoSignStatus, setAutoSignStatus] = useState("");
  const [patientSendStatus, setPatientSendStatus] = useState("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [isLoadingPrescription, setIsLoadingPrescription] = useState(false);
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signatureDialogMode, setSignatureDialogMode] =
    useState<SignatureDialogMode>("create");
  const [browserCertificateFile, setBrowserCertificateFile] =
    useState<File | null>(null);
  const [browserCertificatePassphrase, setBrowserCertificatePassphrase] =
    useState("");
  const [signatureRubric, setSignatureRubric] =
    useState<SignatureRubricState>(emptySignatureRubric);
  const [isPreparingRubric, setIsPreparingRubric] = useState(false);
  const [signatureSecurity, setSignatureSecurity] =
    useState<SignatureSecurityState>({
      method: "autofirma",
      certificateFileName: "",
      certificateRegisteredAt: "",
    });
  const [sessionToken, setSessionToken] = useState("");
  const [sessionUser, setSessionUser] = useState<GhlSessionUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authError, setAuthError] = useState("");
  const [historyItems, setHistoryItems] = useState<PrescriptionHistoryItem[]>(
    [],
  );
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<
    "all" | "active" | "cancelled" | "expired"
  >("all");
  const [historySigned, setHistorySigned] = useState<
    "all" | "signed" | "unsigned"
  >("all");
  const [historySent, setHistorySent] = useState<"all" | "sent" | "unsent">(
    "all",
  );
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const draftPayload = useMemo<PrescriptionPayload>(
    () =>
      normalizePrescriptionPayload({
        id: buildPrescriptionId(),
        createdAt: new Date().toISOString(),
        expiresAt: getDefaultExpiryDate(),
        locationId: sessionUser?.locationId || effectiveLocationId,
        contactId: selectedContactId,
        doctor,
        patient,
        prescription,
      }),
    [
      doctor,
      locationId,
      effectiveLocationId,
      patient,
      prescription,
      selectedContactId,
      sessionUser?.locationId,
    ],
  );
  const validationErrors = validatePrescriptionPayload(draftPayload);
  const visibleErrors = serverErrors.length > 0 ? serverErrors : validationErrors;
  const visibleErrorsTitle =
    serverErrors.length > 0 ? "No se pudo completar la operacion" : "Faltan datos obligatorios";
  const isSigning = isAutoSigning || isBrowserSigning;
  const canGenerate =
    authStatus === "authenticated" &&
    validationErrors.length === 0 &&
    !isSaving &&
    !isSigning &&
    Boolean(sessionToken);
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
          parsed.method === "browser-p12"
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
    let isActive = true;

    async function authenticate() {
      const clearSession = () => {
        window.sessionStorage.removeItem(GHL_SESSION_STORAGE_KEY);
        setSessionToken("");
        setSessionUser(null);
      };

      if (isExternalSignFlow) {
        clearSession();
        setAuthStatus("unauthenticated");
        setAuthError("");
        return;
      }

      if (effectiveLocationId !== DURAN_GHL_LOCATION_ID) {
        clearSession();
        setAuthStatus("unauthenticated");
        setAuthError(
          "Acceso prohibido. Esta app solo esta autorizada para la cuenta de Duran.",
        );
        return;
      }

      if (!isEmbeddedInFrame()) {
        clearSession();
        setAuthStatus("unauthenticated");
        setAuthError(
          "Acceso prohibido. Abre la app desde la cuenta de Duran.",
        );
        return;
      }

      const storedToken =
        window.sessionStorage.getItem(GHL_SESSION_STORAGE_KEY) || "";

      if (storedToken) {
        const restored = await restoreSession(storedToken);

        if (isActive && restored) {
          return;
        }
      }

      try {
        const fallbackPin =
          params.get("pin") ||
          params.get("accessPin") ||
          params.get("iframePin") ||
          "";
        const authPayload: {
          locationId: string;
          pin?: string;
          encryptedData?: string;
        } = { locationId: effectiveLocationId };

        if (fallbackPin) {
          authPayload.pin = fallbackPin;
        }

        const requestAuth = async (payload: typeof authPayload) => {
          const response = await fetch("/api/auth/ghl-sso", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const data = await readAuthResponse(response);

          return { response, data };
        };

        let { response, data } = await requestAuth(authPayload);

        if (!response.ok) {
          try {
            const encryptedData = await requestGhlEncryptedUserData();
            const encryptedPayload = { encryptedData, locationId: effectiveLocationId };
            ({ response, data } = await requestAuth(encryptedPayload));
          } catch {
            // keep the previous response from the location-only attempt.
          }
        }

        if (!response.ok || !data.token || !data.user) {
          throw new Error(
            data.errors?.[0] ||
              `Error de autenticacion (${response.status}).`,
          );
        }

        if (!isActive) {
          return;
        }

        window.sessionStorage.setItem(GHL_SESSION_STORAGE_KEY, data.token);
        setSessionToken(data.token);
        setSessionUser(data.user);
        setAuthStatus("authenticated");
        setAuthError("");
      } catch (error) {
        if (!isActive) {
          return;
        }

        clearSession();
        setAuthStatus("error");
        setAuthError(
          error instanceof Error
            ? error.message
            : "No se pudo iniciar sesion.",
        );
      }
    }

    async function restoreSession(token: string) {
      try {
        const response = await fetch("/api/auth/me", {
          headers: getSessionHeaders(token),
        });
        const data = await readAuthResponse(response);

        if (!response.ok || !data.user) {
          window.sessionStorage.removeItem(GHL_SESSION_STORAGE_KEY);
          return false;
        }

        setSessionToken(token);
        setSessionUser(data.user);
        setAuthStatus("authenticated");
        setAuthError("");

        return true;
      } catch {
        window.sessionStorage.removeItem(GHL_SESSION_STORAGE_KEY);
        return false;
      }
    }

    async function readAuthResponse(response: Response) {
      const responseText = await response.text();
      if (!responseText) {
        return {};
      }

      try {
        return JSON.parse(responseText) as AuthResponse;
      } catch {
        return {
          errors: [
            `Respuesta no valida del servidor (${response.status}).`,
          ],
        };
      }
    }

    void authenticate();

    return () => {
      isActive = false;
    };
  }, [isExternalSignFlow, effectiveLocationId]);

  useEffect(() => {
    if (!sessionToken) {
      if (!signRecordId || !signRecordToken) {
        setSignatureRubric(emptySignatureRubric);
      }

      return;
    }

    const controller = new AbortController();

    fetch("/api/signature/rubric", {
      headers: getSessionHeaders(sessionToken),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as RubricResponse;

        if (!response.ok) {
          throw new Error(data.errors?.[0] || "No se pudo cargar la rubrica.");
        }

        setSignatureRubric(data.rubric || emptySignatureRubric);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setSignatureRubric(emptySignatureRubric);
        }
      });

    return () => {
      controller.abort();
    };
  }, [sessionToken, signRecordId, signRecordToken]);

  useEffect(() => {
    if (!isExternalSignFlow) {
      return;
    }

    const controller = new AbortController();

    setIsLoadingPrescription(true);
    setServerErrors([]);

    fetchPrescriptionRecord(signRecordId, signRecordToken, controller.signal)
      .then((loaded) => {
        setCreated(loaded);
        setDoctor(loaded.record.payload.doctor);
        setPatient(loaded.record.payload.patient);
        setPrescription(loaded.record.payload.prescription);
        setSelectedContactId(loaded.record.contactId || "");
        setContactSearch(
          loaded.record.payload.patient.name ||
            loaded.record.payload.patient.email ||
            loaded.record.payload.patient.phone ||
            "",
        );
        setAutoSignStatus(
          "Receta cargada en ventana externa. Pulsa Firmar con AutoFirma para continuar.",
        );
        void fetchSignatureRubricForSignToken(
          signRecordId,
          signRecordToken,
          controller.signal,
        )
          .then((rubric) => {
            if (rubric) {
              setSignatureRubric(rubric);
            }
          })
          .catch(() => {
            setSignatureRubric(emptySignatureRubric);
          });
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setServerErrors([
            error instanceof Error
              ? error.message
              : "No se pudo cargar la receta para firmar.",
          ]);
        }
      })
      .finally(() => {
        setIsLoadingPrescription(false);
      });

    return () => {
      controller.abort();
    };
  }, [isExternalSignFlow, signRecordId, signRecordToken]);

  useEffect(() => {
    if (!contactId || !sessionToken) {
      return;
    }

    const controller = new AbortController();
    const fallbackContact: GhlContact = {
      id: contactId,
      name:
        params.get("name") ||
        params.get("patientName") ||
        params.get("contact.name") ||
        "",
      email:
        params.get("email") ||
        params.get("patientEmail") ||
        params.get("contact.email") ||
        "",
      phone:
        params.get("phone") ||
        params.get("patientPhone") ||
        params.get("contact.phone") ||
        "",
      documentId: "",
      birthDate: "",
      insurance: "",
    };

    setIsLoadingContactDetails(true);

    fetchGhlContactDetail(contactId, sessionToken, controller.signal)
      .then((contact) => {
        applyContact(mergeGhlContact(contact, fallbackContact));
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setContactSearchError("No se pudo cargar el contacto.");
        }
      })
      .finally(() => {
        setIsLoadingContactDetails(false);
      });

    return () => {
      controller.abort();
    };
  }, [contactId, params, sessionToken]);

  useEffect(() => {
    const query = contactSearch.trim();

    if (query.length < 2) {
      setContactResults([]);
      setContactSearchError("");
      setIsSearchingContacts(false);
      return;
    }

    if (!sessionToken) {
      setContactResults([]);
      setIsSearchingContacts(false);
      setContactSearchError(
        authStatus === "loading"
          ? "Conectando..."
          : "Inicia sesion para buscar contactos.",
      );
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearchingContacts(true);
      setContactSearchError("");

      try {
        const response = await fetch(
          `/api/ghl/contacts?q=${encodeURIComponent(query)}`,
          {
            headers: getSessionHeaders(sessionToken),
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as GhlContactSearchResponse;

        if (!response.ok) {
          setContactResults([]);
          setContactSearchError(
            data.error || "No se pudieron cargar los contactos.",
          );
          return;
        }

        setContactResults(data.contacts || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setContactResults([]);
          setContactSearchError("No se pudieron cargar los contactos.");
        }
      } finally {
        setIsSearchingContacts(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [authStatus, contactSearch, sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setHistoryItems([]);
      setHistoryError("");
      setIsLoadingHistory(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      q: historySearch,
      status: historyStatus,
      signed: historySigned,
      sent: historySent,
      limit: "40",
    });

    setIsLoadingHistory(true);
    setHistoryError("");

    fetch(`/api/recetas/history?${params.toString()}`, {
      headers: getSessionHeaders(sessionToken),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as PrescriptionHistoryResponse;

        if (!response.ok) {
          throw new Error(
            data.errors?.[0] || "No se pudo cargar el historial.",
          );
        }

        setHistoryItems(data.items || []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setHistoryItems([]);
          setHistoryError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el historial.",
          );
        }
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });

    return () => {
      controller.abort();
    };
  }, [
    historyRefreshNonce,
    historySearch,
    historySent,
    historySigned,
    historyStatus,
    sessionToken,
  ]);

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
    signatureMethod = "autofirma",
  }: { signatureMethod?: SignatureMethod } = {}) {
    setServerErrors([]);

    if (!sessionToken) {
      setServerErrors(["Inicia sesion para crear recetas."]);
      return;
    }

    const externalAutoFirmaWindow =
      signatureMethod === "autofirma" && isEmbeddedInFrame()
        ? openPendingAutoFirmaWindow()
        : null;

    if (signatureMethod === "autofirma" && isEmbeddedInFrame()) {
      if (!externalAutoFirmaWindow) {
        setServerErrors([
          "Chrome bloqueo la ventana externa de AutoFirma. Permite ventanas emergentes para esta web y vuelve a intentarlo.",
        ]);
        return;
      }
    }

    setIsSaving(true);
    let createdPrescription: CreatedPrescription | null = null;

    try {
      const response = await fetch("/api/recetas", {
        method: "POST",
        headers: {
          ...getSessionHeaders(sessionToken),
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
        externalAutoFirmaWindow?.close();
        return;
      }

      setCreated(data);
      createdPrescription = data;
      setHistoryRefreshNonce((current) => current + 1);
      setIsSignatureDialogOpen(false);
    } catch {
      externalAutoFirmaWindow?.close();
      setServerErrors(["No se pudo crear la receta."]);
    } finally {
      setIsSaving(false);
    }

    if (createdPrescription && signatureMethod === "autofirma") {
      if (isEmbeddedInFrame()) {
        const temporaryToken = await createTemporarySignToken(createdPrescription);

        if (!temporaryToken) {
          externalAutoFirmaWindow?.close();
          return;
        }

        if (externalAutoFirmaWindow) {
          externalAutoFirmaWindow.location.href = buildStandaloneAutoFirmaUrl(
            createdPrescription,
            temporaryToken,
          );
          try {
            externalAutoFirmaWindow.opener = null;
          } catch {
            // The signing window is already isolated enough for this flow.
          }
        }

        setAutoSignStatus(
          "Se abrio una ventana externa para firmar con AutoFirma.",
        );
        return;
      }

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

    if (!sessionToken) {
      setServerErrors(["Inicia sesion para anular recetas."]);
      return;
    }

    const shouldCancel = window.confirm("¿Anular esta receta?");

    if (!shouldCancel) {
      return;
    }

    const response = await fetch(`/api/recetas/${created.record.id}/cancel`, {
      method: "POST",
      headers: {
        ...getSessionHeaders(sessionToken),
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
    setHistoryRefreshNonce((current) => current + 1);
  }

  async function saveSignedPdf(target: CreatedPrescription, file: File) {
    const formData = new FormData();
    formData.set("token", target.record.token);
    formData.set("file", file);

    const response = await fetch(
      `/api/recetas/${target.record.id}/signed-pdf`,
      {
        method: "POST",
        headers: getSessionHeaders(sessionToken),
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

    setHistoryRefreshNonce((current) => current + 1);

    return data.record;
  }

  async function sendSignedPdfToPatient(target: CreatedPrescription) {
    if (!target.record.signedPdf) {
      setServerErrors(["Firma primero el PDF antes de enviarlo al paciente."]);
      return;
    }

    if (!sessionToken) {
      setServerErrors(["Inicia sesion para enviar recetas."]);
      return;
    }

    setIsSendingPatientPdf(true);
    setPatientSendStatus("");
    setServerErrors([]);

    try {
      const response = await fetch(
        `/api/recetas/${target.record.id}/send-patient`,
        {
          method: "POST",
          headers: {
            ...getSessionHeaders(sessionToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: target.record.token }),
        },
      );
      const data = (await response.json()) as SendPatientPdfResponse;

      if (!response.ok || !data.sent) {
        setServerErrors(data.errors || ["No se pudo enviar al paciente."]);
        return;
      }

      if (data.record) {
        setCreated((current) =>
          current
            ? {
                ...current,
                record: data.record as PrescriptionRecord,
              }
            : current,
        );
      }

      setPatientSendStatus("Enviado al paciente por SMS.");
      setHistoryRefreshNonce((current) => current + 1);
    } finally {
      setIsSendingPatientPdf(false);
      window.setTimeout(() => setPatientSendStatus(""), 2400);
    }
  }

  async function createTemporarySignToken(target: CreatedPrescription) {
    try {
      const response = await fetch(
        `/api/recetas/${target.record.id}/sign-token`,
        {
          method: "POST",
          headers: getSessionHeaders(sessionToken),
        },
      );
      const data = (await response.json()) as SignTokenResponse;

      if (!response.ok || !data.token) {
        setServerErrors(
          data.errors || ["No se pudo preparar el token temporal de firma."],
        );
        return "";
      }

      return data.token;
    } catch {
      setServerErrors(["No se pudo preparar el token temporal de firma."]);
      return "";
    }
  }

  async function signPrescriptionWithAutoFirma(target: CreatedPrescription) {
    if (isEmbeddedInFrame()) {
      if (!sessionToken) {
        setServerErrors(["Inicia sesion para firmar recetas."]);
        return;
      }

      const externalAutoFirmaWindow = openPendingAutoFirmaWindow();

      if (!externalAutoFirmaWindow) {
        setServerErrors([
          "Chrome bloqueo la ventana externa de AutoFirma. Permite ventanas emergentes para esta web y vuelve a intentarlo.",
        ]);
        return;
      }

      setAutoSignStatus("Preparando ventana externa de AutoFirma...");

      const temporaryToken = await createTemporarySignToken(target);

      if (!temporaryToken) {
        externalAutoFirmaWindow.close();
        return;
      }

      externalAutoFirmaWindow.location.href = buildStandaloneAutoFirmaUrl(
        target,
        temporaryToken,
      );
      try {
        externalAutoFirmaWindow.opener = null;
      } catch {
        // The signing window is already isolated enough for this flow.
      }

      setAutoSignStatus(
        "Se abrio una ventana externa para firmar con AutoFirma.",
      );
      window.setTimeout(() => setAutoSignStatus(""), 5000);
      return;
    }

    setIsAutoSigning(true);
    setServerErrors([]);
    setAutoSignStatus("Preparando PDF para AutoFirma...");

    try {
      const signedFile = await signPdfWithAutoFirma(
        target.pdfUrl,
        createSignedPdfFileName(target.record.payload),
        setAutoSignStatus,
        signatureRubric.imageB64,
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

      if (isExternalSignFlow) {
        window.setTimeout(() => {
          window.close();
          window.setTimeout(() => {
            setAutoSignStatus(
              "PDF firmado guardado. Puedes cerrar esta pestana.",
            );
          }, 600);
        }, 900);
      }
    } catch (error) {
      setServerErrors([getAutoFirmaErrorMessage(error)]);
    } finally {
      if (!isExternalSignFlow) {
        window.setTimeout(() => setAutoSignStatus(""), 1800);
      }
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
        target.pdfUrl,
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

  if (isExternalSignFlow) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Firma externa</p>
          <h1>AutoFirma</h1>

          {isLoadingPrescription && (
            <p className="auth-message">Validando token temporal...</p>
          )}

          {!isLoadingPrescription && !created && (
            <p className="auth-message">
              Acceso prohibido o token de firma caducado.
            </p>
          )}

          {created && (
            <>
              <p className="auth-message">
                {created.record.signedPdf
                  ? "PDF firmado y guardado."
                  : "Token temporal validado."}
              </p>
              {autoSignStatus && (
                <p className="signature-inline-status">{autoSignStatus}</p>
              )}
              <button
                className="primary-button"
                disabled={
                  isLoadingPrescription ||
                  isSigning ||
                  Boolean(created.record.signedPdf)
                }
                type="button"
                onClick={() => {
                  void signPrescriptionWithAutoFirma(created);
                }}
              >
                {isSigning ? "Firmando..." : "Firmar con AutoFirma"}
              </button>
            </>
          )}

          {serverErrors.length > 0 && (
            <div className="validation-panel">
              <strong>No se pudo completar la firma</strong>
              <ul>
                {serverErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (authStatus !== "authenticated") {
    return <AuthGate message={authError} status={authStatus} />;
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Durán Ginecología</p>
        </div>
      </section>

      <details
        className="history-panel"
        aria-label="Historial de recetas"
        open={isHistoryOpen}
        onToggle={(event) => {
          setIsHistoryOpen(event.currentTarget.open);
        }}
      >
        <summary className="history-header">
          <div>
            <p className="eyebrow">Historial</p>
            <h2>Recetas guardadas</h2>
          </div>
          <span className="history-toggle-label">
            {isHistoryOpen ? "Ocultar" : "Mostrar"}
          </span>
        </summary>
        <div className="history-body">
          <div className="history-actions">
            <button
              className="secondary-button compact-action"
              disabled={!sessionToken || isLoadingHistory}
              type="button"
              onClick={() => setHistoryRefreshNonce((current) => current + 1)}
            >
              Actualizar
            </button>
          </div>
          <div className="history-filters">
            <label className="field">
              <span>Buscar</span>
              <input
                disabled={!sessionToken}
                placeholder="Nueva receta, DNI/NIE o codigo"
                type="search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Estado</span>
              <select
                disabled={!sessionToken}
                value={historyStatus}
                onChange={(event) =>
                  setHistoryStatus(event.target.value as typeof historyStatus)
                }
              >
                <option value="all">Todas</option>
                <option value="active">Activas</option>
                <option value="cancelled">Anuladas</option>
                <option value="expired">Caducadas</option>
              </select>
            </label>
            <label className="field">
              <span>Firma</span>
              <select
                disabled={!sessionToken}
                value={historySigned}
                onChange={(event) =>
                  setHistorySigned(event.target.value as typeof historySigned)
                }
              >
                <option value="all">Todas</option>
                <option value="signed">Firmadas</option>
                <option value="unsigned">Sin firma</option>
              </select>
            </label>
            <label className="field">
              <span>Envio</span>
              <select
                disabled={!sessionToken}
                value={historySent}
                onChange={(event) =>
                  setHistorySent(event.target.value as typeof historySent)
                }
              >
                <option value="all">Todas</option>
                <option value="sent">Enviadas</option>
                <option value="unsent">No enviadas</option>
              </select>
            </label>
          </div>
          <div className="history-list">
            {historyError && (
              <p className="contact-search-error">{historyError}</p>
            )}
            {isLoadingHistory && (
              <p className="contact-search-status">Cargando historial...</p>
            )}
            {!isLoadingHistory &&
              sessionToken &&
              historyItems.length === 0 &&
              !historyError && (
                <p className="contact-search-status">Sin recetas guardadas.</p>
              )}
            {historyItems.map((item) => (
              <button
                className="history-item"
                key={item.id}
                type="button"
                onClick={() => {
                  void loadHistoryPrescription(item);
                }}
              >
                <span>
                  <strong>{item.patientName || "Sin nombre"}</strong>
                  <small>{item.id}</small>
                </span>
                <span className="history-tags">
                  <small>{formatDate(item.createdAt)}</small>
                  <small>{historyStatusLabel(item.status)}</small>
                  <small>{item.signed ? "Firmada" : "Sin firma"}</small>
                  <small>{item.sent ? "Enviada" : "No enviada"}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </details>

      <form className="workspace" onSubmit={handleSubmit}>
        <section className="form-column" aria-label="Formulario de receta">
          <fieldset>
            <legend>Nueva receta</legend>
            <div className="contact-picker">
              <label className="field">
                <span>Buscar paciente</span>
                <input
                  disabled={!sessionToken}
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
                          onClick={() => {
                            void selectContact(contact);
                          }}
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
                      {isLoadingContactDetails
                        ? "Cargando datos del contacto..."
                        : `Contacto seleccionado: ${selectedContactId}`}
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
                onChange={(value) => updatePatient("documentId", value)}
              />
              <TextField
                label="Fecha de nacimiento"
                value={patient.birthDate}
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

          <details className="doctor-details">
            <summary>Datos de la doctora</summary>
            <div className="doctor-details-body">
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
            </div>
          </details>

          {visibleErrors.length > 0 && (
            <div className="validation-panel">
              <strong>{visibleErrorsTitle}</strong>
              <ul>
                {visibleErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={!canGenerate}>
              {isSaving || isSigning || isLoadingPrescription
                ? "Procesando..."
                : "Generar PDF y QR"}
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
                <span>Nueva receta:</span>
                {patient.name || "Nombre y apellidos"}
              </p>
              {patient.documentId && (
                <p>
                  <span>DNI/NIE:</span>
                  {patient.documentId}
                </p>
              )}
              {patient.birthDate && (
                <p>
                  <span>Fecha de nacimiento:</span>
                  {formatDate(patient.birthDate)}
                </p>
              )}
              {patient.email && (
                <p>
                  <span>Email:</span>
                  {patient.email}
                </p>
              )}
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
            {created ? (
              <>
                <div>
                  <p className="qr-title">
                    {created.record.status === "cancelled"
                      ? "Receta anulada"
                      : "Receta generada"}
                  </p>
                  <p className="qr-meta">{created.record.id}</p>
                  <p className="qr-meta">
                    Validez hasta {formatDate(created.record.expiresAt)}
                  </p>
                </div>
                <div className="actions-row recipe-actions">
                  <a
                    className="secondary-button"
                    href={created.pdfUrl}
                    target="_blank"
                  >
                    Ver PDF
                  </a>
                  <button
                    className="primary-button"
                    disabled={
                      !created.record.signedPdf ||
                      created.record.status === "cancelled" ||
                      isSendingPatientPdf ||
                      isSigning
                    }
                    type="button"
                    onClick={() => sendSignedPdfToPatient(created)}
                  >
                    {isSendingPatientPdf ? "Enviando..." : "Enviar a cliente"}
                  </button>
                </div>
                {created.record.status !== "cancelled" && (
                  <div className="signed-pdf-panel compact-status-panel">
                    <p className="signed-pdf-title">
                      {created.record.signedPdf
                        ? "PDF firmado listo"
                        : "PDF pendiente de firma"}
                    </p>
                    {created.record.signedPdf && (
                      <span>{created.record.signedPdf.fileName}</span>
                    )}
                    {autoSignStatus && (
                      <p className="signature-inline-status">{autoSignStatus}</p>
                    )}
                    {patientSendStatus && (
                      <p className="signature-inline-status">
                        {patientSendStatus}
                      </p>
                    )}
                  </div>
                )}
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
                <p>La receta aparecerá aquí cuando generes el PDF.</p>
                <span>El QR de verificación se incluirá dentro del PDF.</span>
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
                  ? signatureRubric.imageB64
                    ? `AutoFirma usara el certificado instalado y la rubrica visual ${signatureRubric.fileName}.`
                    : "AutoFirma usara el certificado instalado en el equipo cuando este disponible."
                  : signatureSecurity.method === "browser-p12"
                    ? browserCertificateFile
                      ? browserCertificateFile.name
                      : "Sube el archivo de certificado para firmar en el navegador."
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

            {signatureSecurity.method === "autofirma" && (
              <div className="signature-rubric-panel">
                <label className="field">
                  <span>Rubrica visual opcional</span>
                  <input
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    disabled={isPreparingRubric}
                    type="file"
                    onChange={(event) => {
                      void updateSignatureRubric(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {signatureRubric.imageB64 ? (
                  <div className="signature-rubric-preview">
                    <Image
                      alt="Rubrica visual seleccionada"
                      height={86}
                      src={`data:image/jpeg;base64,${signatureRubric.imageB64}`}
                      unoptimized
                      width={260}
                    />
                    <div>
                      <strong>{signatureRubric.fileName}</strong>
                      <button
                        className="secondary-button compact-action"
                        disabled={isPreparingRubric || isSigning}
                        type="button"
                        onClick={() => {
                          void updateSignatureRubric();
                        }}
                      >
                        Quitar rubrica
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="signature-caution">
                    Si subes una imagen PNG o JPG, se usara como apariencia
                    visual fija de AutoFirma. La validez seguira dependiendo del
                    certificado digital.
                  </p>
                )}
                {isPreparingRubric && (
                  <p className="signature-caution">Preparando imagen...</p>
                )}
              </div>
            )}

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
                  no se guarda en el servidor.
                </p>
              </div>
            )}

            <div className="signature-dialog-actions">
              <button
                className="secondary-button"
                disabled={isSaving || isSigning || isPreparingRubric}
                type="button"
                onClick={() => setIsSignatureDialogOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={isSaving || isSigning || isPreparingRubric}
                type="button"
                onClick={runSelectedSignatureFlow}
              >
                {isSaving || isSigning || isPreparingRubric
                  ? "Procesando..."
                  : signatureDialogMode === "sign-existing"
                      ? "Firmar PDF"
                      : "Generar PDF y QR"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );

  async function loadHistoryPrescription(item: PrescriptionHistoryItem) {
    setServerErrors([]);
    setIsLoadingPrescription(true);

    try {
      const loaded = await fetchPrescriptionRecord(item.id, item.pdfUrlToken);

      setCreated(loaded);
      setDoctor(loaded.record.payload.doctor);
      setPatient(loaded.record.payload.patient);
      setPrescription(loaded.record.payload.prescription);
      setSelectedContactId(loaded.record.contactId || "");
      setContactSearch(
        loaded.record.payload.patient.name ||
          loaded.record.payload.patient.email ||
          loaded.record.payload.patient.phone ||
          "",
      );
      setAutoSignStatus("");
      setPatientSendStatus("");
    } catch (error) {
      setServerErrors([
        error instanceof Error
          ? error.message
          : "No se pudo cargar la receta del historial.",
      ]);
    } finally {
      setIsLoadingPrescription(false);
    }
  }

  async function selectContact(contact: GhlContact) {
    setCreated(null);
    setServerErrors([]);
    applyContact(contact);
    setContactResults([]);
    setContactSearchError("");

    if (!contact.id || !sessionToken) {
      return;
    }

    setIsLoadingContactDetails(true);

    try {
      const detail = await fetchGhlContactDetail(contact.id, sessionToken);
      applyContact(mergeGhlContact(detail, contact));
    } catch {
      setContactSearchError("No se pudo cargar la ficha completa.");
    } finally {
      setIsLoadingContactDetails(false);
    }
  }

  function applyContact(contact: GhlContact) {
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

  async function updateSignatureRubric(file?: File) {
    setServerErrors([]);

    if (!sessionToken) {
      setServerErrors(["Inicia sesion para guardar la rubrica."]);
      return;
    }

    if (!file) {
      setIsPreparingRubric(true);

      try {
        const response = await fetch("/api/signature/rubric", {
          method: "DELETE",
          headers: getSessionHeaders(sessionToken),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            errors?: string[];
          };
          throw new Error(data.errors?.[0] || "No se pudo quitar la rubrica.");
        }

        setSignatureRubric(emptySignatureRubric);
      } catch (error) {
        setServerErrors([
          error instanceof Error
            ? error.message
            : "No se pudo quitar la rubrica.",
        ]);
      } finally {
        setIsPreparingRubric(false);
      }

      return;
    }

    setIsPreparingRubric(true);

    try {
      const imageB64 = await convertSignatureRubricFileToJpegBase64(file);

      const response = await fetch("/api/signature/rubric", {
        method: "POST",
        headers: {
          ...getSessionHeaders(sessionToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name || "rubrica.jpg",
          imageB64,
        }),
      });
      const data = (await response.json()) as RubricResponse;

      if (!response.ok || !data.rubric) {
        throw new Error(
          data.errors?.[0] || "No se pudo guardar la rubrica visual.",
        );
      }

      setSignatureRubric(data.rubric);
    } catch (error) {
      setSignatureRubric(emptySignatureRubric);
      setServerErrors([
        error instanceof Error
          ? error.message
          : "No se pudo preparar la rubrica visual.",
      ]);
    } finally {
      setIsPreparingRubric(false);
    }
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

async function fetchGhlContactDetail(
  contactId: string,
  sessionToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/ghl/contacts/${encodeURIComponent(contactId)}`,
    {
      headers: getSessionHeaders(sessionToken),
      signal,
    },
  );
  const data = (await response.json()) as GhlContactDetailResponse;

  if (!response.ok || !data.contact) {
    throw new Error(data.error || "No se pudo cargar el contacto.");
  }

  return data.contact;
}

async function fetchSignatureRubricForSignToken(
  recordId: string,
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/recetas/${encodeURIComponent(recordId)}/sign-rubric?token=${encodeURIComponent(token)}`,
    { signal },
  );
  const data = (await response.json()) as RubricResponse;

  if (!response.ok) {
    throw new Error(data.errors?.[0] || "No se pudo cargar la rubrica.");
  }

  return data.rubric || null;
}

async function fetchPrescriptionRecord(
  recordId: string,
  token: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/recetas/${encodeURIComponent(recordId)}?token=${encodeURIComponent(token)}`,
    { signal },
  );
  const data = (await response.json()) as PrescriptionLookupResponse;

  if (!response.ok || !("record" in data)) {
    const message =
      "errors" in data && data.errors?.length
        ? data.errors[0]
        : "No se pudo cargar la receta para firmar.";

    throw new Error(message);
  }

  return data;
}

function mergeGhlContact(
  primary: GhlContact,
  fallback: GhlContact,
): GhlContact {
  return {
    id: primary.id || fallback.id,
    name: primary.name || fallback.name,
    email: primary.email || fallback.email,
    phone: primary.phone || fallback.phone,
    documentId: primary.documentId || fallback.documentId,
    birthDate: primary.birthDate || fallback.birthDate,
    insurance: primary.insurance || fallback.insurance,
  };
}

function getGeneratedPdfUrl(
  pdfUrl: string,
  options: {
    digitalSignatureStamp?: DigitalSignatureStamp;
    signaturePlaceholder?: boolean;
  } = {},
) {
  const url = new URL(pdfUrl, window.location.origin);

  url.searchParams.set("version", "generated");

  if (options.signaturePlaceholder) {
    url.searchParams.set("signaturePlaceholder", "browser");
  }

  if (options.digitalSignatureStamp) {
    url.searchParams.set("signerName", options.digitalSignatureStamp.signerName);
    url.searchParams.set("signedAt", options.digitalSignatureStamp.signedAt);

    if (options.digitalSignatureStamp.signerId) {
      url.searchParams.set("signerId", options.digitalSignatureStamp.signerId);
    }
  }

  return new URL(url.pathname + url.search + url.hash, window.location.origin).toString();
}

function createSignedPdfFileName(payload: PrescriptionPayload) {
  return createPdfFileName(payload).replace(/\.pdf$/i, "-firmado.pdf");
}

function openPendingAutoFirmaWindow() {
  const opened = window.open("about:blank", "_blank");

  if (!opened) {
    return null;
  }

  try {
    opened.document.title = "Preparando AutoFirma";
    opened.document.body.innerHTML =
      "<p style=\"font-family:Arial,sans-serif;margin:24px\">Preparando AutoFirma...</p>";
  } catch {
    // Some browsers restrict access immediately; the window can still be reused.
  }

  return opened;
}

function buildStandaloneAutoFirmaUrl(
  target: CreatedPrescription,
  signToken = target.record.token,
) {
  const url = new URL(window.location.pathname || "/", window.location.origin);

  url.searchParams.set("externalSign", "1");
  url.searchParams.set("signRecordId", target.record.id);
  url.searchParams.set("signToken", signToken);

  return url.toString();
}

function isEmbeddedInFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function getSessionHeaders(sessionToken: string): Record<string, string> {
  return sessionToken
    ? {
        Authorization: `Bearer ${sessionToken}`,
      }
    : {};
}

async function requestGhlEncryptedUserData() {
  const appId = process.env.NEXT_PUBLIC_GHL_APP_ID || undefined;

  if (typeof window.exposeSessionDetails === "function") {
    try {
      const exposedData = await window.exposeSessionDetails(appId);
      if (typeof exposedData === "string" && exposedData.trim()) {
        return exposedData.trim();
      }

      throw new Error("La sesion recibida esta vacia.");
    } catch {
      // Keep compatibility with environments where exposeSessionDetails is unavailable
      // or not functioning as expected. Fallback to postMessage handshake.
    }
  }

  return requestSessionDetailsByPostMessage(appId);
}

function requestSessionDetailsByPostMessage(appId?: string) {
  const requestPayloads = [
    { message: "REQUEST_USER_DATA", appId },
    { type: "REQUEST_USER_DATA", appId },
    { event: "REQUEST_USER_DATA", appId },
  ];
  const requestTargets: Array<Window | WindowProxy> = [window.parent];

  if (window.top && window.top !== window.parent) {
    requestTargets.push(window.top);
  }

  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("No se pudo leer la sesion de usuario."));
    }, 12000);

    function handleMessage(event: MessageEvent) {
      const payload = extractRequestUserDataPayload(event.data);
      if (!payload) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (typeof payload !== "string" || !payload.trim()) {
        reject(new Error("La sesion recibida esta vacia."));
        return;
      }

      resolve(payload.trim());
    }

    function sendRequestMessage(target: Window | WindowProxy) {
      try {
        for (const payload of requestPayloads) {
          target.postMessage(payload, "*");
        }
      } catch {
        // Ignore failures for invalid targets/cross-origin edge cases.
      }
    }

    window.addEventListener("message", handleMessage);
    requestTargets.forEach(sendRequestMessage);
  });
}

function extractRequestUserDataPayload(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const eventData = data as {
    message?: string;
    type?: string;
    event?: string;
    payload?: unknown;
    data?: unknown;
    [key: string]: unknown;
  };

  const isResponse =
    eventData.message === "REQUEST_USER_DATA_RESPONSE" ||
    eventData.type === "REQUEST_USER_DATA_RESPONSE" ||
    eventData.event === "REQUEST_USER_DATA_RESPONSE";

  if (!isResponse) {
    return "";
  }

  return findEncryptedDataValue(eventData) || "";
}

function findEncryptedDataValue(data: unknown): string {
  if (!data) {
    return "";
  }

  if (typeof data === "string") {
    return data.trim();
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return "";
  }

  const record = data as Record<string, unknown>;

  const keyPriority: Array<keyof Record<string, unknown>> = [
    "encryptedData",
    "encryptedUserData",
    "payload",
    "data",
    "sessionData",
    "result",
    "token",
    "session",
  ];

  for (const key of keyPriority) {
    const value = record[key];

    if (typeof value === "string") {
      const text = value.trim();
      if (text) {
        return text;
      }
    }
  }

  for (const key of keyPriority) {
    const value = record[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const nested = findEncryptedDataValue(value);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function resolveLocationIdFromContext(params: {
  get(name: string): string | null;
}) {
  const queryLocationId = params.get("locationId") || params.get("location_id") || "";

  if (queryLocationId) {
    return queryLocationId;
  }

  return (
    extractLocationIdFromPath(window.location.pathname) ||
    extractLocationIdFromReferrer()
  );
}

function extractLocationIdFromPath(path: string) {
  const match = path.match(/\/location\/([^/?#]+)/i);

  return match?.[1] || "";
}

function extractLocationIdFromReferrer() {
  if (!document.referrer) {
    return "";
  }

  try {
    const referrerUrl = new URL(document.referrer);

    return extractLocationIdFromPath(referrerUrl.pathname);
  } catch {
    return "";
  }
}

function historyStatusLabel(status: PrescriptionHistoryItem["status"]) {
  if (status === "cancelled") {
    return "Anulada";
  }

  if (status === "expired") {
    return "Caducada";
  }

  return "Activa";
}

async function signPdfWithAutoFirma(
  pdfUrl: string,
  fileName: string,
  updateStatus: (status: string) => void,
  signatureRubricImageB64 = "",
) {
  if (isMobileUserAgent()) {
    throw new Error(
      "AutoFirma desde navegador no esta disponible en moviles. Abre la app desde un ordenador con AutoFirma instalada.",
    );
  }

  updateStatus("Cargando el cliente oficial de AutoFirma...");
  await loadAutoScript();
  const autoScript = configureAutoFirmaClient();

  updateStatus("Descargando PDF para firmar...");
  const pdfResponse = await fetch(getGeneratedPdfUrl(pdfUrl), {
    cache: "no-store",
  });

  if (!pdfResponse.ok) {
    throw new Error("No se pudo descargar el PDF para firmarlo.");
  }

  const pdfBlob = await pdfResponse.blob();

  if (pdfBlob.size === 0) {
    throw new Error("El PDF esta vacio.");
  }

  updateStatus(
    "Cuando Chrome lo pida, permite abrir AutoFirma y completa la firma visible.",
  );
  const pdfB64 = await blobToBase64(pdfBlob);
  const signedPdfB64 = await withTimeout(
    signBase64WithAutoFirma(autoScript, pdfB64, signatureRubricImageB64),
    AUTOFIRMA_OPERATION_TIMEOUT_MS,
    "AutoFirma no respondio despues de 3 minutos. Cierra AutoFirma/OpenJDK desde el administrador de tareas, restaura la instalacion desde AutoFirma y vuelve a intentarlo.",
  );
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

  updateStatus("Leyendo certificado .p12/.pfx...");
  const certificateBuffer = bufferModule.Buffer.from(
    await certificateFile.arrayBuffer(),
  );
  const digitalSignatureStamp = await createDigitalSignatureStampFromP12(
    certificateBuffer,
    passphrase,
  );

  updateStatus("Descargando PDF con los datos del certificado...");
  const pdfResponse = await fetch(
    getGeneratedPdfUrl(pdfUrl, {
      digitalSignatureStamp,
      signaturePlaceholder: true,
    }),
    { cache: "no-store" },
  );

  if (!pdfResponse.ok) {
    throw new Error("No se pudo descargar el PDF para firmarlo.");
  }

  const pdfBuffer = bufferModule.Buffer.from(await pdfResponse.arrayBuffer());

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

function configureAutoFirmaClient() {
  const autoScript = window.AutoScript;

  if (!autoScript) {
    throw new Error("AutoFirma no esta disponible en esta pagina.");
  }

  const keyStore = getPreferredAutoFirmaKeyStore(autoScript);

  autoScript.AUTOFIRMA_LAUNCHING_TIME = Math.max(
    autoScript.AUTOFIRMA_LAUNCHING_TIME || 0,
    5000,
  );
  autoScript.AUTOFIRMA_CONNECTION_RETRIES = Math.max(
    autoScript.AUTOFIRMA_CONNECTION_RETRIES || 0,
    30,
  );
  autoScript.setLocale?.("es_ES");
  autoScript.setAppName?.("Duran Ginecologia");
  autoScript.setPortRange?.(54580, 54580);
  autoScript.setServiceTimeout?.(120000);
  autoScript.enableProgressDialog?.(false);
  window.SupportDialog?.enableLoadingDialog?.(false);
  window.SupportDialog?.enableErrorDialog?.(false);
  window.SupportDialog?.enableSupportDialog?.(false);
  autoScript.cargarAppAfirma(undefined, keyStore);

  if (keyStore) {
    autoScript.setKeyStore?.(keyStore);
  }

  return autoScript;
}

function signBase64WithAutoFirma(
  autoScript: AutoScriptApi,
  pdfB64: string,
  signatureRubricImageB64 = "",
) {
  return new Promise<string>((resolve, reject) => {
    autoScript.sign(
      pdfB64,
      "SHA256withRSA",
      "PAdES",
      createAutoFirmaVisibleSignatureParams(signatureRubricImageB64),
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

function createAutoFirmaVisibleSignatureParams(signatureRubricImageB64 = "") {
  const params = [
    "signaturePage=1",
    "signaturePositionOnPageLowerLeftX=155",
    "signaturePositionOnPageLowerLeftY=198",
    "signaturePositionOnPageUpperRightX=440",
    "signaturePositionOnPageUpperRightY=264",
    "layer2Text=Firmado digitalmente por $$SUBJECTCN$$\\nFecha: $$SIGNDATE=dd/MM/yyyy HH:mm:ss$$",
    "layer2FontFamily=1",
    "layer2FontSize=8",
    "layer2FontStyle=0",
    "layer2FontColor=black",
    "signReason=Firma de receta medica privada",
    "signatureProductionCity=Coria",
    "signerContact=info@duranginecologia.com",
  ];

  if (signatureRubricImageB64) {
    params.push(
      `signatureRubricImage=${signatureRubricImageB64.replace(/\s/g, "")}`,
    );
  }

  return params.join("\n");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );

    promise
      .then((value) => {
        window.clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        reject(error);
      });
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

async function createDigitalSignatureStampFromP12(
  certificateBuffer: Uint8Array,
  passphrase: string,
): Promise<DigitalSignatureStamp> {
  const forge = await loadForge();
  const asn1 = forge.asn1.fromDer(binaryStringFromBytes(certificateBuffer));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase || "");
  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] || [];
  const cert = certBags.find((bag) => bag.cert)?.cert;

  if (!cert) {
    throw new Error("El archivo .p12/.pfx no contiene un certificado legible.");
  }

  return createDigitalSignatureStampFromCertificate(cert);
}

async function loadForge() {
  const forgeModule = (await import("node-forge")) as unknown as
    | ({ default?: ForgeModule } & ForgeModule)
    | { default: ForgeModule };

  return ("default" in forgeModule && forgeModule.default
    ? forgeModule.default
    : forgeModule) as ForgeModule;
}

function createDigitalSignatureStampFromCertificate(
  cert: ForgeCertificate,
): DigitalSignatureStamp {
  const commonName = getCertificateSubjectValue(cert, [
    "CN",
    "commonName",
    "2.5.4.3",
  ]);
  const givenName = getCertificateSubjectValue(cert, ["GN", "givenName"]);
  const surname = getCertificateSubjectValue(cert, ["SN", "surname"]);
  const organization = getCertificateSubjectValue(cert, [
    "O",
    "organizationName",
    "2.5.4.10",
  ]);
  const serialNumber = getCertificateSubjectValue(cert, [
    "serialNumber",
    "2.5.4.5",
  ]);
  const signerName = cleanCertificateText(
    commonName || [givenName, surname].filter(Boolean).join(" ") || organization,
  );
  const signerId = cleanCertificateText(
    serialNumber ? `Serial: ${serialNumber}` : "",
  );

  if (!signerName) {
    throw new Error(
      "El certificado seleccionado no incluye una identidad legible.",
    );
  }

  return {
    signerName,
    signerId: signerId || undefined,
    signedAt: new Date().toISOString(),
  };
}

function getCertificateSubjectValue(
  cert: ForgeCertificate,
  aliases: string[],
) {
  const attribute = cert.subject?.attributes?.find((current) =>
    aliases.some((alias) => certificateAttributeMatches(current, alias)),
  );

  return cleanCertificateText(attribute?.value);
}

function certificateAttributeMatches(
  attribute: ForgeCertificateAttribute,
  alias: string,
) {
  const normalizedAlias = alias.toLowerCase();

  return [attribute.shortName, attribute.name, attribute.type]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === normalizedAlias);
}

function cleanCertificateText(value: unknown) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function binaryStringFromBytes(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 8192;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + chunkSize),
    );
  }

  return binary;
}

function getAutoFirmaErrorMessage(error: unknown) {
  const autoScript = window.AutoScript;
  const autoFirmaMessage = readAutoFirmaDiagnostic(() =>
    autoScript?.getErrorMessage?.(),
  );
  const autoFirmaCode = readAutoFirmaDiagnostic(() =>
    autoScript?.getErrorCode?.(),
  );
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const details = [autoFirmaCode, autoFirmaMessage || rawMessage]
    .filter(Boolean)
    .join(" ");

  return `No se pudo firmar con AutoFirma.${details ? ` ${details}` : ""}`;
}

function readAutoFirmaDiagnostic(readValue: () => string | undefined) {
  try {
    return readValue();
  } catch {
    return "";
  }
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
    reader.onerror = () => reject(new Error("No se pudo leer el PDF."));
    reader.readAsDataURL(blob);
  });
}

async function convertSignatureRubricFileToJpegBase64(file: File) {
  const isAcceptedImage =
    file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name);

  if (!isAcceptedImage) {
    throw new Error("Sube una rubrica visual en formato PNG o JPG.");
  }

  const dataUrl = await fileToDataUrl(file);
  const image = await loadImageElement(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("No se pudo leer el tamano de la rubrica visual.");
  }

  const scale = Math.min(
    MAX_SIGNATURE_RUBRIC_WIDTH / sourceWidth,
    MAX_SIGNATURE_RUBRIC_HEIGHT / sourceHeight,
    1,
  );
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("No se pudo preparar la rubrica visual.");
  }

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const [, imageB64 = ""] = canvas.toDataURL("image/jpeg", 0.88).split(",");

  if (!imageB64) {
    throw new Error("No se pudo convertir la rubrica visual a JPEG.");
  }

  return imageB64;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("No se pudo cargar la rubrica visual."));
    image.src = dataUrl;
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

function AuthGate({
  message,
  status,
}: {
  message: string;
  status: AuthStatus;
}) {
  const isLoading = status === "loading";

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">Durán Ginecología</p>
        <h1>{isLoading ? "Validando acceso" : "Acceso prohibido"}</h1>
        <p className="auth-message">
          {isLoading
            ? "Comprobando sesion..."
            : message ||
              "Esta app solo puede abrirse desde la cuenta autorizada de Duran."}
        </p>
      </section>
    </main>
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
