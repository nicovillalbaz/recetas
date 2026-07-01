import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import { GhlConfigurationError, searchGhlContacts } from "@/lib/ghl";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Inicia sesion para buscar contactos." },
      { status: 401 },
    );
  }

  const query = request.nextUrl.searchParams.get("q") || "";

  try {
    const contacts = await searchGhlContacts(query);

    return NextResponse.json({ contacts });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: "No se pudieron cargar los contactos." },
      { status: 502 },
    );
  }
}
