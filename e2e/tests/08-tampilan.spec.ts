import { expect, test } from "../support/app";

test.describe("Tampilan dan sesi diam", () => {
  test("mode gelap tersimpan di akun dan bertahan setelah muat ulang", async ({ as }) => {
    const page = await as("admin");
    const toggle = page.getByRole("switch", { name: "Mode gelap" });
    const html = page.locator("html");
    const startedDark = (await toggle.getAttribute("aria-checked")) === "true";

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(!startedDark));
    if (startedDark) await expect(html).not.toHaveAttribute("data-theme", "dark");
    else await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.getByRole("switch", { name: "Mode gelap" })).toHaveAttribute("aria-checked", String(!startedDark));

    await page.getByRole("switch", { name: "Mode gelap" }).click();
    await expect(page.getByRole("switch", { name: "Mode gelap" })).toHaveAttribute("aria-checked", String(startedDark));
    await page.reload();
    await expect(page.getByRole("switch", { name: "Mode gelap" })).toHaveAttribute("aria-checked", String(startedDark));
  });

  test("di layar HP menu pindah ke atas dan tetap berfungsi", async ({ as }) => {
    const page = await as("admin", { viewport: { width: 390, height: 844 } });
    await expect(page.locator(".sidebar")).toBeHidden();
    const menu = page.getByRole("navigation", { name: "Menu" });
    await expect(menu.getByRole("button")).toHaveText([/Jadwal pasien/, /Tiketing/, /Notifikasi/]);

    await menu.getByRole("button", { name: /Tiketing/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tiketing");
    await menu.getByRole("button", { name: /Jadwal pasien/ }).click();
    await expect(page.getByRole("button", { name: "Jadwalkan pasien" })).toBeVisible();
    await expect(page.locator(".topbar-logout")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("sesi yang diam diperingatkan lalu dikeluarkan otomatis", async ({ as }) => {
    const page = await as("admin", { fresh: true });
    await page.clock.install();
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();

    await page.clock.fastForward("14:10");
    const warning = page.getByRole("alertdialog").filter({ hasText: "Sesi akan berakhir" });
    await expect(warning).toContainText("Anda akan keluar otomatis dalam");
    await warning.getByRole("button", { name: "Tetap masuk" }).click();
    await expect(warning).toBeHidden();
    await expect(page.locator(".app-shell")).toBeVisible();

    await page.clock.fastForward("15:05");
    await expect(page.getByRole("heading", { name: "Masuk ke ruang admin" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Sesi berakhir karena tidak ada aktivitas selama 15 menit.");
  });
});
