import { request } from "@playwright/test";
import { Api, expectStatus, removeAppointments, type Ticket } from "./app";
import { accountFor, hasAccount, PAST_MONTH, settings, TAG_PREFIX, type Role } from "./env";

async function apiFor(role: Role) {
  const context = await request.newContext({ extraHTTPHeaders: { Origin: settings.origin } });
  const response = await context.post(`${settings.apiURL}/auth/login`, { data: accountFor(role) });
  if (!response.ok()) {
    throw new Error(`Login akun "${role}" ke ${settings.apiURL} gagal (${response.status()}): ${(await response.text()).slice(0, 200)}. Periksa e2e/.env.`);
  }
  return { api: new Api(context), dispose: () => context.dispose() };
}

export async function cleanTestData() {
  for (const role of ["admin", "branchAdmin"] as const) {
    if (!hasAccount(role)) continue;
    const session = await apiFor(role);
    await removeAppointments(session.api, TAG_PREFIX);
    await session.dispose();
  }

  if (hasAccount("owner")) {
    const session = await apiFor("owner");
    await expectStatus(await session.api.post("/dashboard/purge", { ...PAST_MONTH, branchId: null }), 200);
    await session.dispose();
  }

  if (hasAccount("developer")) {
    const session = await apiFor("developer");
    const leftovers: Ticket[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const response = await session.api.get(`/tickets?limit=50&page=${page}`);
      await expectStatus(response, 200);
      const result = await response.json() as { tickets: Ticket[]; totalPages: number };
      leftovers.push(...result.tickets.filter((ticket) => ticket.title.startsWith(TAG_PREFIX)));
      if (page >= result.totalPages) break;
    }
    for (const ticket of leftovers) {
      if (ticket.status !== "RESOLVED") await session.api.patch(`/tickets/${ticket.id}`, { status: "RESOLVED", resolutionNote: null });
      await session.api.delete(`/tickets/${ticket.id}`);
    }
    await session.dispose();
  }
}
