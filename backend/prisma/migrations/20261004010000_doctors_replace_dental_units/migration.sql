CREATE TABLE "Doctor" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Doctor_branchId_name_key" ON "Doctor"("branchId", "name");
CREATE INDEX "Doctor_branchId_idx" ON "Doctor"("branchId");

ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Doctor" ("id", "branchId", "name", "isDefault", "updatedAt")
SELECT branch."id" || '-drg-andini', branch."id", 'Drg. Andini', true, CURRENT_TIMESTAMP
FROM "Branch" AS branch;

INSERT INTO "Doctor" ("id", "branchId", "name", "isDefault", "updatedAt")
SELECT branch."id" || doctors.suffix, branch."id", doctors.name, false, CURRENT_TIMESTAMP
FROM "Branch" AS branch
CROSS JOIN (VALUES ('-drg-bima', 'Drg. Bima'), ('-drg-citra', 'Drg. Citra')) AS doctors(suffix, name)
WHERE branch."id" = 'sikligi-main-branch';

ALTER TABLE "Appointment" ADD COLUMN "doctorId" TEXT;
UPDATE "Appointment" SET "doctorId" = "branchId" || '-drg-andini';
ALTER TABLE "Appointment" ALTER COLUMN "doctorId" SET NOT NULL;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "Appointment_branchId_dentalUnitId_scheduledDate_startTime_idx";
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_dentalUnitId_fkey";
ALTER TABLE "Appointment" DROP COLUMN "dentalUnitId";
DROP TABLE "DentalUnit";

CREATE INDEX "Appointment_branchId_doctorId_scheduledDate_startTime_idx" ON "Appointment"("branchId", "doctorId", "scheduledDate", "startTime");
