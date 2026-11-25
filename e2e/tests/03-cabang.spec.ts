import { appointmentRow, errorOf, expect, futureDate, hasAccount, search, test } from "../support/app";

test.describe("Pemisahan data antar cabang", () => {
  test.skip(!hasAccount("branchAdmin"), "Akun admin cabang belum diisi di backend/.env.");

  test("admin cabang tidak melihat dan tidak dapat mengubah jadwal cabang lain", async ({ as, api, tag }) => {
    const main = await api("admin");
    const branch = await api("branchAdmin");
    const name = `${tag} Milik Pusat`;
    const visit = await main.createAppointment({ patientName: name, scheduledDate: futureDate(11), startTime: "21:00", endTime: "21:30" });

    const page = await as("branchAdmin");
    await search(page, name);
    await expect(page.locator(".empty-state")).toContainText("Pasien tidak ditemukan");
    await expect(appointmentRow(page, name)).toHaveCount(0);

    expect((await branch.listAppointments(name)).total).toBe(0);
    const body = { patientName: "Diambil alih", treatment: "x", scheduledDate: futureDate(11), startTime: "21:00", endTime: "21:30" };
    expect((await branch.put(`/appointments/${visit.id}`, body)).status()).toBe(404);
    expect((await branch.patch(`/appointments/${visit.id}/status`, { status: "COMPLETED" })).status()).toBe(404);
    expect((await branch.delete(`/appointments/${visit.id}`)).status()).toBe(404);
    const bulk = await branch.post("/appointments/bulk-delete", { ids: [visit.id] });
    expect(await bulk.json()).toEqual({ deleted: 0, archived: 0 });

    const stillThere = await main.listAppointments(name);
    expect(stillThere.total).toBe(1);
    expect(stillThere.appointments[0].patientName).toBe(name);
  });

  test("tiap cabang punya dokter dan slot waktunya sendiri", async ({ as, api, tag }) => {
    const main = await api("admin");
    const branch = await api("branchAdmin");
    const mainDoctors = await main.doctors();
    const branchDoctors = await branch.doctors();
    expect(branchDoctors.length).toBeGreaterThan(0);
    expect(new Set(branchDoctors.map((doctor) => doctor.branchId)).size).toBe(1);
    expect(branchDoctors[0].branchId).not.toBe(mainDoctors[0].branchId);

    const slot = { scheduledDate: futureDate(12), startTime: "21:00", endTime: "21:30" };
    await main.createAppointment({ patientName: `${tag} Slot Pusat`, ...slot });
    await branch.createAppointment({ patientName: `${tag} Slot Cabang`, ...slot });

    const foreign = await branch.post("/appointments", { patientName: `${tag} Dokter Asing`, treatment: "x", doctorId: mainDoctors[0].id, scheduledDate: futureDate(12), startTime: "22:00", endTime: "22:30" });
    expect(foreign.status()).toBe(409);
    expect(await errorOf(foreign)).toBe("Dokter tidak tersedia untuk klinik ini.");

    const page = await as("branchAdmin");
    await search(page, tag);
    await expect(page.locator("article.appointment-row")).toHaveCount(1);
    await expect(appointmentRow(page, `${tag} Slot Cabang`)).toBeVisible();
    const mainPage = await as("admin");
    await expect(page.locator(".secure-note strong")).not.toHaveText(await mainPage.locator(".secure-note strong").innerText());
  });
});
