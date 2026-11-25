import { test as base, expect, request as playwrightRequest, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { accountFor, settings, TAG_PREFIX, type Role } from "./env";

export { expect };
export * from "./env";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type Appointment = {
  id: string;
  patientName: string;
  treatment: string;
  doctorId: string;
  doctorName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  phone: string | null;
  status: "SCHEDULED" | "COMPLETED";
  branchName: string | null;
};
export type AppointmentInput = { patientName: string; treatment?: string; doctorId?: string | null; scheduledDate: string; startTime: string; endTime: string; phone?: string | null };
export type Doctor = { id: string; name: string; isDefault: boolean; branchId: string };
export type Ticket = { id: string; number: number; title: string; status: "OPEN" | "IN_PROGRESS" | "RESOLVED"; imageUrls: string[]; seen: boolean; resolutionNote: string | null };

export async function loginState(browser: Browser, role: Role): Promise<StorageState> {
  const account = accountFor(role);
  const context = await browser.newContext();
  try {
    const response = await context.request.post(`${settings.apiURL}/auth/login`, { data: account, headers: { Origin: settings.origin } });
    if (!response.ok()) throw new Error(`Login akun "${role}" gagal (${response.status()}): ${await response.text()}`);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

export class Api {
  constructor(private readonly context: APIRequestContext) {}

  get = (path: string) => this.context.get(settings.apiURL + path);
  post = (path: string, data?: unknown) => this.context.post(settings.apiURL + path, { data });
  put = (path: string, data?: unknown) => this.context.put(settings.apiURL + path, { data });
  patch = (path: string, data?: unknown) => this.context.patch(settings.apiURL + path, { data });
  delete = (path: string) => this.context.delete(settings.apiURL + path);
  site = (path: string) => this.context.get(settings.siteURL + path);

  async createAppointment(input: AppointmentInput): Promise<Appointment> {
    const response = await this.post("/appointments", { treatment: "Pemeriksaan otomatis", doctorId: null, phone: null, ...input });
    await expectStatus(response, 201);
    return (await response.json()).appointment;
  }

  async complete(id: string) {
    await expectStatus(await this.patch(`/appointments/${id}/status`, { status: "COMPLETED" }), 200);
  }

  async listAppointments(query: string): Promise<{ appointments: Appointment[]; total: number }> {
    const response = await this.get(`/appointments?limit=100&q=${encodeURIComponent(query)}`);
    await expectStatus(response, 200);
    return response.json();
  }

  async doctors(): Promise<Doctor[]> {
    const response = await this.get("/appointments/doctors");
    await expectStatus(response, 200);
    return (await response.json()).doctors;
  }

  async createTicket(input: { title: string; description: string; images: string[] }): Promise<Ticket> {
    const response = await this.post("/tickets", input);
    await expectStatus(response, 201);
    return (await response.json()).ticket;
  }
}

export async function expectStatus(response: APIResponse, status: number) {
  if (response.status() !== status) {
    throw new Error(`${response.url()} menjawab ${response.status()}, seharusnya ${status}: ${(await response.text()).slice(0, 300)}`);
  }
}

export async function errorOf(response: APIResponse): Promise<string> {
  return (await response.json().catch(() => ({}))).error ?? "";
}

export async function removeAppointments(api: Api, query: string) {
  for (let round = 0; round < 20; round += 1) {
    const { appointments } = await api.listAppointments(query);
    if (appointments.length === 0) return;
    await expectStatus(await api.post("/appointments/bulk-delete", { ids: appointments.map((item) => item.id) }), 200);
  }
}

type AsOptions = { fresh?: boolean; viewport?: { width: number; height: number } };
type Fixtures = {
  as: (role: Role, options?: AsOptions) => Promise<Page>;
  api: (role: Role | null, options?: { origin?: string | false }) => Promise<Api>;
  tag: string;
};
type WorkerFixtures = { sessions: { state: (role: Role) => Promise<StorageState>; forget: (role: Role) => void } };

function newTag() {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return TAG_PREFIX + Array.from({ length: 7 }, (_, index) => letters[(Math.floor(Math.random() * letters.length) + index) % letters.length]).join("");
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  sessions: [async ({ browser }, use) => {
    const cache = new Map<Role, { state: StorageState; at: number }>();
    await use({
      async state(role) {
        const cached = cache.get(role);
        if (cached && Date.now() - cached.at < 8 * 60_000) return cached.state;
        const state = await loginState(browser, role);
        cache.set(role, { state, at: Date.now() });
        return state;
      },
      forget: (role) => void cache.delete(role),
    });
  }, { scope: "worker" }],

  as: async ({ browser, sessions }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role, options = {}) => {
      const context = await browser.newContext({
        storageState: options.fresh ? await loginState(browser, role) : await sessions.state(role),
        baseURL: settings.baseURL,
        locale: "id-ID",
        timezoneId: "Asia/Jakarta",
        ...(options.viewport ? { viewport: options.viewport } : {}),
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator(".app-shell")).toBeVisible();
      return page;
    });
    for (const context of contexts) await context.close();
  },

  api: async ({ sessions }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role, options = {}) => {
      const origin = options.origin === undefined ? settings.origin : options.origin;
      const context = await playwrightRequest.newContext({
        ...(role ? { storageState: await sessions.state(role) } : {}),
        ...(origin ? { extraHTTPHeaders: { Origin: origin } } : {}),
      });
      contexts.push(context);
      return new Api(context);
    });
    for (const context of contexts) await context.dispose();
  },

  tag: async ({ api }, use, testInfo) => {
    const tag = newTag();
    await use(tag);
    for (const role of ["admin", "branchAdmin"] as const) {
      if (!settings.accounts[role]) continue;
      await removeAppointments(await api(role), tag).catch((error) => testInfo.annotations.push({ type: "cleanup", description: String(error) }));
    }
  },
});


