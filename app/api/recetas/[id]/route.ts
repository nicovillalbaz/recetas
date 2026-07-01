import { NextRequest, NextResponse } from "next/server";
import {
  buildPrescriptionPdfUrl,
  buildVerificationUrl,
} from "@/lib/prescription";
import { getPrescriptionRecordByReadableToken } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token") || "";
  const record = await getPrescriptionRecordByReadableToken(id, token);

  if (!record) {
    return NextResponse.json(
      { errors: ["Receta no encontrada o token invalido."] },
      { status: 404 },
    );
  }

  const origin = getPublicOrigin(request);
  const responseRecord =
    record.token === token
      ? record
      : {
          ...record,
          token,
        };

  return NextResponse.json({
    record: responseRecord,
    verificationUrl: buildVerificationUrl({ id: record.id, token }, origin),
    pdfUrl: buildPrescriptionPdfUrl({ id: record.id, token }, origin),
  });
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
