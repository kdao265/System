import "server-only";

// Runtime configuration, never a NEXT_PUBLIC value or a client-supplied claim.
export function configuredOwnerId(): string | null {
  const value = process.env.SYSTEM_OWNER_USER_ID;
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function isSystemOwner(userId: string | undefined): boolean {
  const owner = configuredOwnerId();
  return owner !== null && userId?.toLowerCase() === owner;
}
