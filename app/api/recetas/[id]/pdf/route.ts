import { NextRequest, NextResponse } from "next/server";
import {
  type DigitalSignatureStamp,
  buildVerificationUrl,
} from "@/lib/prescription";
import { createPrescriptionPdf } from "@/lib/prescriptionPdf";
import {
  canOpenPrescriptionPdf,
  getPrescriptionRecord,
  getSignedPrescriptionPdf,
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
  const version = request.nextUrl.searchParams.get("version");
  const signaturePlaceholder =
    request.nextUrl.searchParams.get("signaturePlaceholder") === "browser";
  const digitalSignatureStamp = readDigitalSignatureStamp(
    request.nextUrl.searchParams,
  );
  const signedPdf =
    version === "generated" ? null : await getSignedPrescriptionPdf(record);

  if (signedPdf) {
    return new NextResponse(signedPdf.buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${signedPdf.fileName}"`,
        "Cache-Control": "no-store",
        "X-Prescription-Pdf-Version": "signed",
      },
    });
  }

  const pdf = await createPrescriptionPdf(record, verificationUrl, {
    signaturePlaceholder,
    digitalSignatureStamp,
  });

  return new NextResponse(pdf.buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Cache-Control": "no-store",
      "X-Prescription-Pdf-Version": "generated",
      "X-Prescription-Pdf-Signature-Placeholder": signaturePlaceholder
        ? "browser"
        : "none",
    },
  });
}

function getPublicOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

function readDigitalSignatureStamp(
  searchParams: URLSearchParams,
): DigitalSignatureStamp | undefined {
  const signerName = cleanSignatureQueryValue(searchParams.get("signerName"));
  const signerId = cleanSignatureQueryValue(searchParams.get("signerId"));
  const signedAt = cleanSignatureQueryValue(searchParams.get("signedAt"));

  if (!signerName || !signedAt || Number.isNaN(new Date(signedAt).getTime())) {
    return undefined;
  }

  return {
    signerName,
    signerId,
    signedAt,
  };
}

function cleanSignatureQueryValue(value: string | null) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}
