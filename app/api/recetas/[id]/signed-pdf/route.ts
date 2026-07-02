import { NextRequest, NextResponse } from "next/server";
import {
  getSessionFromRequest,
  requireLocationSession,
} from "@/lib/authSession";
import { createGhlContactNote } from "@/lib/ghl";
import { buildPrescriptionPdfUrl } from "@/lib/prescription";
import {
  canOpenPrescriptionPdf,
  getPrescriptionRecord,
  getPrescriptionRecordByReadableToken,
  recordPrescriptionEvent,
  saveSignedPrescriptionPdf,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

const MAX_SIGNED_PDF_BYTES = 12 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json(
      { errors: ["No se pudo leer el PDF firmado."] },
      { status: 400 },
    );
  }

  const token = String(formData.get("token") || "");
  const file = formData.get("file");
  const currentRecord = await getPrescriptionRecord(id);

  if (!currentRecord) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  const session = getSessionFromRequest(request);
  const locationSession = requireLocationSession(request);
  const isPublicRecordToken = currentRecord.token === token;

  if (session && !locationSession) {
    return NextResponse.json(
      { errors: ["Sesion no valida para esta cuenta."] },
      { status: 403 },
    );
  }

  if (locationSession && currentRecord.locationId !== locationSession.locationId) {
    return NextResponse.json(
      { errors: ["La receta no pertenece a la cuenta autorizada."] },
      { status: 403 },
    );
  }

  if (isPublicRecordToken && !locationSession) {
    return NextResponse.json(
      { errors: ["Inicia sesion para subir el PDF firmado."] },
      { status: 401 },
    );
  }

  const readableRecord = await getPrescriptionRecordByReadableToken(id, token);

  if (!readableRecord) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  if (!canOpenPrescriptionPdf(currentRecord)) {
    return NextResponse.json(
      { errors: ["La receta esta anulada o caducada."] },
      { status: 410 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { errors: ["Sube un archivo PDF firmado."] },
      { status: 422 },
    );
  }

  if (file.size > MAX_SIGNED_PDF_BYTES) {
    return NextResponse.json(
      { errors: ["El PDF firmado supera el tamano permitido."] },
      { status: 422 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return NextResponse.json(
      { errors: ["El archivo firmado debe ser un PDF valido."] },
      { status: 422 },
    );
  }

  const record = await saveSignedPrescriptionPdf(
    id,
    token,
    buffer,
    file.name,
    locationSession,
  );

  if (!record) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  if (record.contactId) {
    const pdfUrl = buildPrescriptionPdfUrl(record, getPublicOrigin(request));

    await createGhlContactNote(
      record.contactId,
      [
        `Receta medica firmada: ${record.id}`,
        `Nueva receta: ${record.payload.patient.name}`,
        `PDF firmado: ${pdfUrl}`,
      ].join("\n"),
    )
      .then(async () => {
        await recordPrescriptionEvent(record.id, "ghl_note_created", locationSession, {
          contactId: record.contactId,
          signed: true,
        });
      })
      .catch(async (error) => {
        await recordPrescriptionEvent(record.id, "ghl_note_failed", locationSession, {
          message: error instanceof Error ? error.message : String(error),
          signed: true,
        });
      });
  }

  return NextResponse.json({ record });
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
