import { type Page } from "@playwright/test";
import { closeNotice, choose, errorOf, expect, formDialog, hasAccount, openMenu, screenshotFile, test, ticketCard, type Ticket } from "../support/app";

const DESCRIPTION = "Dibuat oleh pengujian otomatis untuk memeriksa alur tiket dari awal sampai selesai dikerjakan.";

async function imageDataUrl(page: Page) {
  return `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
}

test.describe("Tiketing", () => {
  test("form tiket menolak isian dan gambar yang salah", async ({ as, tag }) => {
    const page = await as("admin");
    await openMenu(page, "Tiketing");
    await expect(page.getByRole("heading", { name: "Tiket saya" })).toBeVisible();
    await page.getByRole("button", { name: "Laporkan masalah" }).click();
    const form = formDialog(page);
    const alert = form.locator(".inline-error");
    const send = form.getByRole("button", { name: "Kirim tiket" });

    await send.click();
    await expect(alert).toHaveText("Judul minimal 8 karakter.");
    await form.locator("#ticketTitle").fill("Tombolnya");
    await send.click();
    await expect(alert).toContainText("Judul minimal 2 kata");
    await form.locator("#ticketTitle").fill(`${tag} form tiket`);
    await form.locator("#ticketDescription").fill("Terlalu pendek");
    await send.click();
    await expect(alert).toHaveText("Penjelasan minimal 30 karakter.");
    await form.locator("#ticketDescription").fill(DESCRIPTION);
    await send.click();
    await expect(alert).toContainText("Lampirkan minimal 1 screenshot");

    const picture = await screenshotFile(page);
    await form.locator("#ticketImages").setInputFiles({ name: "catatan.txt", mimeType: "text/plain", buffer: Buffer.from("bukan gambar") });
    await expect(alert).toHaveText("Gambar harus berformat PNG atau JPG dengan ukuran maksimal 10 MB.");
    await form.locator("#ticketImages").setInputFiles(await screenshotFile(page, "kecil.png", { x: 0, y: 0, width: 50, height: 50 }));
    await expect(alert).toContainText("Gambar terlalu kecil");
    await form.locator("#ticketImages").setInputFiles([picture, picture, picture]);
    await expect(alert).toHaveText("Maksimal 2 gambar per tiket.");

    await form.locator("#ticketImages").setInputFiles([picture, picture]);
    await expect(form.locator(".ticket-thumb")).toHaveCount(2);
    await expect(form.locator("#ticketImages")).toHaveCount(0);
    await form.getByRole("button", { name: "Lihat gambar 2 dalam ukuran besar" }).click();
    const preview = page.getByRole("dialog", { name: "Pratinjau gambar 2" });
    await expect(preview).toContainText("Gambar 2 dari 2");
    await preview.getByRole("button", { name: "Tutup pratinjau" }).click();
    await form.getByRole("button", { name: "Hapus gambar 1" }).click();
    await expect(form.locator(".ticket-thumb")).toHaveCount(1);

    await form.getByRole("button", { name: "Batal" }).click();
    await expect(ticketCard(page, tag)).toHaveCount(0);
  });

  test("alur lengkap: dilaporkan admin, dikerjakan dan diselesaikan tim IT, lalu dihapus", async ({ as, api, tag }) => {
    test.skip(!hasAccount("developer"), "Akun developer belum diisi di backend/.env.");
    test.setTimeout(180_000);
    const title = `${tag} tiket alur lengkap`;
    const note = `Sudah diperbaiki oleh pengujian otomatis ${tag}.`;
    const adminApi = await api("admin");

    const admin = await as("admin");
    await openMenu(admin, "Tiketing");
    await admin.getByRole("button", { name: "Laporkan masalah" }).click();
    await formDialog(admin).locator("#ticketTitle").fill(title);
    await formDialog(admin).locator("#ticketDescription").fill(DESCRIPTION);
    await formDialog(admin).locator("#ticketImages").setInputFiles(await screenshotFile(admin));
    await formDialog(admin).getByRole("button", { name: "Kirim tiket" }).click();
    expect(await closeNotice(admin, "Tiket terkirim")).toMatch(/Tiket #TT\d{3,} sudah diteruskan ke tim IT/);
    const adminCard = ticketCard(admin, title);
    await expect(adminCard.locator(".ticket-status")).toHaveText("Menunggu");
    await expect(adminCard.getByRole("button", { name: "Batalkan tiket" })).toBeVisible();
    const image = adminCard.locator(".ticket-images img");
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

    const list = await (await adminApi.get("/tickets?limit=50")).json() as { tickets: Ticket[] };
    const ticket = list.tickets.find((item) => item.title === title)!;
    const imagePath = ticket.imageUrls[0];
    expect(imagePath).toMatch(/^\/Tiket-TT\d+-Gambar-1$/);
    const own = await adminApi.site(imagePath);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toMatch(/^image\//);
    const anonymous = await (await api(null)).site(imagePath);
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.text()).toContain("Akses terbatas");
    if (hasAccount("branchAdmin")) {
      const other = await (await api("branchAdmin")).site(imagePath);
      expect(other.status()).toBe(404);
      expect(await other.text()).toContain("Gambar tidak ditemukan");
      const otherList = await (await (await api("branchAdmin")).get("/tickets?limit=50")).json() as { tickets: Ticket[] };
      expect(otherList.tickets.some((item) => item.id === ticket.id)).toBe(false);
    }
    expect((await (await api("developer")).site(imagePath)).status()).toBe(200);

    const developer = await as("developer");
    const devCard = ticketCard(developer, title);
    await expect(devCard.locator(".ticket-meta")).toContainText("oleh Admin");
    await devCard.getByRole("button", { name: "Kerjakan" }).click();
    await expect(devCard.locator(".ticket-status")).toHaveText("Dikerjakan");
    await expect(devCard.locator(".ticket-meta")).toContainText("Ditangani oleh");

    const cancel = await adminApi.delete(`/tickets/${ticket.id}`);
    expect(cancel.status()).toBe(409);
    expect(await errorOf(cancel)).toBe("Tiket yang sudah dikerjakan tim IT tidak dapat dibatalkan.");
    await admin.reload();
    await openMenu(admin, "Tiketing");
    await expect(adminCard.locator(".ticket-status")).toHaveText("Dikerjakan");
    await expect(adminCard.getByRole("button", { name: "Batalkan tiket" })).toHaveCount(0);
    await choose(admin, "ticketStatus", "Menunggu");
    await expect(adminCard).toHaveCount(0);
    await choose(admin, "ticketStatus", "Dikerjakan");
    await expect(adminCard).toHaveCount(1);

    await devCard.getByRole("button", { name: "Tandai selesai" }).click();
    const resolve = formDialog(developer);
    await expect(resolve.getByRole("heading")).toHaveText("Tandai tiket selesai");
    await resolve.locator("#resolutionNote").fill(note);
    await resolve.getByRole("button", { name: "Tandai selesai" }).click();
    await expect(devCard.locator(".ticket-status")).toHaveText("Selesai");
    await expect(devCard.locator(".ticket-resolution")).toContainText(note);
    expect((await (await api("developer")).patch(`/tickets/${ticket.id}`, { status: "IN_PROGRESS" })).status()).toBe(409);

    await admin.reload();
    await expect(admin.locator(".sidebar .side-badge")).toBeVisible();
    await openMenu(admin, "Notifikasi");
    const notice = admin.locator(".ticket-notice").filter({ hasText: title });
    await expect(notice.locator(".ticket-new")).toHaveText("Baru");
    await expect(notice).toContainText(note);
    await expect(admin.locator(".sidebar .side-badge")).toHaveCount(0);
    await expect.poll(async () => (await (await adminApi.get("/tickets/notifications")).json()).unread).toBe(0);

    await developer.reload();
    await devCard.getByRole("button", { name: "Hapus tiket" }).click();
    const remove = developer.getByRole("alertdialog");
    await expect(remove.getByRole("heading")).toHaveText("Hapus tiket ini?");
    await expect(remove.locator(".inline-error")).toHaveCount(0);
    await remove.getByRole("button", { name: "Hapus tiket" }).click();
    await closeNotice(developer, "Tiket dihapus");
    await expect(devCard).toHaveCount(0);
    expect((await adminApi.site(imagePath)).status()).toBe(404);
  });

  test("pelapor membatalkan tiket yang masih menunggu", async ({ as, api, tag }) => {
    const title = `${tag} tiket dibatalkan`;
    const page = await as("admin");
    await (await api("admin")).createTicket({ title, description: DESCRIPTION, images: [await imageDataUrl(page)] });
    await openMenu(page, "Tiketing");
    await ticketCard(page, title).getByRole("button", { name: "Batalkan tiket" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText("Batalkan tiket ini?");
    await dialog.getByRole("button", { name: "Kembali" }).click();
    await expect(ticketCard(page, title)).toHaveCount(1);
    await ticketCard(page, title).getByRole("button", { name: "Batalkan tiket" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Batalkan tiket" }).click();
    expect(await closeNotice(page, "Tiket dibatalkan")).toContain("sudah dibatalkan");
    await expect(ticketCard(page, title)).toHaveCount(0);
  });

  test("aturan tiket ditegakkan di server", async ({ as, api, tag }) => {
    const page = await as("admin");
    const adminApi = await api("admin");
    const body = { title: `${tag} aturan server`, description: DESCRIPTION };

    const fake = await adminApi.post("/tickets", { ...body, images: [`data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`] });
    expect(fake.status()).toBe(400);
    expect(await errorOf(fake)).toBe("Gambar harus berformat PNG atau JPG.");
    expect((await adminApi.post("/tickets", { ...body, images: [] })).status()).toBe(400);
    expect((await adminApi.post("/tickets", { ...body, title: "aaaaaaaaaa bbbbb", images: ["x"] })).status()).toBe(400);

    const ticket = await adminApi.createTicket({ ...body, images: [await imageDataUrl(page)] });
    try {
      expect((await adminApi.patch(`/tickets/${ticket.id}`, { status: "RESOLVED" })).status()).toBe(403);
      if (hasAccount("branchAdmin")) expect((await (await api("branchAdmin")).delete(`/tickets/${ticket.id}`)).status()).toBe(404);
      if (hasAccount("developer")) {
        const developer = await api("developer");
        const created = await developer.post("/tickets", { ...body, images: [await imageDataUrl(page)] });
        expect(created.status()).toBe(403);
        expect(await errorOf(created)).toBe("Akun tim IT tidak membuat tiket.");
        const early = await developer.delete(`/tickets/${ticket.id}`);
        expect(early.status()).toBe(409);
        expect(await errorOf(early)).toBe("Hanya tiket yang sudah selesai yang dapat dihapus.");
      }
    } finally {
      expect((await adminApi.delete(`/tickets/${ticket.id}`)).status()).toBe(200);
    }
  });

  test("owner juga dapat melapor dan membatalkan tiket", async ({ as, api, tag }) => {
    test.skip(!hasAccount("owner"), "Akun owner belum diisi di backend/.env.");
    const title = `${tag} tiket dari owner`;
    const page = await as("owner");
    const ticket = await (await api("owner")).createTicket({ title, description: DESCRIPTION, images: [await imageDataUrl(page)] });
    await openMenu(page, "Tiketing");
    await expect(ticketCard(page, title).locator(".ticket-status")).toHaveText("Menunggu");
    expect((await (await api("owner")).delete(`/tickets/${ticket.id}`)).status()).toBe(200);
  });
});
