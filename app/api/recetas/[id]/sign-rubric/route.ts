import { NextRequest, NextResponse } from "next/server";
import { getRubricForPrescriptionSignToken } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token") || "";

  if (!token) {
    return NextResponse.json({ rubric: null }, { status: 404 });
  }

  const rubric = await getRubricForPrescriptionSignToken(id, token);

  if (!rubric) {
    return NextResponse.json({ rubric: null });
  }

  return NextResponse.json({ rubric });
}
