import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import { GhlConfigurationError, getGhlContact } from "@/lib/ghl";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Inicia sesion para cargar contactos." },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const contact = await getGhlContact(id);

    if (!contact) {
      return NextResponse.json(
        { error: "Contacto no encontrado." },
        { status: 404 },
      );
    }

    return NextResponse.json({ contact });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: "No se pudo cargar el contacto." },
      { status: 502 },
    );
  }
}
