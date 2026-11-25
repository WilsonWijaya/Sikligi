import { prisma } from "@/lib/db";

type AttemptWindow = { count: number; resetAt: number };

const attempts = new Map<string, AttemptWindow>();
const maxAttempts = 8;
const windowMs = 15 * 60 * 1000;

export function isLoginBlocked(key: string) {
  const now = Date.now();
  const window = attempts.get(key);
  if (!window || window.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + windowMs });
    return false;
  }
  return window.count >= maxAttempts;
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const window = attempts.get(key);
  if (!window || window.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    window.count += 1;
  }

  if (attempts.size > 5000) {
    for (const [attemptKey, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(attemptKey);
    }
  }
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}

export function isAccountLocked(admin: { failedLoginCount: number; failedLoginResetAt: Date | null }) {
  return admin.failedLoginCount >= maxAttempts && admin.failedLoginResetAt !== null && admin.failedLoginResetAt > new Date();
}

export async function recordAccountFailure(adminId: string) {
  const now = new Date();
  const resetAt = new Date(now.valueOf() + windowMs);
  await prisma.$executeRaw`UPDATE "Admin" SET
    "failedLoginCount" = CASE WHEN "failedLoginResetAt" IS NULL OR "failedLoginResetAt" <= ${now} THEN 1 ELSE "failedLoginCount" + 1 END,
    "failedLoginResetAt" = CASE WHEN "failedLoginResetAt" IS NULL OR "failedLoginResetAt" <= ${now} THEN ${resetAt} ELSE "failedLoginResetAt" END
    WHERE "id" = ${adminId}`;
}

export async function clearAccountFailures(adminId: string) {
  await prisma.admin.update({ where: { id: adminId }, data: { failedLoginCount: 0, failedLoginResetAt: null } });
}
