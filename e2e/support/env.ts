import fs from "node:fs";
import path from "node:path";

export type Role = "admin" | "branchAdmin" | "owner" | "developer";
export type Account = { email: string; password: string };

function readEnvFile(file: string) {
  const values: Record<string, string> = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

const backend = readEnvFile(path.join(__dirname, "..", "..", "backend", ".env"));

const baseURL = "http://localhost:5173";
const apiURL = "http://localhost:3000/api";

function account(prefix: string): Account | null {
  const email = backend[`${prefix}_EMAIL`];
  const password = backend[`${prefix}_PASSWORD`];
  return email && password ? { email: email.trim().toLowerCase(), password } : null;
}

export const settings = {
  baseURL,
  origin: new URL(baseURL).origin,
  apiURL,
  siteURL: apiURL.replace(/\/api$/, ""),
  accounts: {
    admin: account("ADMIN"),
    branchAdmin: account("BRANCH_ADMIN"),
    owner: account("OWNER"),
    developer: account("DEVELOPER"),
  } satisfies Record<Role, Account | null>,
};

export function accountFor(role: Role): Account {
  const found = settings.accounts[role];
  if (!found) throw new Error(`Akun "${role}" belum diisi di backend/.env.`);
  return found;
}

export const hasAccount = (role: Role) => Boolean(settings.accounts[role]);

export function today(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

const year = Number(today().slice(0, 4));
const pad = (value: number) => String(value).padStart(2, "0");

export const futureDate = (slot: number) => `${year + 2}-01-${pad(5 + slot)}`;
export const PAST_MONTH = { from: `${year - 7}-03-01`, to: `${year - 7}-03-31` };
export const pastDate = (slot: number) => `${year - 7}-03-${pad(5 + slot)}`;

export const TAG_PREFIX = "E2E-";
