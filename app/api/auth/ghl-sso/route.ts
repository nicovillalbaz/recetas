import { NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/authSession";
import type { GhlSessionUser } from "@/lib/authSession";
import { decryptGhlUserContext, GhlSsoError } from "@/lib/ghlSso";
import { saveGhlUserSession } from "@/lib/prescriptionStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      encryptedData?: string;
      locationId?: string;
      pin?: string;
    };

    const bodyLocationId = body.locationId?.trim() || "";
    const expectedLocationId =
      process.env.GHL_LOCATION_ID?.trim() ||
      process.env.NEXT_PUBLIC_GHL_LOCATION_ID?.trim() ||
      "oHE4xQTwNInUOTgcLcJJ";
    const locationId = bodyLocationId || expectedLocationId;
    const pin = body.pin?.trim() || "";
    const configuredPin = process.env.GHL_IFRAME_PIN?.trim() || "";
    const allowLocationOnlyFallback =
      process.env.GHL_ALLOW_LOCATION_ONLY_AUTH?.trim() === "1" ||
      !configuredPin;
    const encryptedData = body.encryptedData?.trim() || "";

    if (!encryptedData) {
      if (
        locationId &&
        expectedLocationId &&
        locationId === expectedLocationId &&
        (allowLocationOnlyFallback ||
          !configuredPin ||
          configuredPin === pin)
      ) {
        const fallbackUser: GhlSessionUser = {
          userId: `iframe-${locationId}`,
          companyId: "",
          locationId,
          role: "iframe",
          userName: "Usuario del iframe",
          email: "",
          isAgencyOwner: false,
        };

        const sessionToken = createSessionToken(fallbackUser);
        const session = {
          ...fallbackUser,
          expiresAt: sessionToken.expiresAt,
        };

        try {
          await saveGhlUserSession(session);
        } catch (error) {
          console.error("[ghl-sso] no se pudo guardar session de usuario:", error);
        }

        return NextResponse.json({
          token: sessionToken.token,
          expiresAt: sessionToken.expiresAt,
          user: fallbackUser,
        });
      }

      if (configuredPin && !allowLocationOnlyFallback) {
        return NextResponse.json(
          { errors: ["No se recibio la sesion cifrada o el pin de acceso no coincide."] },
          { status: 422 },
        );
      }

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

      try {
        await saveGhlUserSession(session);
      } catch (error) {
        console.error("[ghl-sso] no se pudo guardar session de usuario:", error);
      }

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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo iniciar sesion.";

    console.error("[ghl-sso] auth error:", error);

    return NextResponse.json({ errors: [message] }, { status: 500 });
  }
}
