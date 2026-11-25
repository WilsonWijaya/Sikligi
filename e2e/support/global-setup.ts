import { cleanTestData } from "./cleanup";
import { hasAccount, settings } from "./env";

export default async function globalSetup() {
  console.log(`\nPengujian diarahkan ke ${settings.baseURL} (API: ${settings.apiURL})`);
  const missing = (["admin", "branchAdmin", "owner", "developer"] as const).filter((role) => !hasAccount(role));
  if (missing.includes("admin")) throw new Error("Akun admin wajib diisi di backend/.env.");
  if (missing.length > 0) console.log(`Akun belum diisi, tes terkait dilewati: ${missing.join(", ")}`);
  await cleanTestData();
}
