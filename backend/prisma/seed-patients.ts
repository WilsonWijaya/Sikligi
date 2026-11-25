import "dotenv/config";
import { prisma } from "../lib/db";

const SEED_PREFIX = "seed-pasien-";
const BRANCH_ID = process.env.SEED_BRANCH_ID?.trim() || "sikligi-main-branch";
const FIRST_DAY_OFFSET = -1;
const DAY_COUNT = 7;
const APPOINTMENTS_PER_DAY = 8;

const patientNames = [
  "Budi Santoso", "Siti Nurhaliza", "Andi Kurniawan", "Dewi Lestari", "Rizky Pratama", "Putri Ayu Maharani",
  "Agus Setiawan", "Maria Christina Simanjuntak", "Hendra Gunawan", "Fitriani Rahma", "Yohanes Tan", "Nur Aini",
  "Dimas Aditya", "Melati Kusuma", "Fajar Nugroho", "Indah Permatasari", "Rudi Hartanto", "Ratna Sari Dewi",
  "Bayu Saputra", "Clara Anindita", "Eko Prasetyo", "Lina Marlina", "Kevin Sanjaya", "Sri Wahyuni",
  "Muhammad Iqbal Ramadhan", "Tania Oktaviani", "Stefanus Hartono", "Ayu Kartika",
];

const treatments: { name: string; minutes: number }[] = [
  { name: "Scaling", minutes: 60 },
  { name: "Tambal gigi", minutes: 60 },
  { name: "Cabut gigi", minutes: 30 },
  { name: "Konsultasi", minutes: 30 },
  { name: "Perawatan saluran akar", minutes: 90 },
  { name: "Bleaching", minutes: 90 },
  { name: "Kontrol behel", minutes: 30 },
  { name: "Pemasangan behel", minutes: 90 },
  { name: "Veneer", minutes: 90 },
  { name: "Cabut gigi bungsu (odontektomi)", minutes: 90 },
  { name: "Pembuatan gigi tiruan", minutes: 60 },
];

const slotStarts = ["08:00", "09:30", "11:00", "13:00", "14:30", "16:00"];

function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function localDateString(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildAppointments() {
  const rows = [];
  for (let day = 0; day < DAY_COUNT; day += 1) {
    const date = localDateString(FIRST_DAY_OFFSET + day);
    for (let index = 0; index < APPOINTMENTS_PER_DAY; index += 1) {
      const sequence = day * APPOINTMENTS_PER_DAY + index;
      const treatment = treatments[sequence % treatments.length];
      const startTime = slotStarts[index % slotStarts.length];
      rows.push({
        id: `${SEED_PREFIX}${date}-${index + 1}`,
        patientName: patientNames[(sequence * 5) % patientNames.length],
        treatment: treatment.name,
        scheduledDate: new Date(`${date}T00:00:00.000Z`),
        startTime,
        endTime: addMinutes(startTime, treatment.minutes),
        phone: sequence % 4 === 3 ? null : `0812${String(34560000 + sequence * 7919).padStart(8, "0")}`,
        doctorIndex: day + index,
      });
    }
  }
  return rows;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seeder data pasien hanya untuk uji coba dan tidak boleh dijalankan di production.");
  }
  const clearOnly = process.argv.includes("--clear");

  const branch = await prisma.branch.findUnique({ where: { id: BRANCH_ID }, select: { id: true, name: true } });
  if (!branch) throw new Error(`Cabang "${BRANCH_ID}" belum ada. Jalankan "npm run db:seed" terlebih dahulu.`);
  const doctors = await prisma.doctor.findMany({ where: { branchId: branch.id }, select: { id: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  if (doctors.length === 0) throw new Error(`Cabang "${BRANCH_ID}" belum memiliki dokter. Jalankan "npm run db:seed" terlebih dahulu.`);

  const result = await prisma.$transaction(async (transaction) => {
    const removed = await transaction.appointment.deleteMany({ where: { branchId: branch.id, id: { startsWith: SEED_PREFIX } } });

    let created = 0;
    let skipped = 0;
    for (const { doctorIndex, ...row } of clearOnly ? [] : buildAppointments()) {
      const doctorId = doctors[doctorIndex % doctors.length].id;
      const conflict = await transaction.appointment.findFirst({
        where: { branchId: branch.id, scheduledDate: row.scheduledDate, doctorId, deletedAt: null, startTime: { lt: row.endTime }, endTime: { gt: row.startTime } },
        select: { id: true },
      });
      if (conflict) {
        skipped += 1;
        continue;
      }
      await transaction.appointment.create({ data: { ...row, branchId: branch.id, doctorId } });
      created += 1;
    }

    return { removed: removed.count, created, skipped };
  }, { timeout: 60_000 });

  console.log(`Cabang: ${branch.name}`);
  console.log(`Data uji coba lama dihapus: ${result.removed}`);
  if (!clearOnly) {
    console.log(`Jadwal pasien uji coba dibuat: ${result.created} (${localDateString(FIRST_DAY_OFFSET)} s.d. ${localDateString(FIRST_DAY_OFFSET + DAY_COUNT - 1)})`);
    if (result.skipped > 0) console.log(`Dilewati karena bentrok dengan jadwal yang sudah ada: ${result.skipped}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
