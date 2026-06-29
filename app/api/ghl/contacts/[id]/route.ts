import { NextResponse } from "next/server";
import { GhlConfigurationError, getGhlContact } from "@/lib/ghl";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const contact = await getGhlContact(id);

    if (!contact) {
      return NextResponse.json(
        { error: "Contacto no encontrado en GHL." },
        { status: 404 },
      );
    }

    return NextResponse.json({ contact });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: "No se pudo cargar el contacto de GHL." },
      { status: 502 },
    );
  }
}
