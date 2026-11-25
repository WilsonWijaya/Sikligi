DROP INDEX "Appointment_branchId_scheduledDate_dailyVisitNumber_startTime_idx";
ALTER TABLE "Appointment" DROP COLUMN "dailyVisitNumber";
CREATE INDEX "Appointment_branchId_scheduledDate_startTime_idx" ON "Appointment"("branchId", "scheduledDate", "startTime");
