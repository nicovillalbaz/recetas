import { NextRequest, NextResponse } from "next/server";
import {
  type GhlSession,
  requireLocationSession,
} from "@/lib/authSession";
import { createGhlContactNote } from "@/lib/ghl";
import {
  buildPrescriptionPdfUrl,
  buildVerificationUrl,
  createPrescriptionRecord,
  normalizePrescriptionPayload,
  type PrescriptionRecord,
  validatePrescriptionPayload,
} from "@/lib/prescription";
import {
  recordPrescriptionEvent,
  savePrescriptionRecord,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { errors: ["Inicia sesion para crear recetas."] },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as Parameters<
      typeof normalizePrescriptionPayload
    >[0];
    const payload = normalizePrescriptionPayload(body);
    const errors = validatePrescriptionPayload(payload);

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 422 });
    }

    if (payload.locationId && payload.locationId !== session.locationId) {
      return NextResponse.json(
        { errors: ["La receta no pertenece a la cuenta autorizada."] },
        { status: 403 },
      );
    }

    const record = await savePrescriptionRecord(
      createPrescriptionRecord({
        ...payload,
        locationId: session.locationId,
      }),
      session,
    );
    const origin = getPublicOrigin(request);
    const verificationUrl = buildVerificationUrl(record, origin);
    const pdfUrl = buildPrescriptionPdfUrl(record, origin);

    if (record.contactId) {
      await createPrescriptionContactNote(
        record,
        verificationUrl,
        pdfUrl,
        session,
      ).catch(async (error) => {
        await recordPrescriptionEvent(
          record.id,
          "ghl_note_failed",
          session,
          {
            message: error instanceof Error ? error.message : String(error),
          },
        );
      });
    }

    return NextResponse.json({
      record,
      verificationUrl,
      pdfUrl,
    });
  } catch {
    return NextResponse.json(
      { errors: ["No se pudo crear la receta."] },
      { status: 400 },
    );
  }
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

async function createPrescriptionContactNote(
  record: PrescriptionRecord,
  verificationUrl: string,
  pdfUrl: string,
  session: GhlSession,
) {
  const note = [
    `Receta medica creada: ${record.id}`,
    `Nueva receta: ${record.payload.patient.name}`,
    `Verificacion: ${verificationUrl}`,
    `PDF: ${pdfUrl}`,
  ].join("\n");

  await createGhlContactNote(record.contactId, note);
  await recordPrescriptionEvent(record.id, "ghl_note_created", session, {
    contactId: record.contactId,
  });
}
