import { appointmentRow, choose, closeNotice, errorOf, expect, futureDate, hasAccount, openMenu, pastDate, pickDate, search, test, today } from "../support/app";

test.describe("Owner", () => {
  test.skip(!hasAccount("owner"), "Akun owner belum diisi di backend/.env.");

  test("menu owner dan jadwal yang hanya bisa dilihat", async ({ as, api, tag }) => {
    const main = await api("admin");
    await main.createAppointment({ patientName: `${tag} Pusat`, scheduledDate: futureDate(13), startTime: "21:00", endTime: "21:30" });
    if (hasAccount("branchAdmin")) {
      await (await api("branchAdmin")).createAppointment({ patientName: `${tag} Cabang`, scheduledDate: futureDate(13), startTime: "21:00", endTime: "21:30" });
    }

    const page = await as("owner");
    await expect(page.locator(".sidebar .side-link:not(.theme-toggle)")).toHaveText([/Dashboard/, /Jadwal pasien/, /Tiketing/, /Notifikasi/]);

    await openMenu(page, "Jadwal pasien");
    await expect(page.locator(".page-heading")).toContainText("Akun owner hanya dapat melihat.");
    await expect(page.getByRole("button", { name: "Jadwalkan pasien" })).toHaveCount(0);
    await search(page, tag);
    const rows = page.locator("article.appointment-row");
    await expect(rows).toHaveCount(hasAccount("branchAdmin") ? 2 : 1);
    await expect(page.locator(".row-actions")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    if (hasAccount("branchAdmin")) {
      const branchName = (await appointmentRow(page, `${tag} Cabang`).locator(".date-cell small").innerText()).trim();
      const mainName = (await appointmentRow(page, `${tag} Pusat`).locator(".date-cell small").innerText()).trim();
      expect(branchName).not.toBe(mainName);
      await choose(page, "branchFilter", branchName);
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText(`${tag} Cabang`);
      await choose(page, "branchFilter", "Semua klinik");
      await expect(rows).toHaveCount(2);
    }
  });

  test("server menolak owner yang mencoba mengubah jadwal", async ({ api, tag }) => {
    const visit = await (await api("admin")).createAppointment({ patientName: `${tag} Terkunci`, scheduledDate: futureDate(14), startTime: "21:00", endTime: "21:30" });
    const owner = await api("owner");
    const body = { patientName: `${tag} Dari Owner`, treatment: "x", scheduledDate: futureDate(14), startTime: "22:00", endTime: "22:30" };
    const created = await owner.post("/appointments", body);
    expect(created.status()).toBe(403);
    expect(await errorOf(created)).toBe("Akun ini hanya dapat melihat jadwal.");
    expect((await owner.put(`/appointments/${visit.id}`, body)).status()).toBe(403);
    expect((await owner.patch(`/appointments/${visit.id}/status`, { status: "COMPLETED" })).status()).toBe(403);
    expect((await owner.delete(`/appointments/${visit.id}`)).status()).toBe(403);
    expect((await owner.post("/appointments/bulk-delete", { ids: [visit.id] })).status()).toBe(403);
  });

  test("dashboard menampilkan ringkasan, grafik, dan filter", async ({ as }) => {
    const page = await as("owner");
    await expect(page.getByRole("button", { name: "30 hari" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".dash-stat-label")).toHaveText([/Kunjungan selesai/, /Rata-rata per hari/, /Periode sebelumnya/]);
    await expect(page.locator(".dash-hero")).toHaveText(/^[\d.]+$/);
    await expect(page.locator(".dash-stat").nth(1)).toContainText("Dari 30 hari");
    await expect(page.getByRole("heading", { name: "Kunjungan selesai per hari" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Grafik kunjungan selesai per hari" })).toBeVisible();

    await page.getByText("Lihat data dalam tabel").click();
    await expect(page.locator(".dash-table tbody tr")).toHaveCount(30);

    await page.getByRole("button", { name: "90 hari" }).click();
    await expect(page.locator(".dash-stat").nth(1)).toContainText("Dari 90 hari");
    await expect(page.getByRole("heading", { name: "Kunjungan selesai per bulan" })).toBeVisible();

    await page.getByRole("button", { name: "12 bulan" }).click();
    await expect(page.getByRole("button", { name: "12 bulan" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".dash-table tbody tr")).toHaveCount(12);
    await page.getByRole("button", { name: "Tahun ini" }).click();
    await expect(page.getByRole("button", { name: "Tahun ini" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".dash-card-head p").first()).toContainText(`1 Jan ${today().slice(0, 4)}`);

    await page.getByRole("button", { name: "30 hari" }).click();
    await pickDate(page, "dashFrom", futureDate(0));
    await expect(page.getByRole("alert")).toHaveText("Tanggal awal harus sebelum atau sama dengan tanggal akhir.");
    await page.getByRole("button", { name: "30 hari" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const branches = await page.locator(".dash-branches li .dash-branch-name").allInnerTexts();
    if (branches.length > 1) {
      await expect(page.getByRole("heading", { name: "Per klinik" })).toBeVisible();
      await choose(page, "dashBranch", branches[0]);
      await expect(page.getByRole("heading", { name: "Per klinik" })).toHaveCount(0);
      await expect(page.locator(".dash-card-head p").first()).toContainText(branches[0]);
    }
  });

  test("kunjungan selesai masuk dashboard, tetap terlihat owner setelah dihapus admin, lalu dihapus permanen", async ({ as, api, tag }) => {
    const admin = await api("admin");
    const owner = await api("owner");
    const date = pastDate(5);
    const name = `${tag} Laporan`;
    const scheduled = `${tag} Masih Terjadwal`;
    const before = (await (await owner.get(`/dashboard?from=${date}&to=${date}`)).json()).total as number;

    const visit = await admin.createAppointment({ patientName: name, scheduledDate: date, startTime: "10:00", endTime: "10:30" });
    await admin.createAppointment({ patientName: scheduled, scheduledDate: date, startTime: "11:00", endTime: "11:30" });
    await admin.complete(visit.id);
    const removed = await admin.delete(`/appointments/${visit.id}`);
    expect(await removed.json()).toEqual({ success: true, archived: true });
    expect((await admin.listAppointments(name)).total).toBe(0);

    const page = await as("owner");
    await openMenu(page, "Jadwal pasien");
    await search(page, name);
    await expect(appointmentRow(page, name).locator(".status-badge")).toHaveText("Selesai");

    await openMenu(page, "Dashboard");
    await pickDate(page, "dashTo", date);
    await pickDate(page, "dashFrom", date);
    await expect(page.locator(".dash-hero")).toHaveText(String(before + 1));
    await expect(page.locator(".dash-stat").nth(1)).toContainText("Dari 1 hari");

    await page.getByRole("button", { name: "Hapus data periode" }).click();
    const dialog = page.locator(".dash-purge-panel");
    await expect(dialog.locator(".dash-purge-count")).toContainText(`${before + 1} kunjungan selesai akan dihapus permanen`);
    const confirm = dialog.getByRole("button", { name: "Hapus permanen" });
    await expect(confirm).toBeDisabled();
    await dialog.locator("#purgeConfirm").fill("hapus");
    await expect(confirm).toBeDisabled();
    await dialog.locator("#purgeConfirm").fill("HAPUS");
    await confirm.click();
    expect(await closeNotice(page, "Data periode dihapus")).toContain(`${before + 1} kunjungan selesai`);
    await expect(page.locator(".dash-hero")).toHaveText("0");
    await expect(page.locator(".dash-empty")).toHaveText("Belum ada kunjungan berstatus Selesai pada periode ini.");

    expect((await admin.listAppointments(scheduled)).total).toBe(1);
    await openMenu(page, "Jadwal pasien");
    await search(page, name);
    await expect(page.locator(".empty-state")).toContainText("Pasien tidak ditemukan");
  });

  test("data hari ini dan setelahnya tidak dapat dihapus permanen", async ({ as, api }) => {
    const owner = await api("owner");
    const refused = await owner.post("/dashboard/purge", { from: today(-3), to: today(), branchId: null });
    expect(refused.status()).toBe(400);
    expect(await errorOf(refused)).toBe("Hanya data sebelum hari ini yang dapat dihapus permanen.");

    const page = await as("owner");
    await page.getByRole("button", { name: "Hapus data periode" }).click();
    const dialog = page.locator(".dash-purge-panel");
    await expect(dialog.getByRole("heading")).toHaveText("Hapus data periode");
    await expect(dialog.locator(".inline-error")).toHaveCount(0);
    await dialog.locator("#purgeTo").click();
    await dialog.getByRole("button", { name: "Pilih hari ini" }).click();
    await expect(dialog.locator(".inline-error")).toContainText("tanggal akhir paling lambat kemarin");
    await dialog.locator("#purgeConfirm").fill("HAPUS");
    await expect(dialog.getByRole("button", { name: "Hapus permanen" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toBeHidden();
  });
});
