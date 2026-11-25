import ExcelJS from "exceljs";
import { appointmentRow, choose, closeNotice, errorOf, expect, fillAppointmentForm, formDialog, futureDate, pastDate, pickDate, search, submitAppointment, test, today } from "../support/app";

test.describe("Jadwal pasien (admin)", () => {
  test("menambah jadwal lewat form", async ({ as, api, tag }) => {
    const page = await as("admin");
    const doctors = await (await api("admin")).doctors();
    const doctor = doctors[doctors.length - 1];
    const name = `${tag} Pasien Baru`;

    await page.getByRole("button", { name: "Jadwalkan pasien" }).click();
    await expect(formDialog(page).getByRole("heading")).toHaveText("Jadwalkan pasien");
    await fillAppointmentForm(page, { patientName: name, treatment: "Scaling gigi", date: futureDate(0), doctor: doctor.name, startTime: "21:00", endTime: "21:30", phone: "081234567890" });
    await submitAppointment(page);
    expect(await closeNotice(page, "Jadwal dibuat")).toBe("Jadwal pasien berhasil ditambahkan.");

    await search(page, name);
    const row = appointmentRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Scaling gigi");
    await expect(row).toContainText("081234567890");
    await expect(row.locator(".time-pill")).toContainText("21:00");
    await expect(row.locator(".time-pill")).toContainText("21:30");
    await expect(row.locator(".doctor-name")).toHaveText(doctor.name);
    await expect(row.locator(".status-badge")).toHaveText("Terjadwal");
  });

  test("form menolak isian yang salah", async ({ as, api, tag }) => {
    const page = await as("admin");
    const alert = formDialog(page).locator(".inline-error");
    await page.getByRole("button", { name: "Jadwalkan pasien" }).click();

    await submitAppointment(page);
    await expect(alert).toHaveText("Nama pasien dan perawatan atau tindakan wajib diisi.");

    await fillAppointmentForm(page, { patientName: `${tag} Validasi`, treatment: "Tambal gigi", date: futureDate(1), phone: "0812-abc" });
    await submitAppointment(page);
    await expect(alert).toHaveText("Nomor telepon hanya boleh berisi angka tanpa spasi, 8 sampai 15 angka.");

    await fillAppointmentForm(page, { phone: "", startTime: "9:00" });
    await submitAppointment(page);
    await expect(alert).toHaveText("Isi jam dengan format 24 jam HH:mm, misalnya 09:10.");

    await fillAppointmentForm(page, { startTime: "10:00", endTime: "09:00" });
    await submitAppointment(page);
    const conflict = page.getByRole("alertdialog");
    await expect(conflict.getByRole("heading")).toHaveText("Jadwal bertabrakan");
    await conflict.getByRole("button", { name: "Pilih waktu lain" }).click();

    await formDialog(page).getByRole("button", { name: "Batal" }).click();
    await expect(formDialog(page)).toBeHidden();
    expect((await (await api("admin")).listAppointments(tag)).total).toBe(0);
  });

  test("jadwal bentrok pada dokter dan tanggal yang sama ditolak", async ({ as, api, tag }) => {
    const admin = await api("admin");
    const doctors = await admin.doctors();
    const date = futureDate(2);
    await admin.createAppointment({ patientName: `${tag} Pertama`, scheduledDate: date, startTime: "21:00", endTime: "21:30" });

    const blocked = await admin.post("/appointments", { patientName: `${tag} Bentrok API`, treatment: "Cabut gigi", scheduledDate: date, startTime: "21:15", endTime: "21:45" });
    expect(blocked.status()).toBe(409);
    expect(await errorOf(blocked)).toBe("Jadwal bentrok dengan pasien lain pada dokter dan tanggal tersebut.");

    const page = await as("admin");
    await page.getByRole("button", { name: "Jadwalkan pasien" }).click();
    await fillAppointmentForm(page, { patientName: `${tag} Kedua`, treatment: "Cabut gigi", date, startTime: "21:15", endTime: "21:45" });
    await submitAppointment(page);
    const conflict = page.getByRole("alertdialog");
    await expect(conflict.getByRole("heading")).toHaveText("Jadwal bertabrakan");
    await conflict.getByRole("button", { name: "Pilih waktu lain" }).click();

    await fillAppointmentForm(page, { startTime: "21:30", endTime: "22:00" });
    await submitAppointment(page);
    await closeNotice(page, "Jadwal dibuat");

    const other = doctors.find((doctor) => !doctor.isDefault);
    if (other) {
      await page.getByRole("button", { name: "Jadwalkan pasien" }).click();
      await fillAppointmentForm(page, { patientName: `${tag} Ketiga`, treatment: "Kontrol", date, doctor: other.name, startTime: "21:00", endTime: "21:30" });
      await submitAppointment(page);
      await closeNotice(page, "Jadwal dibuat");
    }
    expect((await admin.listAppointments(tag)).total).toBe(other ? 3 : 2);
  });

  test("mengubah jadwal", async ({ as, api, tag }) => {
    const name = `${tag} Diubah`;
    await (await api("admin")).createAppointment({ patientName: name, treatment: "Konsultasi awal", scheduledDate: futureDate(3), startTime: "21:00", endTime: "21:30" });
    const page = await as("admin");
    await search(page, name);
    await page.getByRole("button", { name: `Ubah jadwal ${name}` }).click();
    await expect(formDialog(page).getByRole("heading")).toHaveText("Ubah jadwal pasien");
    await expect(page.locator("#patientName")).toHaveValue(name);
    await expect(page.locator("#startTime")).toHaveValue("21:00");

    await fillAppointmentForm(page, { treatment: "Pasang behel", startTime: "22:00", endTime: "22:45", phone: "08987654321" });
    await submitAppointment(page);
    expect(await closeNotice(page, "Jadwal diperbarui")).toBe("Perubahan jadwal pasien berhasil disimpan.");

    const row = appointmentRow(page, name);
    await expect(row).toContainText("Pasang behel");
    await expect(row).toContainText("08987654321");
    await expect(row.locator(".time-pill")).toContainText("22:00");
    await expect(row.locator(".time-pill")).toContainText("22:45");
  });

  test("mencari berdasarkan nama, tindakan, dan telepon", async ({ as, api, tag }) => {
    const admin = await api("admin");
    const phone = `0877${String(Date.now()).slice(-8)}`;
    await admin.createAppointment({ patientName: `${tag} Cari Satu`, treatment: `Veneer ${tag}`, scheduledDate: futureDate(4), startTime: "21:00", endTime: "21:15" });
    await admin.createAppointment({ patientName: `${tag} Cari Dua`, treatment: "Bleaching", scheduledDate: futureDate(4), startTime: "21:15", endTime: "21:30", phone });
    const page = await as("admin");
    const rows = page.locator("article.appointment-row");

    await search(page, tag);
    await expect(rows).toHaveCount(2);
    await search(page, `veneer ${tag}`.toUpperCase());
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Cari Satu");
    await search(page, phone);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Cari Dua");

    await search(page, `${tag} tidak mungkin ada`);
    await expect(page.locator(".empty-state")).toContainText("Pasien tidak ditemukan");
    await expect(page.getByRole("button", { name: /Unduh Excel/ })).toBeDisabled();

    await page.locator("h1").click();
    await page.keyboard.press("/");
    await expect(page.locator("input[type=search]")).toBeFocused();
  });

  test("menyaring berdasarkan tanggal dan dokter", async ({ as, api, tag }) => {
    const admin = await api("admin");
    const doctors = await admin.doctors();
    const other = doctors.find((doctor) => !doctor.isDefault) ?? doctors[0];
    const fallback = doctors.find((doctor) => doctor.isDefault) ?? doctors[0];
    await admin.createAppointment({ patientName: `${tag} Hari Ini`, scheduledDate: today(), startTime: "23:30", endTime: "23:45", doctorId: other.id });
    await admin.createAppointment({ patientName: `${tag} Besok`, scheduledDate: today(1), startTime: "23:30", endTime: "23:45", doctorId: other.id });
    await admin.createAppointment({ patientName: `${tag} Nanti`, scheduledDate: futureDate(5), startTime: "21:00", endTime: "21:15" });
    const page = await as("admin");
    const rows = page.locator("article.appointment-row");
    await search(page, tag);
    await expect(rows).toHaveCount(3);

    await page.getByRole("button", { name: "Hari ini", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(`${tag} Hari Ini`);
    await expect(page.locator(".date-group")).toContainText("Hari ini");

    await page.getByRole("button", { name: "Besok", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(`${tag} Besok`);

    await pickDate(page, "dateFilter", futureDate(5));
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(`${tag} Nanti`);

    await page.getByRole("button", { name: "Semua tanggal" }).click();
    await expect(rows).toHaveCount(3);

    if (other.id !== fallback.id) {
      await choose(page, "doctorFilter", other.name);
      await expect(rows).toHaveCount(2);
      await choose(page, "doctorFilter", fallback.name);
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText(`${tag} Nanti`);
      await choose(page, "doctorFilter", "Semua dokter");
      await expect(rows).toHaveCount(3);
    }
  });

  test("daftar dibagi per 10 jadwal", async ({ as, api, tag }) => {
    const admin = await api("admin");
    for (let index = 0; index < 11; index += 1) {
      const start = `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`;
      const end = `${String(Math.floor((index + 1) / 4)).padStart(2, "0")}:${String(((index + 1) % 4) * 15).padStart(2, "0")}`;
      await admin.createAppointment({ patientName: `${tag} Halaman ${String(index + 1).padStart(2, "0")}`, scheduledDate: futureDate(6), startTime: start, endTime: end });
    }
    const page = await as("admin");
    const rows = page.locator("article.appointment-row");
    const footer = page.locator(".list-footer");
    await search(page, tag);
    await expect(rows).toHaveCount(10);
    await expect(footer).toContainText("Menampilkan 1 – 10 dari 11 jadwal");
    await expect(rows.first()).toContainText("Halaman 01");

    await footer.getByRole("button", { name: "Berikutnya" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Halaman 11");
    await expect(footer).toContainText("Menampilkan 11 – 11 dari 11 jadwal");
    await expect(rows.locator(".visit-number")).toHaveText("11");
    await expect(footer.getByRole("button", { name: "Berikutnya" })).toBeDisabled();

    await footer.getByRole("button", { name: "Halaman 1", exact: true }).click();
    await expect(rows).toHaveCount(10);
  });

  test("menandai kunjungan selesai, lalu jadwal itu terkunci", async ({ as, api, tag }) => {
    const admin = await api("admin");
    const done = `${tag} Sudah Datang`;
    const upcoming = `${tag} Belum Datang`;
    const visit = await admin.createAppointment({ patientName: done, treatment: "Kontrol behel", scheduledDate: pastDate(0), startTime: "09:00", endTime: "09:30" });
    await admin.createAppointment({ patientName: upcoming, scheduledDate: futureDate(7), startTime: "21:00", endTime: "21:30" });
    const page = await as("admin");
    await search(page, tag);

    await expect(page.getByRole("button", { name: `Tandai selesai ${upcoming}` })).toBeDisabled();

    await page.getByRole("button", { name: `Tandai selesai ${done}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText("Tandai kunjungan selesai?");
    await expect(dialog).toContainText(done);
    await dialog.getByRole("button", { name: "Tandai selesai" }).click();

    const row = appointmentRow(page, done);
    await expect(row.locator(".status-badge")).toHaveText("Selesai");
    await expect(row.getByRole("img", { name: "Sudah selesai" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Ubah jadwal ${done}` })).toBeDisabled();

    const edit = await admin.put(`/appointments/${visit.id}`, { patientName: done, treatment: "Diubah", scheduledDate: pastDate(0), startTime: "09:00", endTime: "09:30" });
    expect(edit.status()).toBe(409);
    expect((await admin.patch(`/appointments/${visit.id}/status`, { status: "SCHEDULED" })).status()).toBe(409);

    await page.getByRole("button", { name: `Hapus jadwal ${done}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Hapus jadwal" }).click();
    await closeNotice(page, "Jadwal dihapus");
    await expect(appointmentRow(page, done)).toHaveCount(0);
  });

  test("menghapus satu jadwal", async ({ as, api, tag }) => {
    const name = `${tag} Dihapus`;
    await (await api("admin")).createAppointment({ patientName: name, scheduledDate: futureDate(8), startTime: "21:00", endTime: "21:30" });
    const page = await as("admin");
    await search(page, name);

    await page.getByRole("button", { name: `Hapus jadwal ${name}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText("Hapus jadwal ini?");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(appointmentRow(page, name)).toHaveCount(1);

    await page.getByRole("button", { name: `Hapus jadwal ${name}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Hapus jadwal" }).click();
    expect(await closeNotice(page, "Jadwal dihapus")).toBe(`Jadwal pasien ${name} berhasil dihapus.`);
    await expect(page.locator(".empty-state")).toContainText("Pasien tidak ditemukan");
    expect((await (await api("admin")).listAppointments(name)).total).toBe(0);
  });

  test("menghapus beberapa jadwal sekaligus", async ({ as, api, tag }) => {
    const admin = await api("admin");
    for (const [index, label] of ["Satu", "Dua", "Tiga"].entries()) {
      await admin.createAppointment({ patientName: `${tag} Massal ${label}`, scheduledDate: futureDate(9), startTime: `21:${index * 15 || "00"}`, endTime: `21:${index * 15 + 15}` });
    }
    const page = await as("admin");
    await search(page, tag);
    await expect(page.locator("article.appointment-row")).toHaveCount(3);

    await page.getByRole("checkbox", { name: `Pilih jadwal ${tag} Massal Satu` }).check();
    await page.getByRole("checkbox", { name: `Pilih jadwal ${tag} Massal Dua` }).check();
    const bar = page.locator(".bulk-bar");
    await expect(bar).toContainText("2 jadwal dipilih");
    await bar.getByRole("button", { name: "Pilih semua di halaman ini" }).click();
    await expect(bar).toContainText("3 jadwal dipilih");
    await bar.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(bar).toBeHidden();

    await page.getByRole("checkbox", { name: "Pilih semua jadwal di halaman ini" }).check();
    await expect(bar).toContainText("3 jadwal dipilih");
    await bar.getByRole("button", { name: "Hapus terpilih" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText("Hapus 3 jadwal?");
    await dialog.getByRole("button", { name: "Hapus 3 jadwal" }).click();
    expect(await closeNotice(page, "Jadwal dihapus")).toBe("3 jadwal pasien berhasil dihapus.");
    expect((await admin.listAppointments(tag)).total).toBe(0);
  });

  test("mengunduh daftar jadwal sebagai Excel", async ({ as, api, tag }, testInfo) => {
    const admin = await api("admin");
    await admin.createAppointment({ patientName: `${tag} Excel A`, treatment: "Scaling", scheduledDate: futureDate(10), startTime: "21:00", endTime: "21:30", phone: "081200001111" });
    await admin.createAppointment({ patientName: `${tag} Excel B`, treatment: "Tambal", scheduledDate: futureDate(10), startTime: "21:30", endTime: "22:00" });
    const page = await as("admin");
    await search(page, tag);
    await expect(page.locator("article.appointment-row")).toHaveCount(2);

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /Unduh Excel/ }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("ADS_Jadwal_Pasien_Semua_Tanggal_Semua_Dokter.xlsx");
    const file = testInfo.outputPath("jadwal.xlsx");
    await download.saveAs(file);
    expect(await closeNotice(page, "File Excel berhasil diunduh")).toContain("berisi 2 jadwal");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet("Jadwal Pasien")!;
    const text = (row: number) => (sheet.getRow(row).values as unknown[]).slice(1).map((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value)));
    expect(text(1)).toEqual(["No", "Nama Pasien", "Nomor Telepon", "Perawatan / Tindakan", "Tanggal Kedatangan", "Jam Mulai", "Jam Selesai", "Dokter", "Status", "Klinik"]);
    expect(sheet.rowCount).toBe(3);
    expect(text(2).slice(0, 7)).toEqual(["1", `${tag} Excel A`, "081200001111", "Scaling", futureDate(10), "21:00", "21:30"]);
    expect(text(2)[8]).toBe("Terjadwal");
    expect(text(3).slice(0, 4)).toEqual(["2", `${tag} Excel B`, "-", "Tambal"]);
  });
});
