import { NextRequest, NextResponse } from "next/server";
import { buildVerificationUrl } from "@/lib/prescription";
import { createPrescriptionPdf } from "@/lib/prescriptionPdf";
import {
  canOpenPrescriptionPdf,
  getPrescriptionRecord,
} from "@/lib/prescriptionStore";

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
      { error: "Receta no encontrada o token inválido." },
      { status: 404 },
    );
  }

  if (!canOpenPrescriptionPdf(record)) {
    return NextResponse.json(
      { error: "La receta está anulada o caducada." },
      { status: 410 },
    );
  }

  const verificationUrl = buildVerificationUrl(record, getPublicOrigin(request));
  const pdf = await createPrescriptionPdf(record, verificationUrl);

  return new NextResponse(pdf.buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
