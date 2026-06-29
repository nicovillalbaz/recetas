import { NextRequest, NextResponse } from "next/server";
import { buildPrescriptionPdfUrl } from "@/lib/prescription";
import { sendGhlSmsToContact, GhlConfigurationError } from "@/lib/ghl";
import {
  canOpenPrescriptionPdf,
  getPrescriptionRecord,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const record = await getPrescriptionRecord(id);

  if (!record || record.token !== body.token) {
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
      { errors: ["Esta receta no esta asociada a un contacto de GHL."] },
      { status: 422 },
    );
  }

  const pdfUrl = buildPrescriptionPdfUrl(record, getPublicOrigin(request));

  try {
    await sendGhlSmsToContact(record.contactId, buildPatientSms(pdfUrl));

    return NextResponse.json({ sent: true });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ errors: [error.message] }, { status: 503 });
    }

    const detail = error instanceof Error ? error.message : "";

    return NextResponse.json(
      {
        errors: [
          detail
            ? `No se pudo enviar el SMS desde GHL. ${detail}`
            : "No se pudo enviar el SMS desde GHL.",
        ],
      },
      { status: 502 },
    );
  }
}

function buildPatientSms(pdfUrl: string) {
  return `Hola {{contact.first_name}}, aqui tienes tu receta: ${pdfUrl}`;
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
