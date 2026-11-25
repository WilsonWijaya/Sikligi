CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Branch" ("id", "name", "createdAt", "updatedAt")
VALUES ('sikligi-main-branch', 'Sikligi Dental Care', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "Admin" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "treatment" VARCHAR(160) NOT NULL DEFAULT 'Belum dicatat';
ALTER TABLE "Appointment" ADD COLUMN "branchId" TEXT;

UPDATE "Admin" SET "branchId" = 'sikligi-main-branch';
UPDATE "Appointment" SET "branchId" = 'sikligi-main-branch';

ALTER TABLE "Admin" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Appointment" ALTER COLUMN "branchId" SET NOT NULL;

CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
CREATE INDEX "Admin_branchId_idx" ON "Admin"("branchId");
CREATE INDEX "Appointment_branchId_scheduledDate_startTime_id_idx" ON "Appointment"("branchId", "scheduledDate", "startTime", "id");
CREATE INDEX "Appointment_treatment_idx" ON "Appointment" USING GIN ("treatment" gin_trgm_ops);

ALTER TABLE "Admin"
  ADD CONSTRAINT "Admin_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
