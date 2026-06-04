import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Platform Super Admin — the single break-glass operator of the whole platform.
 *
 * Credentials live ONLY in environment variables (SUPER_ADMIN_EMAIL /
 * SUPER_ADMIN_PASSWORD); they are never stored in the database. A real `users`
 * row still exists as a foreign-key anchor for impersonation sessions and audit
 * logs, but it is created lazily on first successful login and its password
 * column holds a random, unreachable hash that can never be used to log in.
 *
 * This mirrors the proven pattern in titanium-network-suite (env source of
 * truth + lazy DB row + timing-safe compare + startup validation).
 */

const MIN_PASSWORD_LENGTH = 12;

const RAW_EMAIL = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || "";
const RAW_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "";

// --- Startup config validation: fail fast on a dangerous/half-baked setup. ---
// Both-or-neither: a half-configured super admin "looks" set up but can never
// log in, which is worse than being explicitly disabled.
if ((RAW_EMAIL === "") !== (RAW_PASSWORD === "")) {
  throw new Error(
    "[super-admin] SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set together (set both, or neither)."
  );
}
// Minimum strength for the most powerful account in the system.
if (RAW_PASSWORD !== "" && RAW_PASSWORD.length < MIN_PASSWORD_LENGTH) {
  throw new Error(
    `[super-admin] SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`
  );
}

const SUPER_ADMIN_ENABLED = RAW_EMAIL !== "" && RAW_PASSWORD !== "";

/** Case-insensitive check: does this email belong to the configured super admin? */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!SUPER_ADMIN_ENABLED || !email) return false;
  return email.trim().toLowerCase() === RAW_EMAIL;
}

/**
 * Constant-time password check. Comparing the raw strings with `===` would
 * short-circuit at the first differing character, leaking — via timing — how
 * many leading characters were correct. Hashing both sides to a fixed length
 * and using timingSafeEqual removes that signal (and avoids the length-mismatch
 * throw that timingSafeEqual raises on unequal-length buffers).
 */
export function verifySuperAdminPassword(candidate: string): boolean {
  if (!SUPER_ADMIN_ENABLED) return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(RAW_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

export interface SuperAdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Find or lazily create the super admin's DB row (the FK anchor). The password
 * column is set to a random, unreachable hash so the row can never be logged
 * into through the normal DB path.
 */
export async function findOrCreateSuperAdminUser(
  prisma: PrismaClient
): Promise<SuperAdminUser> {
  const existing = await prisma.user.findUnique({
    where: { email: RAW_EMAIL },
    select: { id: true, email: true, firstName: true, lastName: true, isSuperAdmin: true },
  });

  if (existing) {
    // Self-heal: guarantee the flag is set even if the row predates env config.
    if (!existing.isSuperAdmin) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isSuperAdmin: true },
      });
    }
    return {
      id: existing.id,
      email: existing.email,
      firstName: existing.firstName,
      lastName: existing.lastName,
    };
  }

  // Unreachable password: a hash of random bytes that we immediately discard.
  const unreachableHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  const created = await prisma.user.create({
    data: {
      email: RAW_EMAIL,
      password: unreachableHash,
      firstName: "Super",
      lastName: "Admin",
      isSuperAdmin: true,
      // Platform-level only — no salon, no tenant role.
      salonId: null,
      roleDefinitionId: null,
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  return created;
}
