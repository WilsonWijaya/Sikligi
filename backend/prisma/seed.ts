import "dotenv/config";
import { compare, hash } from "bcryptjs";
import { prisma } from "../lib/db";

async function credentials(email: string, password: string) {
  const existing = await prisma.admin.findUnique({ where: { email }, select: { passwordHash: true } });
  if (existing && (await compare(password, existing.passwordHash))) return { passwordHash: existing.passwordHash, sessionReset: {} };
  return { passwordHash: await hash(password, 12), sessionReset: existing ? { sessionVersion: { increment: 1 } } : {} };
}

async function ensureDoctors(branchId: string, names: string[]) {
  for (const [index, name] of names.entries()) {
    await prisma.doctor.upsert({
      where: { branchId_name: { branchId, name } },
      update: { isDefault: index === 0 },
      create: { branchId, name, isDefault: index === 0 },
    });
  }
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in backend/.env before seeding.");
  }

  const branchAdminEmail = process.env.BRANCH_ADMIN_EMAIL?.trim().toLowerCase();
  const branchAdminPassword = process.env.BRANCH_ADMIN_PASSWORD;
  const branchName = process.env.BRANCH_NAME?.trim();
  const hasBranchAdminConfig = Boolean(branchAdminEmail || branchAdminPassword || branchName);
  if (hasBranchAdminConfig && (!branchAdminEmail || !branchAdminPassword || branchAdminPassword.length < 12 || !branchName)) {
    throw new Error("Set BRANCH_ADMIN_EMAIL, BRANCH_ADMIN_PASSWORD (at least 12 characters), and BRANCH_NAME together.");
  }
  if (branchAdminEmail && branchAdminEmail === email) {
    throw new Error("Branch admin must use a different email from the primary admin.");
  }

  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD;
  if ((ownerEmail || ownerPassword) && (!ownerEmail || !ownerPassword || ownerPassword.length < 12)) {
    throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters) together.");
  }
  if (ownerEmail && (ownerEmail === email || ownerEmail === branchAdminEmail)) {
    throw new Error("Owner must use a different email from the admin accounts.");
  }

  const developerEmail = process.env.DEVELOPER_EMAIL?.trim().toLowerCase();
  const developerPassword = process.env.DEVELOPER_PASSWORD;
  const developerName = process.env.DEVELOPER_NAME?.trim();
  const hasDeveloperConfig = Boolean(developerEmail || developerPassword || developerName);
  if (hasDeveloperConfig && (!developerEmail || !developerPassword || developerPassword.length < 12 || !developerName)) {
    throw new Error("Set DEVELOPER_EMAIL, DEVELOPER_PASSWORD (at least 12 characters), and DEVELOPER_NAME together.");
  }
  if (developerEmail && [email, branchAdminEmail, ownerEmail].includes(developerEmail)) {
    throw new Error("Developer must use a different email from the other accounts.");
  }

  const primaryBranchId = "sikligi-main-branch";
  const primaryBranch = await prisma.branch.upsert({
    where: { id: primaryBranchId },
    update: { name: "Sikligi Dental Care" },
    create: { id: primaryBranchId, name: "Sikligi Dental Care" },
  });
  await ensureDoctors(primaryBranch.id, ["Drg. Andini", "Drg. Bima", "Drg. Citra"]);
  const { passwordHash, sessionReset } = await credentials(email, password);
  const admin = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash, ...sessionReset, branchId: primaryBranch.id },
    create: { email, passwordHash, branchId: primaryBranch.id },
    select: { email: true },
  });
  console.log(`Admin account configured: ${admin.email}`);

  if (ownerEmail && ownerPassword) {
    const { passwordHash: ownerPasswordHash, sessionReset: ownerSessionReset } = await credentials(ownerEmail, ownerPassword);
    const owner = await prisma.admin.upsert({
      where: { email: ownerEmail },
      update: { passwordHash: ownerPasswordHash, ...ownerSessionReset, role: "OWNER" },
      create: { email: ownerEmail, passwordHash: ownerPasswordHash, branchId: primaryBranch.id, role: "OWNER" },
      select: { email: true },
    });
    console.log(`Owner account configured: ${owner.email}`);
  }

  if (developerEmail && developerPassword && developerName) {
    const { passwordHash: developerPasswordHash, sessionReset: developerSessionReset } = await credentials(developerEmail, developerPassword);
    const developer = await prisma.admin.upsert({
      where: { email: developerEmail },
      update: { passwordHash: developerPasswordHash, ...developerSessionReset, role: "DEVELOPER", name: developerName },
      create: { email: developerEmail, passwordHash: developerPasswordHash, branchId: primaryBranch.id, role: "DEVELOPER", name: developerName },
      select: { email: true },
    });
    console.log(`Developer account configured: ${developer.email} (${developerName})`);
  }

  if (branchAdminEmail && branchAdminPassword && branchName) {
    const branchId = "sikligi-branch-2";
    const branch = await prisma.branch.upsert({
      where: { id: branchId },
      update: { name: branchName },
      create: { id: branchId, name: branchName },
    });
    await ensureDoctors(branch.id, ["Drg. Andini"]);
    const { passwordHash: branchPasswordHash, sessionReset: branchSessionReset } = await credentials(branchAdminEmail, branchAdminPassword);
    const branchAdmin = await prisma.admin.upsert({
      where: { email: branchAdminEmail },
      update: { passwordHash: branchPasswordHash, ...branchSessionReset, branchId: branch.id },
      create: { email: branchAdminEmail, passwordHash: branchPasswordHash, branchId: branch.id },
      select: { email: true },
    });
    console.log(`Branch admin configured: ${branchAdmin.email} (${branch.name})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
