import { request } from "@playwright/test";
import { errorOf, expect, futureDate, pastDate, settings, test } from "../support/app";

test.describe("Keamanan API", () => {
  test("tanpa login semua data ditolak", async ({ api }) => {
    const anonymous = await api(null);
    for (const path of ["/auth/session", "/appointments", "/appointments/doctors", "/appointments/export", `/dashboard?from=${pastDate(0)}&to=${pastDate(1)}`, "/dashboard/branches", "/tickets", "/tickets/notifications"]) {
      expect((await anonymous.get(path)).status(), path).toBe(401);
    }
    expect((await anonymous.post("/appointments", { patientName: "Tanpa login", treatment: "x", scheduledDate: futureDate(16), startTime: "21:00", endTime: "21:30" })).status()).toBe(401);
    expect((await anonymous.site("/Tiket-TT001-Gambar-1")).status()).toBe(401);
  });

  test("cookie sesi yang dipalsukan ditolak", async () => {
    const forged = await request.newContext({ extraHTTPHeaders: { Origin: settings.origin, Cookie: "sikligi_admin=eyJzdWIiOiJ4In0.palsu" } });
    expect((await forged.get(`${settings.apiURL}/auth/session`)).status()).toBe(401);
    expect((await forged.get(`${settings.apiURL}/appointments`)).status()).toBe(401);
    await forged.dispose();
  });

  test("permintaan yang mengubah data wajib berasal dari alamat frontend", async ({ api, tag }) => {
    const body = { patientName: `${tag} Asal Lain`, treatment: "x", scheduledDate: futureDate(16), startTime: "21:00", endTime: "21:30" };
    for (const origin of [false, "https://situs-lain.example"] as const) {
      const foreign = await api("admin", { origin });
      const response = await foreign.post("/appointments", body);
      expect(response.status()).toBe(403);
      expect(await errorOf(response)).toBe("Asal permintaan tidak diizinkan");
      expect((await foreign.post("/auth/login", { email: "a@b.co", password: "x" })).status()).toBe(403);
    }
    expect((await (await api("admin")).listAppointments(tag)).total).toBe(0);
  });

  test("admin tidak dapat membuka dashboard owner", async ({ api }) => {
    const admin = await api("admin");
    const dashboard = await admin.get(`/dashboard?from=${pastDate(0)}&to=${pastDate(1)}`);
    expect(dashboard.status()).toBe(403);
    expect(await errorOf(dashboard)).toBe("Dashboard khusus untuk owner klinik.");
    expect((await admin.get("/dashboard/branches")).status()).toBe(403);
    expect((await admin.post("/dashboard/purge", { from: pastDate(0), to: pastDate(1), branchId: null })).status()).toBe(403);
  });

  test("masukan yang tidak valid ditolak server", async ({ api, tag }) => {
    const admin = await api("admin");
    const valid = { patientName: `${tag} Validasi`, treatment: "Scaling", scheduledDate: futureDate(16), startTime: "21:00", endTime: "21:30" };
    const cases: [string, Record<string, unknown>, string][] = [
      ["tanggal tidak ada", { scheduledDate: `${futureDate(16).slice(0, 4)}-02-30` }, "Tanggal tidak valid"],
      ["format jam", { startTime: "9.00" }, "Format waktu harus HH:mm"],
      ["jam selesai lebih awal", { startTime: "22:00", endTime: "21:00" }, "Jam selesai harus setelah jam kedatangan"],
      ["telepon berhuruf", { phone: "0812-abc" }, "Nomor telepon hanya boleh berisi angka tanpa spasi, 8 sampai 15 angka."],
      ["nama kosong", { patientName: "   " }, "Nama pasien wajib diisi"],
      ["nama terlalu panjang", { patientName: "a".repeat(121) }, "Nama pasien maksimal 120 karakter"],
    ];
    for (const [label, change, message] of cases) {
      const response = await admin.post("/appointments", { ...valid, ...change });
      expect(response.status(), label).toBe(400);
      expect(await errorOf(response), label).toBe(message);
    }
    expect((await admin.get("/appointments?date=31-12-2026")).status()).toBe(400);
    expect((await admin.get(`/appointments/availability?date=bukan-tanggal`)).status()).toBe(400);
    expect((await admin.post("/appointments/bulk-delete", { ids: [] })).status()).toBe(400);
    expect((await admin.patch("/auth/preferences", { darkMode: "ya" })).status()).toBe(400);
    expect((await admin.get("/tidak-ada")).status()).toBe(404);
    expect((await admin.listAppointments(tag)).total).toBe(0);
  });

  test("pencarian aman dari karakter khusus", async ({ api }) => {
    const admin = await api("admin");
    for (const query of ["' OR 1=1 --", "%", "_", "\\", "<script>alert(1)</script>"]) {
      const response = await admin.get(`/appointments?q=${encodeURIComponent(query)}`);
      expect(response.status(), query).toBe(200);
    }
    expect((await admin.listAppointments("' OR 1=1 --")).total).toBe(0);
  });
});
