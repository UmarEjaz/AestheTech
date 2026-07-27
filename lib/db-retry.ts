import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Run a database transaction at the strictest ("Serializable") isolation level, so two
 * requests that read-then-write the same rows at the same instant can't both succeed with
 * stale reads (prevents write-skew, e.g. two deposits both fitting under the same balance).
 *
 * Serializable transactions can legitimately fail with a write-conflict/deadlock (Prisma
 * error P2034); that just means "someone else got there first — try again". We retry a few
 * times before giving up.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        lastError = error;
        continue; // retryable serialization conflict
      }
      throw error;
    }
  }
  throw lastError;
}