export async function openMenu(page: Page, label: string) {
  await page.locator(".sidebar .side-link").filter({ hasText: label }).click();
}

export async function closeNotice(page: Page, title: string) {
  const panel = page.locator(".success-panel");
  await expect(panel.getByRole("heading")).toHaveText(title);
  const message = await panel.locator("#success-description").innerText();
  await panel.getByRole("button", { name: "Tutup" }).click();
  await expect(panel).toBeHidden();
  return message;
}

export async function search(page: Page, text: string) {
  await page.locator("input[type=search]").fill(text);
}

export const appointmentRow = (page: Page, text: string) => page.locator("article.appointment-row").filter({ hasText: text });
export const ticketCard = (page: Page, title: string) => page.locator("article.ticket-card").filter({ hasText: title });

export async function choose(page: Page, id: string, label: string) {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

export async function pickDate(page: Page, id: string, date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const panel = page.locator(`.date-picker:has(#${id}) .date-panel`);
  await page.locator(`#${id}`).click();
  await panel.getByRole("button", { name: "Pilih bulan dan tahun" }).click();
  await panel.getByRole("button", { name: "Pilih tahun" }).click();
  for (let step = 0; step < 30; step += 1) {
    const start = Number.parseInt(await panel.locator("strong.date-title").innerText(), 10);
    if (year < start) await panel.getByRole("button", { name: "12 tahun sebelumnya" }).click();
    else if (year > start + 11) await panel.getByRole("button", { name: "12 tahun berikutnya" }).click();
    else break;
  }
  await panel.locator(".date-option").filter({ hasText: new RegExp(`^${year}$`) }).click();
  await panel.locator(".date-option").nth(month - 1).click();
  await panel.locator(".date-day:not(.outside)").filter({ hasText: new RegExp(`^${day}$`) }).click();
  await expect(panel).toBeHidden();
}

export async function fillAppointmentForm(page: Page, values: { patientName?: string; treatment?: string; doctor?: string; date?: string; startTime?: string; endTime?: string; phone?: string }) {
  if (values.patientName !== undefined) await page.locator("#patientName").fill(values.patientName);
  if (values.treatment !== undefined) await page.locator("#treatment").fill(values.treatment);
  if (values.date !== undefined) await pickDate(page, "scheduledDate", values.date);
  if (values.doctor !== undefined) await choose(page, "doctorId", values.doctor);
  if (values.startTime !== undefined) await page.locator("#startTime").fill(values.startTime);
  if (values.endTime !== undefined) await page.locator("#endTime").fill(values.endTime);
  if (values.phone !== undefined) await page.locator("#phone").fill(values.phone);
}

export const formDialog = (page: Page) => page.locator(".modal-panel");
export const submitAppointment = (page: Page) => formDialog(page).locator("button[type=submit]").click();

export async function screenshotFile(page: Page, name = "screenshot.png", clip?: { x: number; y: number; width: number; height: number }) {
  return { name, mimeType: "image/png", buffer: await page.screenshot(clip ? { clip } : {}) };
}
