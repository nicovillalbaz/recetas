import { NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/authSession";
import { decryptGhlUserContext, GhlSsoError } from "@/lib/ghlSso";
import { saveGhlUserSession } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    encryptedData?: string;
  };
  const encryptedData = body.encryptedData?.trim() || "";

  if (!encryptedData) {
    return NextResponse.json(
      { errors: ["No se recibio la sesion cifrada."] },
      { status: 422 },
    );
  }

  try {
    const user = decryptGhlUserContext(encryptedData);
    const sessionToken = createSessionToken(user);
    const session = {
      ...user,
      expiresAt: sessionToken.expiresAt,
    };

    await saveGhlUserSession(session);

    return NextResponse.json({
      token: sessionToken.token,
      expiresAt: sessionToken.expiresAt,
      user,
    });
  } catch (error) {
    const message =
      error instanceof GhlSsoError
        ? error.message
        : "No se pudo iniciar sesion.";

    return NextResponse.json({ errors: [message] }, { status: 401 });
  }
}
