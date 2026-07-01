import { NextRequest } from "next/server";
import {
  base64UrlDecode,
  base64UrlEncode,
  safeEqual,
  signHmac,
} from "./serverCrypto";

export type GhlSessionUser = {
  userId: string;
  companyId: string;
  locationId: string;
  role: string;
  userName: string;
  email: string;
  isAgencyOwner: boolean;
};

export type GhlSession = GhlSessionUser & {
  expiresAt: string;
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createSessionToken(user: GhlSessionUser) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const payload = base64UrlEncode(JSON.stringify({ ...user, expiresAt }));
  const body = `${header}.${payload}`;
  const signature = signHmac(body);

  return {
    token: `${body}.${signature}`,
    expiresAt,
  };
}

export function verifySessionToken(token: string): GhlSession | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const expected = signHmac(`${header}.${payload}`);

  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload).toString("utf8")) as
      | GhlSession
      | undefined;

    if (!session?.userId || !session.locationId || !session.expiresAt) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const token = bearer || request.headers.get("x-duran-session") || "";

  return token ? verifySessionToken(token) : null;
}

export function requireLocationSession(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const expectedLocationId = process.env.GHL_LOCATION_ID?.trim();

  if (!session || !expectedLocationId || session.locationId !== expectedLocationId) {
    return null;
  }

  return session;
}
