import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { errors: ["Sesion no valida o caducada."] },
      { status: 401 },
    );
  }

  return NextResponse.json({
    user: {
      userId: session.userId,
      companyId: session.companyId,
      locationId: session.locationId,
      role: session.role,
      userName: session.userName,
      email: session.email,
      isAgencyOwner: session.isAgencyOwner,
    },
    expiresAt: session.expiresAt,
  });
}
