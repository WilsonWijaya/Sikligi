ALTER TABLE "Admin" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedLoginResetAt" TIMESTAMP(3);

CREATE TABLE "RevokedSession" (
  "id" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
