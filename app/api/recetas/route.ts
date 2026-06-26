import { NextRequest, NextResponse } from "next/server";
import {
  buildPrescriptionPdfUrl,
  buildVerificationUrl,
  createPrescriptionRecord,
  normalizePrescriptionPayload,
  validatePrescriptionPayload,
} from "@/lib/prescription";
import { savePrescriptionRecord } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Parameters<
      typeof normalizePrescriptionPayload
    >[0];
    const payload = normalizePrescriptionPayload(body);
    const errors = validatePrescriptionPayload(payload);

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 422 });
    }

    const record = await savePrescriptionRecord(createPrescriptionRecord(payload));
    const origin = getPublicOrigin(request);

    return NextResponse.json({
      record,
      verificationUrl: buildVerificationUrl(record, origin),
      pdfUrl: buildPrescriptionPdfUrl(record, origin),
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
