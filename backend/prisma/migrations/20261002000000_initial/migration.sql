CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE "Admin" (
  "id" TEXT NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Appointment" (
  "id" TEXT NOT NULL,
  "patientName" VARCHAR(120) NOT NULL,
  "scheduledDate" DATE NOT NULL,
  "startTime" VARCHAR(5) NOT NULL,
  "endTime" VARCHAR(5) NOT NULL,
  "phone" VARCHAR(20),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");
CREATE INDEX "Appointment_scheduledDate_startTime_id_idx" ON "Appointment"("scheduledDate", "startTime", "id");
CREATE INDEX "Appointment_patientName_idx" ON "Appointment" USING GIN ("patientName" gin_trgm_ops);
CREATE INDEX "Appointment_phone_idx" ON "Appointment" USING GIN ("phone" gin_trgm_ops);
