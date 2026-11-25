CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'OWNER');

ALTER TABLE "Admin" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';

ALTER TABLE "Appointment" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "purgedAt" TIMESTAMP(3);

CREATE INDEX "Appointment_deletedAt_idx" ON "Appointment"("deletedAt");
