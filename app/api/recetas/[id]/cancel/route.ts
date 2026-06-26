import { NextRequest, NextResponse } from "next/server";
import { cancelPrescriptionRecord } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const record = await cancelPrescriptionRecord(id, body.token || "");

  if (!record) {
    return NextResponse.json(
      { error: "No se pudo anular la receta." },
      { status: 404 },
    );
  }

  return NextResponse.json({ record });
}
