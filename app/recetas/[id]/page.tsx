import Link from "next/link";
import {
  buildPrescriptionPdfUrl,
  formatDate,
  formatDateTime,
  getEffectivePrescriptionStatus,
  getPrescriptionText,
  maskDocumentId,
  maskEmail,
} from "@/lib/prescription";
import { getPrescriptionRecord } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
};

const statusCopy = {
  active: "Activa",
  cancelled: "Anulada",
  expired: "Caducada",
};

export default async function VerifyPrescriptionPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { token = "" } = await searchParams;
  const record = await getPrescriptionRecord(id);

  if (!record || record.token !== token) {
    return (
      <main className="verify-shell">
        <section className="verify-card verify-card-narrow">
          <p className="eyebrow">Durán Ginecología</p>
          <h1>Receta no verificable</h1>
          <p className="verify-muted">
            El enlace no coincide con una receta emitida o el token de
            verificación no es válido.
          </p>
        </section>
      </main>
    );
  }

  const status = getEffectivePrescriptionStatus(record);
  const pdfUrl = buildPrescriptionPdfUrl(record, getPublicOrigin());
  const isActive = status === "active";
  const prescriptionText = getPrescriptionText(record.payload.prescription);
  const prescriptionSummary = prescriptionText.split(/\r?\n/).find(Boolean);

  return (
    <main className="verify-shell">
      <section className="verify-card">
        <header className="verify-hero">
          <div>
            <p className="eyebrow">Durán Ginecología</p>
            <h1>Verificación de receta</h1>
            <p>
              Código <strong>{record.id}</strong>
            </p>
          </div>
          <span className={`status-pill ${status}`}>{statusCopy[status]}</span>
        </header>

        <section className="verify-summary">
          <div>
            <span>Paciente</span>
            <strong>{record.payload.patient.name}</strong>
            <small>{maskDocumentId(record.payload.patient.documentId)}</small>
          </div>
          <div>
            <span>Receta</span>
            <strong>{prescriptionSummary || "Receta médica"}</strong>
            <small>Contenido disponible en el PDF verificado</small>
          </div>
          <div>
            <span>Validez</span>
            <strong>{formatDate(record.expiresAt)}</strong>
            <small>Emitida {formatDateTime(record.createdAt)}</small>
          </div>
        </section>

        {!isActive && (
          <p className="verify-warning">
            Esta receta no debe dispensarse porque está{" "}
            {statusCopy[status].toLowerCase()}.
          </p>
        )}

        <dl className="verify-grid">
          <div>
            <dt>Email paciente</dt>
            <dd>{maskEmail(record.payload.patient.email) || "No informado"}</dd>
          </div>
          <div>
            <dt>Prescriptora</dt>
            <dd>{record.payload.doctor.name}</dd>
          </div>
          <div>
            <dt>N.º colegiado</dt>
            <dd>{record.payload.doctor.registration}</dd>
          </div>
          <div>
            <dt>Consulta</dt>
            <dd>{record.payload.doctor.clinicName}</dd>
          </div>
          <div>
            <dt>Dirección</dt>
            <dd>{record.payload.doctor.address}</dd>
          </div>
          <div>
            <dt>Contacto</dt>
            <dd>
              {record.payload.doctor.phone} · {record.payload.doctor.email}
            </dd>
          </div>
          <div>
            <dt>Web</dt>
            <dd>{record.payload.doctor.website}</dd>
          </div>
          <div>
            <dt>Identidad de firma</dt>
            <dd>{record.payload.doctor.signatureIdentity}</dd>
          </div>
          <div className="verify-grid-wide">
            <dt>Receta</dt>
            <dd>{prescriptionText}</dd>
          </div>
        </dl>

        <div className="verify-actions">
          {isActive && (
            <Link className="verify-button" href={pdfUrl} target="_blank">
              Abrir PDF de la receta
            </Link>
          )}
          <span>Token verificado</span>
        </div>

      </section>
    </main>
  );
}

function getPublicOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
