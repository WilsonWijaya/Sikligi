import ExcelJS from "exceljs";
import { type Page } from "@playwright/test";
import { appointmentRow, closeNotice, expect, expectStatus, formDialog, futureDate, hasAccount, openMenu, screenshotFile, search, settings, test, ticketCard } from "../support/app";

const MARK = "__e2eXss";
const IMG = `<img src=x onerror="window.${MARK}=1">`;
const SCRIPT = `<script>window.${MARK}=1</script>`;
const SVG = `<svg onload="window.${MARK}=1">`;

const executed = (page: Page) => page.evaluate((mark) => (window as unknown as Record<string, unknown>)[mark] ?? null, MARK);

test.describe("Serangan lewat isi data", () => {
  test("kode HTML di data jadwal tampil sebagai teks dan tidak dijalankan (stored XSS)", async ({ as, api, tag }) => {
    const name = `${tag} ${IMG}`;
    const treatment = `${SCRIPT}${SVG}`;
    await (await api("admin")).createAppointment({ patientName: name, treatment, scheduledDate: futureDate(17), startTime: "21:00", endTime: "21:30" });

    const page = await as("admin");
    await search(page, tag);
    const row = appointmentRow(page, tag);
    await expect(row.locator(".patient-copy strong")).toHaveText(name);
    await expect(row.locator(".treatment-cell strong")).toHaveText(treatment);
    await expect(row.locator("img, script, svg[onload]")).toHaveCount(0);

    await row.locator(".danger-icon").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.locator("strong")).toHaveText(name);
    await expect(dialog.locator("img")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Batal" }).click();
    await row.locator(".icon-button:not(.success-icon):not(.danger-icon)").click();
    await expect(page.locator("#patientName")).toHaveValue(name);
    await formDialog(page).getByRole("button", { name: "Batal" }).click();
    expect(await executed(page)).toBeNull();

    if (hasAccount("owner")) {
      const owner = await as("owner");
      await openMenu(owner, "Jadwal pasien");
      await search(owner, tag);
      await expect(appointmentRow(owner, tag).locator(".patient-copy strong")).toHaveText(name);
      await expect(appointmentRow(owner, tag).locator("img, script")).toHaveCount(0);
      expect(await executed(owner)).toBeNull();
    }
  });

  test("kode HTML di tiket tampil sebagai teks dan tidak dijalankan (stored XSS)", async ({ as, api, tag }) => {
    const title = `${tag} <b>tebal</b> ${IMG}`;
    const description = `Penjelasan berisi ${SCRIPT} dan ${SVG} untuk memastikan isi tiket tidak pernah dijalankan browser.`;
    const page = await as("admin");
    const adminApi = await api("admin");
    const ticket = await adminApi.createTicket({ title, description, images: [`data:image/png;base64,${(await page.screenshot()).toString("base64")}`] });
    try {
      await openMenu(page, "Tiketing");
      const card = ticketCard(page, tag);
      await expect(card.locator("h3")).toHaveText(title);
      await expect(card.locator(".ticket-description")).toHaveText(description);
      await expect(card.locator("h3 b, h3 img, .ticket-description script, .ticket-description svg")).toHaveCount(0);

      await card.getByRole("button", { name: "Batalkan tiket" }).click();
      await expect(page.getByRole("alertdialog").locator("strong").first()).toHaveText(title);
      await page.getByRole("alertdialog").getByRole("button", { name: "Kembali" }).click();
      expect(await executed(page)).toBeNull();

      if (hasAccount("developer")) {
        const developer = await as("developer");
        await expect(ticketCard(developer, tag).locator("h3")).toHaveText(title);
        await expect(ticketCard(developer, tag).locator("h3 b, h3 img")).toHaveCount(0);
        expect(await executed(developer)).toBeNull();
      }
    } finally {
      await expectStatus(await adminApi.delete(`/tickets/${ticket.id}`), 200);
    }
  });

  test("rumus di data jadwal tidak menjadi rumus di file Excel", async ({ api, tag }) => {
    const admin = await api("admin");
    const name = `=HYPERLINK("https://situs-lain.example","${tag}")`;
    await admin.createAppointment({ patientName: name, treatment: "=1+1", scheduledDate: futureDate(18), startTime: "21:00", endTime: "21:30" });
    await admin.createAppointment({ patientName: `+${tag}`, treatment: "@SUM(1+1)", scheduledDate: futureDate(18), startTime: "21:30", endTime: "22:00" });

    const response = await admin.get(`/appointments/export?q=${encodeURIComponent(tag)}`);
    await expectStatus(response, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await response.body()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Jadwal Pasien")!;
    expect(sheet.rowCount).toBe(3);
    const expected = [[name, "=1+1"], [`+${tag}`, "@SUM(1+1)"]];
    for (const [index, [patient, treatment]] of expected.entries()) {
      for (const [column, value] of [[2, patient], [4, treatment]] as const) {
        const cell = sheet.getRow(index + 2).getCell(column);
        expect(cell.type, `baris ${index + 2} kolom ${column}`).toBe(ExcelJS.ValueType.String);
        expect(cell.formula, `baris ${index + 2} kolom ${column}`).toBeUndefined();
        expect(cell.value).toBe(value);
      }
    }
  });
});

test.describe("Perlindungan di browser", () => {
  test("cookie sesi tidak dapat dibaca skrip dan tidak dikirim dari situs lain", async ({ as }) => {
    const page = await as("admin");
    const session = (await page.context().cookies(settings.apiURL)).find((cookie) => cookie.name === "sikligi_admin");
    expect(session, "cookie sesi").toBeDefined();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe("Lax");
    expect(session!.secure).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain("sikligi_admin");
  });

  test("Content-Security-Policy terpasang, tidak mengganggu pemakaian normal, dan memblokir skrip sisipan", async ({ as, api, tag }) => {
    const page = await as("admin");
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content", { timeout: 2_000 }).catch(() => null);
    test.skip(policy === null, "Server pengembangan lokal tidak memasang CSP. Uji dengan hasil build (vite preview).");
    expect(policy, "meta Content-Security-Policy").not.toBeNull();
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");

    await page.context().addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __cspLog: string[] }).__cspLog = log;
      document.addEventListener("securitypolicyviolation", (event) => log.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    const violations = () => page.evaluate(() => (window as unknown as { __cspLog: string[] }).__cspLog);
    await (await api("admin")).createAppointment({ patientName: `${tag} CSP`, scheduledDate: futureDate(19), startTime: "21:00", endTime: "21:30" });
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();

    await search(page, tag);
    await expect(appointmentRow(page, tag)).toHaveCount(1);
    await page.getByRole("button", { name: "Jadwalkan pasien" }).click();
    await page.locator("#scheduledDate").click();
    await formDialog(page).getByRole("button", { name: "Batal" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /Unduh Excel/ }).click();
    await downloading;
    await closeNotice(page, "File Excel berhasil diunduh");

    await openMenu(page, "Tiketing");
    await page.getByRole("button", { name: "Laporkan masalah" }).click();
    await formDialog(page).locator("#ticketImages").setInputFiles(await screenshotFile(page));
    const thumb = formDialog(page).locator(".ticket-thumb img");
    await expect.poll(() => thumb.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await formDialog(page).getByRole("button", { name: "Lihat gambar 1 dalam ukuran besar" }).click();
    await page.getByRole("button", { name: "Tutup pratinjau" }).click();
    await formDialog(page).getByRole("button", { name: "Batal" }).click();
    await openMenu(page, "Notifikasi");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notifikasi");
    const toggle = page.getByRole("switch", { name: "Mode gelap" });
    const checked = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("aria-checked", checked!);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", checked!);
    expect(await violations()).toEqual([]);

    await page.evaluate((mark) => {
      const script = document.createElement("script");
      script.textContent = `window.${mark}=1`;
      document.head.appendChild(script);
      const image = document.createElement("img");
      image.setAttribute("onerror", `window.${mark}=1`);
      image.src = "data:image/png;base64,rusak";
      document.body.appendChild(image);
    }, MARK);
    await expect.poll(async () => (await violations()).length).toBeGreaterThan(0);
    expect(await executed(page)).toBeNull();
  });
});
