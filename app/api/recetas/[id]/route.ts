import { NextRequest, NextResponse } from "next/server";
import {
  buildPrescriptionPdfUrl,
  buildVerificationUrl,
} from "@/lib/prescription";
import { getPrescriptionRecord } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token") || "";
  const record = await getPrescriptionRecord(id);

  if (!record || record.token !== token) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  const origin = getPublicOrigin(request);

  return NextResponse.json({
    record,
    verificationUrl: buildVerificationUrl(record, origin),
    pdfUrl: buildPrescriptionPdfUrl(record, origin),
  });
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
