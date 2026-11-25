CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED');

ALTER TABLE "Appointment" ADD COLUMN "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "Appointment_status_scheduledDate_idx" ON "Appointment"("status", "scheduledDate");
