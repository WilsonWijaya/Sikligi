import { errorOf, expect, futureDate, hasAccount, openMenu, pastDate, test } from "../support/app";

test.describe("Tim IT (developer)", () => {
  test.skip(!hasAccount("developer"), "Akun developer belum diisi di backend/.env.");

  test("menu tim IT: semua tiket, serta dashboard dan jadwal yang hanya bisa dilihat", async ({ as }) => {
    const page = await as("developer");
    await expect(page.locator(".sidebar .side-link:not(.theme-toggle)")).toHaveText([/Dashboard/, /Jadwal pasien/, /Tiketing/]);
    await expect(page.locator(".sidebar .side-label")).toHaveText(["KLINIK", "PENANGANAN", "TAMPILAN"]);
    await expect(page.locator(".secure-note")).toContainText("Akses tim IT aktif");

    await expect(page.getByRole("heading", { name: "Semua tiket" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Laporkan masalah" })).toHaveCount(0);

    await openMenu(page, "Jadwal pasien");
    await expect(page.locator(".page-heading")).toContainText("Akun tim IT hanya dapat melihat.");
    await expect(page.getByRole("button", { name: "Jadwalkan pasien" })).toHaveCount(0);
    await expect(page.locator("#branchFilter")).toBeVisible();

    await openMenu(page, "Dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
    await expect(page.locator(".dash-hero")).toHaveText(/^[\d.]+$/);
    await expect(page.getByRole("button", { name: "Hapus data periode" })).toHaveCount(0);
  });

  test("server menolak tim IT yang mencoba mengubah jadwal atau menghapus data periode", async ({ api, tag }) => {
    const developer = await api("developer");
    const created = await developer.post("/appointments", { patientName: `${tag} Dari Tim IT`, treatment: "x", scheduledDate: futureDate(15), startTime: "21:00", endTime: "21:30" });
    expect(created.status()).toBe(403);

    const range = `from=${pastDate(0)}&to=${pastDate(1)}`;
    expect((await developer.get(`/dashboard?${range}`)).status()).toBe(200);
    const preview = await developer.get(`/dashboard/purge?${range}`);
    expect(preview.status()).toBe(403);
    expect(await errorOf(preview)).toBe("Hanya owner yang dapat menghapus data periode.");
    expect((await developer.post("/dashboard/purge", { from: pastDate(0), to: pastDate(1), branchId: null })).status()).toBe(403);
  });
});
