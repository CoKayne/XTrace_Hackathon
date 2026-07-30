export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  fullName?: string | null;
}

export type TrustedSessionResolver = (
  request: Request,
  environment?: Record<string, string | undefined>,
) => Promise<AuthenticatedPrincipal | null>;

const OPENAI_SITES_PROVIDER = "openai_sites";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

export const resolveTrustedSession: TrustedSessionResolver = async (
  request,
  environment = process.env,
) => {
  if (
    environment.VSEE_TRUSTED_AUTH_PROVIDER?.trim() !== OPENAI_SITES_PROVIDER
  ) {
    return null;
  }

  const email = normalizeEmail(request.headers.get(USER_EMAIL_HEADER));
  if (!email) return null;

  return {
    userId: `${OPENAI_SITES_PROVIDER}:${await sha256Hex(email)}`,
    email,
    fullName: readOptionalFullName(request.headers),
  };
};

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;

  const separator = email.indexOf("@");
  if (
    separator <= 0
    || separator !== email.lastIndexOf("@")
    || separator === email.length - 1
  ) {
    return null;
  }

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (
    localPart.length > 64
    || localPart.startsWith(".")
    || localPart.endsWith(".")
    || localPart.includes("..")
    || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(localPart)
  ) {
    return null;
  }

  const domainLabels = domain.split(".");
  if (
    domain.length > 253
    || domainLabels.length < 2
    || domainLabels.some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    )
  ) {
    return null;
  }

  return email;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function readOptionalFullName(requestHeaders: Headers): string | null {
  const encodedName = requestHeaders.get(USER_FULL_NAME_HEADER);
  if (
    !encodedName
    || requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER)
      !== PERCENT_ENCODED_UTF8
  ) {
    return null;
  }

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return null;
  }
}
