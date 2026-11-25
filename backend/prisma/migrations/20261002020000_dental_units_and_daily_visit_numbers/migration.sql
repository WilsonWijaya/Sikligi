CREATE TABLE "DentalUnit" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "unitNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DentalUnit_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DentalUnit" ("id", "branchId", "unitNumber", "createdAt", "updatedAt")
SELECT branch."id" || '-dental-unit-' || units.unit_number,
       branch."id",
       units.unit_number,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "Branch" AS branch
CROSS JOIN generate_series(1, 10) AS units(unit_number);

ALTER TABLE "Appointment" ADD COLUMN "dentalUnitId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "dailyVisitNumber" INTEGER NOT NULL DEFAULT 1;

WITH numbered_visits AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "branchId", "scheduledDate"
           ORDER BY "startTime" ASC, "id" ASC
         )::INTEGER AS visit_number
  FROM "Appointment"
)
UPDATE "Appointment" AS appointment
SET "dailyVisitNumber" = numbered_visits.visit_number
FROM numbered_visits
WHERE appointment."id" = numbered_visits."id";

CREATE UNIQUE INDEX "DentalUnit_branchId_unitNumber_key" ON "DentalUnit"("branchId", "unitNumber");
CREATE INDEX "DentalUnit_branchId_idx" ON "DentalUnit"("branchId");
CREATE INDEX "Appointment_branchId_dentalUnitId_scheduledDate_startTime_idx" ON "Appointment"("branchId", "dentalUnitId", "scheduledDate", "startTime");
CREATE INDEX "Appointment_branchId_scheduledDate_dailyVisitNumber_startTime_idx" ON "Appointment"("branchId", "scheduledDate", "dailyVisitNumber", "startTime");

ALTER TABLE "DentalUnit"
  ADD CONSTRAINT "DentalUnit_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_dentalUnitId_fkey"
  FOREIGN KEY ("dentalUnitId") REFERENCES "DentalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
