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

  const rubric = await getUserRubric(session);

  return NextResponse.json({ rubric });
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
      { errors: ["La rubrica visual no es valida o es demasiado grande."] },
      { status: 422 },
    );
  }

  if (!/^[a-z0-9+/=]+$/i.test(imageB64)) {
    return NextResponse.json(
      { errors: ["La rubrica visual debe llegar en base64."] },
      { status: 422 },
    );
  }

  const rubric = await saveUserRubric(
    session,
    body.fileName || "rubrica.jpg",
    imageB64,
  );

  return NextResponse.json({ rubric });
}

export async function DELETE(request: NextRequest) {
  const session = requireLocationSession(request);

  if (!session) {
    return unauthorized();
  }

  await deleteUserRubric(session);

  return NextResponse.json({ deleted: true });
}

function unauthorized() {
  return NextResponse.json(
    { errors: ["Inicia sesion para gestionar la rubrica."] },
    { status: 401 },
  );
}
