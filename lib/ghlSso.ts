import CryptoJS from "crypto-js";
import { type GhlSessionUser } from "./authSession";

type GhlSsoPayload = {
  userId?: string;
  companyId?: string;
  role?: string;
  type?: string;
  activeLocation?: string;
  userName?: string;
  email?: string;
  isAgencyOwner?: boolean;
};

export class GhlSsoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhlSsoError";
  }
}

export function decryptGhlUserContext(encryptedData: string): GhlSessionUser {
  const sharedSecret = process.env.GHL_APP_SHARED_SECRET?.trim();

  if (!sharedSecret) {
    throw new GhlSsoError("Configura el secreto compartido en EasyPanel.");
  }

  const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(
    CryptoJS.enc.Utf8,
  );

  if (!decrypted) {
    throw new GhlSsoError("No se pudo descifrar la sesion.");
  }

  let payload: GhlSsoPayload;

  try {
    payload = JSON.parse(decrypted) as GhlSsoPayload;
  } catch {
    throw new GhlSsoError("La sesion no tiene un formato valido.");
  }

  const locationId = payload.activeLocation || "";
  const expectedLocationId = process.env.GHL_LOCATION_ID?.trim() || "";

  if (!expectedLocationId || locationId !== expectedLocationId) {
    throw new GhlSsoError("La sesion no pertenece a la subcuenta autorizada.");
  }

  if (!payload.userId) {
    throw new GhlSsoError("La sesion no incluye usuario.");
  }

  return {
    userId: payload.userId,
    companyId: payload.companyId || "",
    locationId,
    role: payload.role || "",
    userName: payload.userName || "",
    email: payload.email || "",
    isAgencyOwner: Boolean(payload.isAgencyOwner),
  };
}
