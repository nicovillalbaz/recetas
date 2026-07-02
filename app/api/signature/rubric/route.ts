import { NextRequest, NextResponse } from "next/server";
import { requireLocationSession } from "@/lib/authSession";
import {
  deleteUserRubric,
  getUserRubric,
  saveUserRubric,
} from "@/lib/prescriptionStore";

export const runtime = "nodejs";

const MAX_RUBRIC_B64_LENGTH = 2_000_000;

export async function GET(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const rubric = await getUserRubric(session);

    return NextResponse.json({ rubric });
  } catch (error) {
    return rubricError(error, "No se pudo cargar la firma visual.");
  }
}

export async function POST(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return unauthorized();
  }

  const body = (await request.json().catch(() => ({}))) as {
    fileName?: string;
    imageB64?: string;
  };
  const imageB64 = (body.imageB64 || "").replace(/\s/g, "");

  if (!imageB64 || imageB64.length > MAX_RUBRIC_B64_LENGTH) {
    return NextResponse.json(
      { errors: ["La firma visual no es valida o es demasiado grande."] },
      { status: 422 },
    );
  }

  if (!/^[a-z0-9+/=]+$/i.test(imageB64)) {
    return NextResponse.json(
      { errors: ["La firma visual debe llegar en base64."] },
      { status: 422 },
    );
  }

  try {
    const rubric = await saveUserRubric(
      session,
      body.fileName || "firma.jpg",
      imageB64,
    );

    return NextResponse.json({ rubric });
  } catch (error) {
    return rubricError(error, "No se pudo guardar la firma visual.");
  }
}

export async function DELETE(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    await deleteUserRubric(session);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return rubricError(error, "No se pudo quitar la firma visual.");
  }
}

function unauthorized() {
  return NextResponse.json(
    { errors: ["Inicia sesion para gestionar la firma."] },
    { status: 401 },
  );
}

function rubricError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : "";

  return NextResponse.json(
    { errors: [detail || fallback] },
    { status: 500 },
  );
}
