import { compare } from "bcryptjs";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { z } from "zod";
import { ApiError, apiResponse, assertSameOrigin, fileResponse, preflightResponse, readJson } from "@/lib/http";
import { clearAccountFailures, clearLoginFailures, isAccountLocked, isLoginBlocked, recordAccountFailure, recordLoginFailure } from "@/lib/login-limit";
import { prisma } from "@/lib/db";
import { clearSessionCookie, createSessionCookie, getAdminSession, refreshSessionCookie, revokeSession } from "@/lib/session";
import { deleteTicketImage, fetchTicketImage, uploadTicketImage } from "@/lib/cloudinary";
import { ticketImageErrorPage } from "@/lib/image-error-page";
import { appointmentInput, bulkDeleteInput, dashboardRange, loginInput, preferencesInput, statusInput, ticketInput, ticketUpdateInput } from "@/lib/validation";

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

type SchedulingScope = { date: string; doctorId: string };

function dateValue(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function lockSchedulingScopes(transaction: Prisma.TransactionClient, branchId: string, scopes: SchedulingScope[]) {
  const lockKeys = new Set<string>();
  for (const scope of scopes) {
    lockKeys.add(`${branchId}:day:${scope.date}`);
    lockKeys.add(`${branchId}:doctor:${scope.doctorId}:${scope.date}`);
  }
  for (const key of [...lockKeys].sort()) {
    await transaction.$queryRaw`WITH advisory_lock AS (
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
    )
    SELECT 1::INTEGER AS locked FROM advisory_lock`;
  }
}

async function doctorFor(transaction: Prisma.TransactionClient, branchId: string, doctorId: string | null) {
  const doctor = await transaction.doctor.findFirst({
    where: doctorId ? { id: doctorId, branchId } : { branchId, isDefault: true },
    select: { id: true },
  });
  if (!doctor) throw new ApiError(409, doctorId ? "Dokter tidak tersedia untuk klinik ini." : "Klinik ini belum memiliki dokter.");
  return doctor.id;
}

async function assertSlotAvailable(
  transaction: Prisma.TransactionClient,
  branchId: string,
  scheduledDate: Date,
  doctorId: string,
  startTime: string,
  endTime: string,
  excludeId?: string,
) {
  const conflict = await transaction.appointment.findFirst({
    where: {
      branchId,
      scheduledDate,
      doctorId,
      deletedAt: null,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) throw new ApiError(409, "Jadwal bentrok dengan pasien lain pada dokter dan tanggal tersebut.");
}

function appointmentData(input: z.infer<typeof appointmentInput>, branchId: string, doctorId: string) {
  return {
    patientName: input.patientName,
    treatment: input.treatment,
    scheduledDate: dateValue(input.scheduledDate),
    startTime: input.startTime,
    endTime: input.endTime,
    phone: input.phone,
    branchId,
    doctorId,
  };
}

function formatAppointment(appointment: {
  id: string;
  patientName: string;
  treatment: string;
  scheduledDate: Date;
  startTime: string;
  endTime: string;
  phone: string | null;
  status: string;
  doctorId: string;
  doctor: { name: string };
  branch?: { name: string };
  createdAt: Date;
}) {
  const { doctor, branch, ...data } = appointment;
  return {
    ...data,
    branchName: branch?.name ?? null,
    doctorName: doctor.name,
    scheduledDate: appointment.scheduledDate.toISOString().slice(0, 10),
  };
}

async function appointmentsWorkbook(rows: Parameters<typeof formatAppointment>[0][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Jadwal Pasien", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "No", key: "number", width: 6 },
    { header: "Nama Pasien", key: "patientName", width: 32 },
    { header: "Nomor Telepon", key: "phone", width: 18 },
    { header: "Perawatan / Tindakan", key: "treatment", width: 36 },
    { header: "Tanggal Kedatangan", key: "scheduledDate", width: 20, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Jam Mulai", key: "startTime", width: 12 },
    { header: "Jam Selesai", key: "endTime", width: 12 },
    { header: "Dokter", key: "doctorName", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Klinik", key: "branchName", width: 28 },
  ];
  rows.forEach((row, index) => {
    sheet.addRow({
      number: index + 1,
      patientName: row.patientName,
      phone: row.phone ?? "-",
      treatment: row.treatment,
      scheduledDate: row.scheduledDate,
      startTime: row.startTime,
      endTime: row.endTime,
      doctorName: row.doctor.name,
      status: row.status === "COMPLETED" ? "Selesai" : "Terjadwal",
      branchName: row.branch?.name ?? "-",
    });
  });
  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B6BDB" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  for (const key of ["number", "scheduledDate", "startTime", "endTime", "doctorName", "status"]) {
    sheet.getColumn(key).alignment = { horizontal: "center" };
  }
  header.alignment = { vertical: "middle", horizontal: "center" };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

const appointmentInclude = {
  doctor: { select: { name: true } },
  branch: { select: { name: true } },
} satisfies Prisma.AppointmentInclude;

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function addDays(date: string, days: number) {
  return dateKey(new Date(dateValue(date).valueOf() + days * 86_400_000));
}

async function readScheduledAppointment(id: string, branchId: string) {
  return prisma.appointment.findFirst({
    where: { id, branchId, deletedAt: null },
  });
}

function adminPayload(admin: { email: string; name: string | null; darkMode: boolean; role: string; branch: { name: string } }) {
  return { email: admin.email, name: admin.name, branchName: admin.branch.name, darkMode: admin.darkMode, role: admin.role };
}

const ticketInclude = {
  reporter: { select: { role: true } },
  assignee: { select: { name: true, email: true } },
  branch: { select: { name: true } },
} satisfies Prisma.TicketInclude;

function ticketImageName(number: number, position: number) {
  return `Tiket-TT${String(number).padStart(3, "0")}-Gambar-${position}`;
}

function formatTicket(ticket: Prisma.TicketGetPayload<{ include: typeof ticketInclude }>) {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    description: ticket.description,
    imageUrls: ticket.imageUrls.map((_, index) => `/${ticketImageName(ticket.number, index + 1)}`),
    status: ticket.status,
    resolutionNote: ticket.resolutionNote,
    createdAt: ticket.createdAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    seen: Boolean(ticket.seenByReporterAt),
    reporterRole: ticket.reporter.role,
    branchName: ticket.branch.name,
    assigneeName: ticket.assignee ? ticket.assignee.name ?? ticket.assignee.email : null,
  };
}

async function dispatch(request: Request, segments: string[]) {
  const [resource, id] = segments;

  if (resource === "auth" && segments[1] === "login" && request.method === "POST") {
    assertSameOrigin(request);
    const input = loginInput.parse(await readJson(request));
    const key = `${clientKey(request)}|${input.email}`;
    if (isLoginBlocked(key)) throw new ApiError(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");

    const admin = await prisma.admin.findUnique({
      where: { email: input.email },
      include: { branch: { select: { name: true } } },
    });
    if (admin && isAccountLocked(admin)) throw new ApiError(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
    if (!admin || !(await compare(input.password, admin.passwordHash))) {
      recordLoginFailure(key);
      if (admin) await recordAccountFailure(admin.id);
      throw new ApiError(401, "Email atau kata sandi tidak sesuai");
    }

    clearLoginFailures(key);
    if (admin.failedLoginCount > 0) await clearAccountFailures(admin.id);
    return apiResponse(request, { admin: adminPayload(admin) }, 200, {
      "Set-Cookie": createSessionCookie(admin.id, admin.sessionVersion),
      "Cache-Control": "no-store",
    });
  }

  if (resource === "auth" && segments[1] === "session" && request.method === "GET") {
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    return apiResponse(request, { admin: adminPayload(admin) }, 200, { "Cache-Control": "no-store" });
  }

  if (resource === "auth" && segments[1] === "preferences" && request.method === "PATCH") {
    assertSameOrigin(request);
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    const input = preferencesInput.parse(await readJson(request));
    await prisma.admin.update({ where: { id: admin.id }, data: { darkMode: input.darkMode } });
    return apiResponse(request, { darkMode: input.darkMode });
  }

  if (resource === "auth" && segments[1] === "session" && request.method === "DELETE") {
    assertSameOrigin(request);
    await revokeSession(request);
    return apiResponse(request, { success: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (resource === "appointments") {
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    const readOnly = admin.role === "OWNER" || admin.role === "DEVELOPER";
    if (readOnly && request.method !== "GET") throw new ApiError(403, "Akun ini hanya dapat melihat jadwal.");

    if (id === "doctors" && request.method === "GET") {
      const doctors = await prisma.doctor.findMany({
        where: readOnly ? {} : { branchId: admin.branchId },
        select: { id: true, name: true, isDefault: true, branchId: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return apiResponse(request, { doctors });
    }

    if (id === "availability" && request.method === "GET") {
      const url = new URL(request.url);
      const date = url.searchParams.get("date") ?? "";
      const scheduledDate = dateValue(date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(scheduledDate.valueOf()) || dateKey(scheduledDate) !== date) {
        throw new ApiError(400, "Tanggal untuk memeriksa ketersediaan tidak valid.");
      }
      const excludeId = url.searchParams.get("excludeId") ?? undefined;
      const busySlots = await prisma.$transaction(async (transaction) => {
        const doctorId = await doctorFor(transaction, admin.branchId, url.searchParams.get("doctorId")?.trim() || null);
        return transaction.appointment.findMany({
          where: {
            branchId: admin.branchId,
            scheduledDate,
            doctorId,
            deletedAt: null,
            ...(excludeId ? { id: { not: excludeId } } : {}),
          },
          select: { startTime: true, endTime: true },
          orderBy: { startTime: "asc" },
        });
      });
      return apiResponse(request, { busySlots });
    }

    if ((!id || id === "export") && request.method === "GET") {
      const url = new URL(request.url);
      const search = url.searchParams.get("q")?.trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
      const date = url.searchParams.get("date");
      if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateValue(date).valueOf()) || dateKey(dateValue(date)) !== date)) {
        throw new ApiError(400, "Tanggal untuk menyaring jadwal tidak valid.");
      }
      const doctorName = url.searchParams.get("doctor")?.trim().slice(0, 80);
      const branchParam = url.searchParams.get("branchId")?.trim();
      const where: Prisma.AppointmentWhereInput = {
        branchId: readOnly ? branchParam || undefined : admin.branchId,
        ...(readOnly ? { AND: [{ OR: [{ deletedAt: null }, { status: "COMPLETED" }] }] } : { deletedAt: null }),
        ...(date ? { scheduledDate: dateValue(date) } : {}),
        ...(doctorName ? { doctor: { name: doctorName } } : {}),
        ...(search ? {
          OR: [
            { patientName: { contains: search, mode: "insensitive" } },
            { treatment: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
          ],
        } : {}),
      };

      if (id === "export") {
        const rows = await prisma.appointment.findMany({
          where,
          orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
          include: appointmentInclude,
        });
        return fileResponse(request, await appointmentsWorkbook(rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      }

      const total = await prisma.appointment.count({ where });
      const totalPages = Math.max(Math.ceil(total / limit), 1);
      const page = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("page") ?? 1)) || 1, 1), totalPages);
      const rows = await prisma.appointment.findMany({
        where,
        orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: appointmentInclude,
      });
      return apiResponse(request, {
        appointments: rows.map(formatAppointment),
        page,
        pageSize: limit,
        total,
        totalPages,
      });
    }

    if (id && segments[2] === "status" && request.method === "PATCH") {
      assertSameOrigin(request);
      const input = statusInput.parse(await readJson(request));
      const existing = await readScheduledAppointment(id, admin.branchId);
      if (!existing) throw new ApiError(404, "Jadwal tidak ditemukan");
      if (existing.status === "COMPLETED") throw new ApiError(409, "Jadwal yang sudah selesai tidak dapat diubah lagi.");
      if (input.status === "COMPLETED" && dateKey(existing.scheduledDate) > todayKey()) {
        throw new ApiError(409, "Jadwal yang belum tiba tanggalnya tidak dapat ditandai selesai.");
      }
      await prisma.appointment.updateMany({
        where: { id, branchId: admin.branchId, deletedAt: null },
        data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null },
      });
      return apiResponse(request, { status: input.status });
    }

    if (id === "bulk-delete" && request.method === "POST") {
      assertSameOrigin(request);
      const input = bulkDeleteInput.parse(await readJson(request));
      const scope = { id: { in: [...new Set(input.ids)] }, branchId: admin.branchId, deletedAt: null };
      const [removed, archived] = await prisma.$transaction([
        prisma.appointment.deleteMany({ where: { ...scope, status: "SCHEDULED" } }),
        prisma.appointment.updateMany({ where: { ...scope, status: "COMPLETED" }, data: { deletedAt: new Date() } }),
      ]);
      return apiResponse(request, { deleted: removed.count, archived: archived.count });
    }

    if (!id && request.method === "POST") {
      assertSameOrigin(request);
      const input = appointmentInput.parse(await readJson(request));
      const scheduledDate = dateValue(input.scheduledDate);
      const appointment = await prisma.$transaction(async (transaction) => {
        const doctorId = await doctorFor(transaction, admin.branchId, input.doctorId);
        await lockSchedulingScopes(transaction, admin.branchId, [{ date: input.scheduledDate, doctorId }]);
        await assertSlotAvailable(transaction, admin.branchId, scheduledDate, doctorId, input.startTime, input.endTime);
        const created = await transaction.appointment.create({
          data: appointmentData(input, admin.branchId, doctorId),
        });
        return transaction.appointment.findUniqueOrThrow({ where: { id: created.id }, include: appointmentInclude });
      });
      return apiResponse(request, { appointment: formatAppointment(appointment) }, 201);
    }

    if (id && !segments[2] && (request.method === "PUT" || request.method === "PATCH")) {
      assertSameOrigin(request);
      const input = appointmentInput.parse(await readJson(request));
      const existing = await readScheduledAppointment(id, admin.branchId);
      if (!existing) throw new ApiError(404, "Jadwal tidak ditemukan");

      const previousDate = dateKey(existing.scheduledDate);
      const previousDoctorId = existing.doctorId;
      const nextDate = input.scheduledDate;
      const appointment = await prisma.$transaction(async (transaction) => {
        const doctorId = await doctorFor(transaction, admin.branchId, input.doctorId);
        await lockSchedulingScopes(transaction, admin.branchId, [
          { date: previousDate, doctorId: previousDoctorId },
          { date: nextDate, doctorId },
        ]);
        const current = await transaction.appointment.findFirst({
          where: { id, branchId: admin.branchId, deletedAt: null },
          include: appointmentInclude,
        });
        if (!current) throw new ApiError(404, "Jadwal tidak ditemukan");
        if (dateKey(current.scheduledDate) !== previousDate || current.doctorId !== previousDoctorId) {
          throw new ApiError(409, "Jadwal baru saja diubah. Muat ulang daftar, lalu coba lagi.");
        }
        if (current.status === "COMPLETED") throw new ApiError(409, "Jadwal yang sudah selesai tidak dapat diubah.");

        const scheduledDate = dateValue(input.scheduledDate);
        await assertSlotAvailable(transaction, admin.branchId, scheduledDate, doctorId, input.startTime, input.endTime, id);
        await transaction.appointment.update({
          where: { id, branchId: admin.branchId },
          data: appointmentData(input, admin.branchId, doctorId),
        });
        return transaction.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
      });
      return apiResponse(request, { appointment: formatAppointment(appointment) });
    }

    if (id && request.method === "DELETE") {
      assertSameOrigin(request);
      const existing = await readScheduledAppointment(id, admin.branchId);
      if (!existing) throw new ApiError(404, "Jadwal tidak ditemukan");
      const scheduledDate = dateKey(existing.scheduledDate);
      const doctorId = existing.doctorId;
      const archived = await prisma.$transaction(async (transaction) => {
        await lockSchedulingScopes(transaction, admin.branchId, [{ date: scheduledDate, doctorId }]);
        const current = await transaction.appointment.findFirst({
          where: { id, branchId: admin.branchId, deletedAt: null },
          include: appointmentInclude,
        });
        if (!current) throw new ApiError(404, "Jadwal tidak ditemukan");
        if (dateKey(current.scheduledDate) !== scheduledDate || current.doctorId !== doctorId) {
          throw new ApiError(409, "Jadwal baru saja diubah. Muat ulang daftar, lalu coba lagi.");
        }
        const removed = await transaction.appointment.deleteMany({ where: { id, branchId: admin.branchId, status: "SCHEDULED" } });
        if (removed.count > 0) return false;
        await transaction.appointment.updateMany({ where: { id, branchId: admin.branchId, status: "COMPLETED" }, data: { deletedAt: new Date() } });
        return true;
      });
      return apiResponse(request, { success: true, archived });
    }
  }

  if (resource === "dashboard") {
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    if (admin.role !== "OWNER" && admin.role !== "DEVELOPER") throw new ApiError(403, "Dashboard khusus untuk owner klinik.");

    if (id === "branches" && request.method === "GET") {
      const branches = await prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
      return apiResponse(request, { branches });
    }

    const url = new URL(request.url);
    const range = dashboardRange.parse(request.method === "POST"
      ? await readJson(request)
      : { from: url.searchParams.get("from"), to: url.searchParams.get("to"), branchId: url.searchParams.get("branchId") });
    const branchFilter = range.branchId ? { branchId: range.branchId } : {};
    const inRange = (from: string, to: string) => ({ scheduledDate: { gte: dateValue(from), lte: dateValue(to) }, ...branchFilter });

    if (!id && request.method === "GET") {
      const days = Math.round((dateValue(range.to).valueOf() - dateValue(range.from).valueOf()) / 86_400_000) + 1;
      const completed = { ...inRange(range.from, range.to), status: "COMPLETED" } satisfies Prisma.AppointmentWhereInput;
      const [byDate, byBranch, previousTotal, branches] = await Promise.all([
        prisma.appointment.groupBy({ by: ["scheduledDate"], where: completed, _count: { _all: true } }),
        prisma.appointment.groupBy({ by: ["branchId"], where: completed, _count: { _all: true } }),
        prisma.appointment.count({ where: { ...inRange(addDays(range.from, -days), addDays(range.from, -1)), status: "COMPLETED" } }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ]);

      const granularity = days <= 62 ? "day" : "month";
      const counts = new Map<string, number>();
      for (const row of byDate) {
        const key = granularity === "day" ? dateKey(row.scheduledDate) : dateKey(row.scheduledDate).slice(0, 7);
        counts.set(key, (counts.get(key) ?? 0) + row._count._all);
      }
      const series: { period: string; total: number }[] = [];
      if (granularity === "day") {
        for (let date = range.from; date <= range.to; date = addDays(date, 1)) series.push({ period: date, total: counts.get(date) ?? 0 });
      } else {
        let [year, month] = range.from.split("-").map(Number);
        const end = range.to.slice(0, 7);
        for (let period = range.from.slice(0, 7); period <= end;) {
          series.push({ period, total: counts.get(period) ?? 0 });
          month += 1;
          if (month > 12) { month = 1; year += 1; }
          period = `${year}-${String(month).padStart(2, "0")}`;
        }
      }

      const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
      return apiResponse(request, {
        granularity,
        days,
        total: series.reduce((sum, point) => sum + point.total, 0),
        previousTotal,
        series,
        byBranch: byBranch
          .map((row) => ({ branchId: row.branchId, branchName: branchNames.get(row.branchId) ?? "-", total: row._count._all }))
          .sort((a, b) => b.total - a.total),
      });
    }

    if (id === "purge" && (request.method === "GET" || request.method === "POST")) {
      if (admin.role !== "OWNER") throw new ApiError(403, "Hanya owner yang dapat menghapus data periode.");
      if (range.to >= todayKey()) throw new ApiError(400, "Hanya data sebelum hari ini yang dapat dihapus permanen.");
      const where = { ...inRange(range.from, range.to), status: "COMPLETED" } satisfies Prisma.AppointmentWhereInput;
      if (request.method === "GET") {
        return apiResponse(request, { completed: await prisma.appointment.count({ where }) });
      }
      assertSameOrigin(request);
      const result = await prisma.appointment.deleteMany({ where });
      return apiResponse(request, { deleted: result.count });
    }
  }

  if (resource === "tickets") {
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    const isDeveloper = admin.role === "DEVELOPER";

    if (id === "notifications") {
      const resolved = { reporterId: admin.id, status: "RESOLVED" } satisfies Prisma.TicketWhereInput;
      if (!segments[2] && request.method === "GET") {
        const [tickets, unread] = await Promise.all([
          prisma.ticket.findMany({ where: resolved, orderBy: { resolvedAt: "desc" }, take: 30, include: ticketInclude }),
          prisma.ticket.count({ where: { ...resolved, seenByReporterAt: null } }),
        ]);
        return apiResponse(request, { tickets: tickets.map(formatTicket), unread });
      }
      if (segments[2] === "read" && request.method === "POST") {
        assertSameOrigin(request);
        await prisma.ticket.updateMany({ where: { ...resolved, seenByReporterAt: null }, data: { seenByReporterAt: new Date() } });
        return apiResponse(request, { success: true });
      }
    }

    if (id === "image" && request.method === "GET") {
      const name = /^Tiket-TT(\d{1,9})-Gambar-([1-9])$/.exec(segments[2] ?? "");
      if (!name || segments[3]) throw new ApiError(404, "Gambar tidak ditemukan");
      const number = Number(name[1]);
      const position = Number(name[2]);
      const ticket = await prisma.ticket.findFirst({ where: isDeveloper ? { number } : { number, reporterId: admin.id }, select: { number: true, imageUrls: true } });
      const stored = ticket?.imageUrls[position - 1];
      if (!ticket || !stored) throw new ApiError(404, "Gambar tidak ditemukan");
      const image = await fetchTicketImage(stored);
      const filename = `${ticketImageName(ticket.number, position)}.${image.extension}`;
      return new Response(image.bytes, {
        headers: { "Content-Type": image.contentType, "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" },
      });
    }

    if (!id && request.method === "GET") {
      const url = new URL(request.url);
      const statusParam = url.searchParams.get("status");
      const status = statusParam === "OPEN" || statusParam === "IN_PROGRESS" || statusParam === "RESOLVED" ? statusParam : null;
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 50);
      const where: Prisma.TicketWhereInput = {
        ...(isDeveloper ? {} : { reporterId: admin.id }),
        ...(status ? { status } : {}),
      };
      const total = await prisma.ticket.count({ where });
      const totalPages = Math.max(Math.ceil(total / limit), 1);
      const page = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("page") ?? 1)) || 1, 1), totalPages);
      const tickets = await prisma.ticket.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: ticketInclude,
      });
      return apiResponse(request, { tickets: tickets.map(formatTicket), page, pageSize: limit, total, totalPages });
    }

    if (!id && request.method === "POST") {
      assertSameOrigin(request);
      if (isDeveloper) throw new ApiError(403, "Akun tim IT tidak membuat tiket.");
      const input = ticketInput.parse(await readJson(request));
      const imageUrls: string[] = [];
      try {
        for (const image of input.images) imageUrls.push(await uploadTicketImage(image));
      } catch (error) {
        await Promise.all(imageUrls.map(deleteTicketImage));
        throw error;
      }
      const ticket = await prisma.ticket.create({
        data: { title: input.title, description: input.description, imageUrls, reporterId: admin.id, branchId: admin.branchId },
        include: ticketInclude,
      });
      return apiResponse(request, { ticket: formatTicket(ticket) }, 201);
    }

    if (id && !segments[2] && request.method === "PATCH") {
      assertSameOrigin(request);
      if (!isDeveloper) throw new ApiError(403, "Hanya tim IT yang dapat mengubah status tiket.");
      const input = ticketUpdateInput.parse(await readJson(request));
      const existing = await prisma.ticket.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new ApiError(404, "Tiket tidak ditemukan");
      if (existing.status === "RESOLVED") throw new ApiError(409, "Tiket yang sudah selesai tidak dapat diubah lagi.");
      const ticket = await prisma.ticket.update({
        where: { id },
        data: input.status === "RESOLVED"
          ? { status: "RESOLVED", assigneeId: admin.id, resolutionNote: input.resolutionNote, resolvedAt: new Date(), seenByReporterAt: null }
          : { status: "IN_PROGRESS", assigneeId: admin.id, resolvedAt: null, seenByReporterAt: null },
        include: ticketInclude,
      });
      return apiResponse(request, { ticket: formatTicket(ticket) });
    }
  }

  if (resource === "tickets" && id && !segments[2] && request.method === "DELETE") {
    assertSameOrigin(request);
    const admin = await getAdminSession(request);
    if (!admin) throw new ApiError(401, "Sesi admin tidak ditemukan");
    const isDeveloper = admin.role === "DEVELOPER";
    const scope: Prisma.TicketWhereInput = isDeveloper
      ? { id, status: "RESOLVED" }
      : { id, reporterId: admin.id, status: "OPEN" };
    const ticket = await prisma.ticket.findFirst({ where: isDeveloper ? { id } : { id, reporterId: admin.id }, select: { imageUrls: true } });
    if (!ticket) throw new ApiError(404, "Tiket tidak ditemukan");
    const removed = await prisma.ticket.deleteMany({ where: scope });
    if (removed.count === 0) {
      throw new ApiError(409, isDeveloper
        ? "Hanya tiket yang sudah selesai yang dapat dihapus."
        : "Tiket yang sudah dikerjakan tim IT tidak dapat dibatalkan.");
    }
    await Promise.all(ticket.imageUrls.map(deleteTicketImage));
    return apiResponse(request, { success: true });
  }

  throw new ApiError(404, "Endpoint tidak ditemukan");
}

async function handle(request: Request, context: { params: Promise<{ segments?: string[] }> }) {
  const segments = (await context.params).segments ?? [];
  const isTicketImage = request.method === "GET" && segments[0] === "tickets" && segments[1] === "image";
  try {
    const response = await dispatch(request, segments);
    if (response.ok && !response.headers.has("Set-Cookie")) {
      const refreshed = refreshSessionCookie(request);
      if (refreshed) response.headers.append("Set-Cookie", refreshed);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      if (!isTicketImage) return apiResponse(request, { error: error.message }, error.status);
      const viewer = error.status === 401 ? null : await getAdminSession(request);
      return ticketImageErrorPage(error.status, viewer?.branch.name);
    }
    if (error instanceof z.ZodError) {
      return apiResponse(request, { error: error.issues[0]?.message ?? "Data tidak valid" }, 400);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return apiResponse(request, { error: "Jadwal tidak ditemukan" }, 404);
    }
    console.error("API request failed", error);
    if (isTicketImage) return ticketImageErrorPage(502);
    return apiResponse(request, { error: "Terjadi kesalahan pada server" }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export function OPTIONS(request: Request) {
  return preflightResponse(request);
}
