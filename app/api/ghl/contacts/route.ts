import { NextRequest, NextResponse } from "next/server";
import { GhlConfigurationError, searchGhlContacts } from "@/lib/ghl";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";

  try {
    const contacts = await searchGhlContacts(query);

    return NextResponse.json({ contacts });
  } catch (error) {
    if (error instanceof GhlConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: "No se pudieron cargar los contactos de GHL." },
      { status: 502 },
    );
  }
}
