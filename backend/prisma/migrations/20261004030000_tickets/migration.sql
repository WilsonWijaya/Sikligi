ALTER TABLE "Admin" ADD COLUMN "name" VARCHAR(80);

CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE TABLE "Ticket" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "reporterId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "assigneeId" TEXT,
  "resolutionNote" VARCHAR(1000),
  "resolvedAt" TIMESTAMP(3),
  "seenByReporterAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");
CREATE INDEX "Ticket_reporterId_status_idx" ON "Ticket"("reporterId", "status");
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
