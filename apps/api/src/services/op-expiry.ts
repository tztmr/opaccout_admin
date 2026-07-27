const SIXTY_DAYS_SECONDS = 5_184_000;

export function calculateOpExpiry(secret: string): Date {
  const separatorIndex = secret.lastIndexOf("|");
  const lastSegment = separatorIndex >= 0 ? secret.slice(separatorIndex + 1) : "";

  if (!/^\d{10}$/.test(lastSegment)) {
    throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  }

  const sourceSeconds = Number(lastSegment);
  const expiresAt = new Date((sourceSeconds + SIXTY_DAYS_SECONDS) * 1000);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("OP_SECRET_TIMESTAMP_INVALID");
  }

  return expiresAt;
}
