import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import { listPrescriptionHistory } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { errors: ["Inicia sesion para ver el historial."] },
      { status: 401 },
    );
  }

  const params = request.nextUrl.searchParams;
  const items = await listPrescriptionHistory({
    locationId: session.locationId,
    contactId: params.get("contactId") || "",
    query: params.get("q") || "",
    status: parseFilter(params.get("status"), [
      "all",
      "active",
      "cancelled",
      "expired",
    ]),
    signed: parseFilter(params.get("signed"), ["all", "signed", "unsigned"]),
    sent: parseFilter(params.get("sent"), ["all", "sent", "unsent"]),
    limit: Number(params.get("limit") || 40),
  });

  return NextResponse.json({ items });
}

function parseFilter<const T extends string>(
  value: string | null,
  allowed: readonly T[],
) {
  return allowed.includes(value as T) ? (value as T) : allowed[0];
}
