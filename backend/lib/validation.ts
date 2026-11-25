import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Tanggal tidak valid");

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format waktu harus HH:mm");

export const loginInput = z.object({
  email: z.string({ error: "Email harus berupa teks." }).trim().email("Format email tidak valid").max(254, "Email maksimal 254 karakter").transform((value) => value.toLowerCase()),
  password: z.string({ error: "Kata sandi harus berupa teks." }).min(1, "Kata sandi wajib diisi").max(128, "Kata sandi maksimal 128 karakter"),
});

export const preferencesInput = z.object({
  darkMode: z.boolean({ error: "Pilihan mode gelap tidak valid." }),
});

export const bulkDeleteInput = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, "Pilih minimal satu jadwal.").max(100, "Maksimal 100 jadwal sekali hapus."),
});

export const statusInput = z.object({
  status: z.enum(["SCHEDULED", "COMPLETED"], { error: "Status jadwal tidak valid." }),
});

export const dashboardRange = z.object({
  from: dateOnly,
  to: dateOnly,
  branchId: z.string().min(1).max(64).nullable().optional().transform((value) => value || null),
}).refine((value) => value.from <= value.to, { message: "Tanggal awal harus sebelum tanggal akhir", path: ["to"] })
  .refine((value) => (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 <= 366 * 5, {
    message: "Rentang maksimal 5 tahun",
    path: ["to"],
  });

export const appointmentInput = z.object({
  patientName: z.string({ error: "Nama pasien harus berupa teks." }).trim().min(1, "Nama pasien wajib diisi").max(120, "Nama pasien maksimal 120 karakter"),
  treatment: z.string({ error: "Perawatan atau tindakan harus berupa teks." }).trim().min(1, "Perawatan atau tindakan wajib diisi").max(160, "Perawatan atau tindakan maksimal 160 karakter"),
  doctorId: z.string().min(1).max(64).nullable().optional().transform((value) => value || null),
  scheduledDate: dateOnly,
  startTime: time,
  endTime: time,
  phone: z.string().trim().max(20, "Nomor telepon maksimal 20 karakter").optional().nullable().transform((value) => value || null)
    .refine((value) => value === null || /^\d{8,15}$/.test(value), "Nomor telepon hanya boleh berisi angka tanpa spasi, 8 sampai 15 angka."),
}).refine((value) => value.endTime > value.startTime, {
  message: "Jam selesai harus setelah jam kedatangan",
  path: ["endTime"],
});

const wordCount = (value: string) => value.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
const letterCount = (value: string) => (value.match(/\p{L}/gu) ?? []).length;
const hasRepeatedCharacter = (value: string) => /(.)\1{4,}/u.test(value);
const collapseSpaces = (value: string) => value.trim().replace(/[ \t]+/g, " ");

export const ticketInput = z.object({
  title: z.string({ error: "Judul harus berupa teks." }).transform(collapseSpaces)
    .pipe(z.string().min(8, "Judul minimal 8 karakter").max(120, "Judul maksimal 120 karakter")
      .refine((value) => wordCount(value) >= 2, "Judul minimal 2 kata, misalnya \"Jadwal tidak tersimpan\".")
      .refine((value) => !hasRepeatedCharacter(value), "Judul tidak boleh berisi karakter yang diulang-ulang.")),
  description: z.string({ error: "Penjelasan harus berupa teks." }).transform(collapseSpaces)
    .pipe(z.string().min(30, "Penjelasan minimal 30 karakter").max(2000, "Penjelasan maksimal 2000 karakter")
      .refine((value) => wordCount(value) >= 5 && letterCount(value) >= 20, "Penjelasan minimal 5 kata. Ceritakan apa yang dilakukan dan apa yang terjadi.")
      .refine((value) => !hasRepeatedCharacter(value), "Penjelasan tidak boleh berisi karakter yang diulang-ulang.")),
  images: z.array(z.string().max(2_100_000, "Ukuran gambar terlalu besar."), { error: "Lampirkan minimal 1 screenshot." }).min(1, "Lampirkan minimal 1 screenshot.").max(2, "Maksimal 2 screenshot."),
}).refine((value) => value.description.toLowerCase() !== value.title.toLowerCase(), {
  message: "Penjelasan tidak boleh sama dengan judul.",
  path: ["description"],
});

export const ticketUpdateInput = z.object({
  status: z.enum(["IN_PROGRESS", "RESOLVED"], { error: "Status tiket tidak valid." }),
  resolutionNote: z.string().trim().max(1000, "Catatan maksimal 1000 karakter").optional().nullable().transform((value) => value || null),
});
