import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import {
  canOpenPrescriptionPdf,
  createPrescriptionSignToken,
  getPrescriptionRecord,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { errors: ["Sesion no valida o caducada."] },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const record = await getPrescriptionRecord(id);

  if (!record || record.locationId !== session.locationId) {
    return NextResponse.json(
      { errors: ["Receta no encontrada."] },
      { status: 404 },
    );
  }

  if (!canOpenPrescriptionPdf(record)) {
    return NextResponse.json(
      { errors: ["La receta esta anulada o caducada."] },
      { status: 410 },
    );
  }

  const signToken = await createPrescriptionSignToken(id, session);

  if (!signToken) {
    return NextResponse.json(
      { errors: ["No se pudo generar el token de firma."] },
      { status: 404 },
    );
  }

  return NextResponse.json(signToken);
}
