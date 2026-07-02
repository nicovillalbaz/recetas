import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import {
  GhlConfigurationError,
  createGhlContactNote,
  getGhlContact,
  sendGhlMessageToContact,
} from "@/lib/ghl";
import { buildPrescriptionPdfUrl } from "@/lib/prescription";
import {
  canOpenPrescriptionPdf,
  getPrescriptionRecord,
  markPrescriptionSent,
  recordPrescriptionEvent,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { errors: ["Inicia sesion para enviar recetas."] },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
  };
  const record = await getPrescriptionRecord(id);

  if (
    !record ||
    record.token !== body.token ||
    record.locationId !== session.locationId
  ) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  if (!canOpenPrescriptionPdf(record)) {
    return NextResponse.json(
      { errors: ["No se puede enviar una receta anulada o caducada."] },
      { status: 410 },
    );
  }

  if (!record.signedPdf) {
    return NextResponse.json(
      { errors: ["Firma primero el PDF antes de enviarlo al paciente."] },
      { status: 409 },
    );
  }

  if (!record.contactId) {
    return NextResponse.json(
      { errors: ["Esta receta no esta asociada a un contacto."] },
      { status: 422 },
    );
  }

  const pdfUrl = buildPrescriptionPdfUrl(record, getPublicOrigin(request));
  const patientMessage = normalizePatientMessage(
    body.message || buildPatientMessage(record, pdfUrl),
    pdfUrl,
  );

  try {
    const contact = await getGhlContact(record.contactId);

    if (!contact?.phone) {
      return NextResponse.json(
        {
          errors: [
            "El contacto no tiene telefono disponible para recibir el mensaje.",
          ],
        },
        { status: 422 },
      );
    }

    await sendGhlMessageToContact(record.contactId, patientMessage);
    const updatedRecord = await markPrescriptionSent(record.id, session);

    await createGhlContactNote(
      record.contactId,
      `Receta enviada al paciente por mensaje: ${pdfUrl}`,
    ).catch(async (error) => {
      await recordPrescriptionEvent(record.id, "ghl_note_failed", session, {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({ sent: true, record: updatedRecord || record });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ errors: [error.message] }, { status: 503 });
    }

    const detail = error instanceof Error ? error.message : "";

    return NextResponse.json(
      {
        errors: [
          detail
            ? `No se pudo enviar el mensaje. ${detail}`
            : "No se pudo enviar el mensaje.",
        ],
      },
      { status: 502 },
    );
  }
}

function buildPatientMessage(
  record: NonNullable<Awaited<ReturnType<typeof getPrescriptionRecord>>>,
  pdfUrl: string,
) {
  const firstName = record.payload.patient.name.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";

  return `${greeting} aqui tienes tu receta: ${pdfUrl}`;
}

function normalizePatientMessage(message: string, pdfUrl: string) {
  const cleanMessage = message.replace(/\s+/g, " ").trim();

  if (!cleanMessage) {
    return `Hola, aqui tienes tu receta: ${pdfUrl}`;
  }

  if (cleanMessage.includes(pdfUrl)) {
    return cleanMessage.slice(0, 1200);
  }

  return `${cleanMessage} ${pdfUrl}`.slice(0, 1200);
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
