import { request, type Page } from "@playwright/test";
import { accountFor, expect, hasAccount, settings, test } from "../support/app";

async function submitLogin(page: Page, email: string, password: string) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

test.describe("Login dan sesi", () => {
  test("pengunjung yang belum login melihat halaman login", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Masuk ke ruang admin" })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
  });

  test("form login menolak email salah format dan kata sandi kosong", async ({ page }) => {
    await page.goto("/");
    await submitLogin(page, "bukan-email", "apa-saja");
    await expect(page.getByRole("alert")).toHaveText("Masukkan alamat email yang valid.");
    await submitLogin(page, "seseorang@klinik.com", "");
    await expect(page.getByRole("alert")).toHaveText("Kata sandi wajib diisi.");
  });

  test("akun yang tidak terdaftar ditolak", async ({ page }) => {
    await page.goto("/");
    await submitLogin(page, `e2e-tidak-ada-${Date.now()}@example.com`, "kata-sandi-yang-salah");
    await expect(page.getByRole("alert")).toHaveText("Email atau kata sandi tidak sesuai");
    await expect(page.locator(".app-shell")).toHaveCount(0);
  });

  test("kata sandi salah ditolak, kata sandi benar masuk dan sesi bertahan setelah muat ulang", async ({ page }) => {
    const admin = accountFor("admin");
    await page.goto("/");
    await submitLogin(page, admin.email, `${admin.password}-salah`);
    await expect(page.getByRole("alert")).toHaveText("Email atau kata sandi tidak sesuai");

    await submitLogin(page, admin.email, admin.password);
    await expect(page.getByRole("heading", { level: 1, name: "Jadwal pasien" })).toBeVisible();
    await expect(page.locator(".profile-card")).toContainText("Administrator");
    await expect(page.locator(".profile-card")).toContainText(admin.email);
    await expect(page).toHaveTitle(/\| Jadwal Pasien$/);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Jadwal pasien" })).toBeVisible();
  });

  test("keluar mengakhiri sesi di browser dan di server", async ({ page, context }) => {
    const admin = accountFor("admin");
    await page.goto("/");
    await submitLogin(page, admin.email, admin.password);
    await expect(page.locator(".app-shell")).toBeVisible();
    const stateBeforeLogout = await context.storageState();

    await page.locator(".sidebar .logout-button").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText("Keluar dari akun?");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(page.locator(".app-shell")).toBeVisible();

    await page.locator(".sidebar .logout-button").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Keluar" }).click();
    await expect(page.getByRole("heading", { name: "Masuk ke ruang admin" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Masuk ke ruang admin" })).toBeVisible();

    const stale = await request.newContext({ storageState: stateBeforeLogout });
    expect((await stale.get(`${settings.apiURL}/auth/session`)).status()).toBe(401);
    await stale.dispose();
  });

  test("tiap peran dibawa ke halaman awalnya masing-masing", async ({ as }) => {
    const admin = await as("admin");
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Jadwal pasien");
    await expect(admin.locator(".secure-note")).toContainText("Akses admin aktif");

    if (hasAccount("owner")) {
      const owner = await as("owner");
      await expect(owner.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
      await expect(owner.locator(".profile-card")).toContainText("(Owner)");
      await expect(owner.locator(".secure-note")).toContainText("Semua klinik");
    }
    if (hasAccount("developer")) {
      const developer = await as("developer");
      await expect(developer.getByRole("heading", { level: 1 })).toHaveText("Tiketing");
      await expect(developer.locator(".profile-card")).toContainText("(Tim IT)");
    }
  });
});
