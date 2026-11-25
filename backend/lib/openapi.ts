const idParam = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "ID data (cuid)." } as const;
const pageParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 }, description: "Nomor halaman. Nilai di luar jangkauan dikembalikan ke halaman terakhir." },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1 }, description: "Jumlah data per halaman." },
] as const;
const rangeParams = [
  { name: "from", in: "query", required: true, schema: { type: "string", format: "date" }, example: "2026-09-05" },
  { name: "to", in: "query", required: true, schema: { type: "string", format: "date" }, example: "2026-10-04", description: "Paling jauh 5 tahun setelah `from`." },
  { name: "branchId", in: "query", schema: { type: "string" }, description: "Kosong berarti semua klinik." },
] as const;

const json = (schema: object, example?: unknown) => ({ "application/json": { schema, ...(example === undefined ? {} : { example }) } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (description: string, schema: object, example?: unknown) => ({ description, content: json(schema, example) });
const error = (description: string, message: string) => ({ description, content: json(ref("Error"), { error: message }) });

const unauthorized = error("Belum masuk, sesi habis, atau kata sandi akun baru saja diganti.", "Sesi admin tidak ditemukan");
const badOrigin = error("Role tidak berhak, atau header `Origin` bukan alamat frontend yang diizinkan.", "Asal permintaan tidak diizinkan");
const invalid = (message: string) => error("Data tidak lolos validasi. Hanya pesan kesalahan pertama yang dikembalikan.", message);
const success = ok("Berhasil.", { type: "object", properties: { success: { type: "boolean" } } }, { success: true });

const appointmentExample = {
  id: "cmg1x0abc0001xyz", patientName: "Budi Santoso", treatment: "Scaling", scheduledDate: "2026-10-04", startTime: "09:00", endTime: "09:30",
  phone: "081234567890", status: "SCHEDULED", doctorId: "sikligi-main-branch-drg-andini", doctorName: "Drg. Andini", branchName: "Sikligi Dental Care",
};
const ticketExample = {
  id: "cmg1x0tkt0001xyz", number: 3, title: "Jadwal tidak tersimpan", description: "Saat menekan tombol simpan jadwal, muncul pesan error dan data tidak masuk.",
  imageUrls: ["/Tiket-TT012-Gambar-1"], status: "OPEN", resolutionNote: null,
  createdAt: "2026-10-04T03:28:00.000Z", resolvedAt: null, seen: false, reporterRole: "ADMIN", branchName: "Sikligi Dental Care", assigneeName: null,
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Sikligi Patient Scheduler API",
    version: "1.0.0",
    description: [
      "API internal untuk jadwal pasien, dashboard owner, dan tiketing masalah website Sikligi Dental Care.",
      "",
      "**Autentikasi.** Masuk lewat `POST /auth/login`. Server mengirim cookie sesi HTTP-only `sikligi_admin` yang otomatis ikut pada permintaan berikutnya. Sesi berakhir setelah 15 menit tanpa permintaan, paling lama 8 jam sejak login, dan langsung gugur bila kata sandi akun diganti. Setiap permintaan yang berhasil memperpanjang batas 15 menit.",
      "",
      "**Role.** `ADMIN` mengelola jadwal kliniknya sendiri. `OWNER` melihat dashboard dan jadwal semua klinik, serta menghapus data periode. `DEVELOPER` (tim IT) mengerjakan tiket dan melihat dashboard serta jadwal tanpa dapat mengubahnya.",
      "",
      "**Perlindungan origin.** Semua permintaan yang mengubah data (POST, PUT, PATCH, DELETE) wajib membawa header `Origin` yang sama dengan `FRONTEND_ORIGIN`; selain itu dijawab 403.",
      "",
      "**Kesalahan.** Semua kesalahan berbentuk `{ \"error\": \"pesan\" }` dalam bahasa Indonesia.",
    ].join("\n"),
  },
  servers: [{ url: "/api", description: "Server ini" }],
  tags: [
    { name: "Autentikasi", description: "Login, sesi, dan preferensi akun." },
    { name: "Jadwal", description: "Jadwal pasien. Admin terbatas pada kliniknya; owner dan tim IT hanya dapat membaca, lintas klinik." },
    { name: "Dashboard", description: "Statistik kunjungan berstatus Selesai. Untuk owner dan tim IT; penghapusan periode hanya untuk owner." },
    { name: "Tiket", description: "Laporan masalah website dari admin/owner yang dikerjakan tim IT." },
  ],
  security: [{ cookieAuth: [] }],
  paths: {
    "/auth/login": {
      post: {
        tags: ["Autentikasi"], summary: "Masuk", security: [],
        description: "Memeriksa email dan kata sandi, lalu mengirim cookie sesi. Percobaan gagal yang berulang dari alamat yang sama diblokir selama 15 menit.",
        requestBody: { required: true, content: json(ref("LoginInput"), { email: "admin@sikligi.example", password: "kata-sandi-admin" }) },
        responses: {
          200: { description: "Berhasil masuk. Cookie `sikligi_admin` dikirim lewat header `Set-Cookie`.", content: json({ type: "object", properties: { admin: ref("Account") } }) },
          400: invalid("Format email tidak valid"),
          401: error("Email atau kata sandi salah.", "Email atau kata sandi tidak sesuai"),
          403: badOrigin,
          429: error("Terlalu banyak percobaan gagal.", "Terlalu banyak percobaan. Coba lagi dalam 15 menit."),
        },
      },
    },
    "/auth/session": {
      get: {
        tags: ["Autentikasi"], summary: "Akun yang sedang masuk",
        description: "Dipakai frontend saat halaman dibuka dan sebagai ping untuk memperpanjang sesi.",
        responses: { 200: ok("Sesi masih berlaku.", { type: "object", properties: { admin: ref("Account") } }), 401: unauthorized },
      },
      delete: {
        tags: ["Autentikasi"], summary: "Keluar", security: [],
        description: "Menghapus cookie sesi.",
        responses: { 200: success, 403: badOrigin },
      },
    },
    "/auth/preferences": {
      patch: {
        tags: ["Autentikasi"], summary: "Simpan pilihan mode gelap",
        description: "Disimpan per akun, jadi tidak memengaruhi akun lain.",
        requestBody: { required: true, content: json({ type: "object", required: ["darkMode"], properties: { darkMode: { type: "boolean" } } }, { darkMode: true }) },
        responses: { 200: ok("Tersimpan.", { type: "object", properties: { darkMode: { type: "boolean" } } }), 400: invalid("Pilihan mode gelap tidak valid."), 401: unauthorized, 403: badOrigin },
      },
    },
    "/appointments": {
      get: {
        tags: ["Jadwal"], summary: "Daftar jadwal",
        description: "Diurutkan menurut tanggal lalu jam mulai. Admin hanya menerima jadwal kliniknya yang belum dihapus. Owner dan tim IT menerima semua klinik, termasuk kunjungan Selesai yang sudah dihapus admin dari daftarnya, supaya cocok dengan angka dashboard.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Cari pada nama pasien, tindakan, atau telepon (tidak peka huruf besar/kecil)." },
          { name: "date", in: "query", schema: { type: "string", format: "date" }, description: "Hanya tanggal ini." },
          { name: "doctor", in: "query", schema: { type: "string" }, example: "Drg. Andini", description: "Nama dokter, persis." },
          { name: "branchId", in: "query", schema: { type: "string" }, description: "Hanya untuk owner dan tim IT; diabaikan untuk admin." },
          ...pageParams.map((param) => (param.name === "limit" ? { ...param, schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } } : param)),
        ],
        responses: { 200: ok("Satu halaman jadwal.", ref("AppointmentPage")), 400: invalid("Tanggal untuk menyaring jadwal tidak valid."), 401: unauthorized },
      },
      post: {
        tags: ["Jadwal"], summary: "Buat jadwal", description: "Khusus admin. Jadwal baru berstatus `SCHEDULED`. Bentrok diperiksa per dokter, klinik, dan tanggal di dalam transaksi.",
        requestBody: { required: true, content: json(ref("AppointmentInput"), { patientName: "Budi Santoso", treatment: "Scaling", doctorId: null, scheduledDate: "2026-10-04", startTime: "09:00", endTime: "09:30", phone: "081234567890" }) },
        responses: {
          201: ok("Jadwal dibuat.", { type: "object", properties: { appointment: ref("Appointment") } }, { appointment: appointmentExample }),
          400: invalid("Jam selesai harus setelah jam kedatangan"), 401: unauthorized,
          403: error("Owner dan tim IT hanya dapat melihat, atau origin tidak diizinkan.", "Akun ini hanya dapat melihat jadwal."),
          409: error("Jam bentrok dengan jadwal lain pada dokter yang sama, atau dokter bukan milik klinik ini.", "Jadwal bentrok dengan pasien lain pada dokter dan tanggal tersebut."),
        },
      },
    },
    "/appointments/export": {
      get: {
        tags: ["Jadwal"], summary: "Unduh jadwal sebagai Excel",
        description: "Menerima filter yang sama dengan daftar jadwal (tanpa pagination) dan mengembalikan seluruh hasilnya.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "date", in: "query", schema: { type: "string", format: "date" } },
          { name: "doctor", in: "query", schema: { type: "string" } },
          { name: "branchId", in: "query", schema: { type: "string" }, description: "Hanya untuk owner dan tim IT." },
        ],
        responses: {
          200: { description: "File .xlsx.", content: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } },
          400: invalid("Tanggal untuk menyaring jadwal tidak valid."), 401: unauthorized,
        },
      },
    },
    "/appointments/doctors": {
      get: {
        tags: ["Jadwal"], summary: "Daftar dokter",
        description: "Admin menerima dokter kliniknya (untuk form jadwal). Owner dan tim IT menerima dokter semua klinik (untuk filter). Dokter bawaan klinik berada paling atas.",
        responses: { 200: ok("Daftar dokter.", { type: "object", properties: { doctors: { type: "array", items: ref("Doctor") } } }), 401: unauthorized },
      },
    },
    "/appointments/availability": {
      get: {
        tags: ["Jadwal"], summary: "Jam yang sudah terisi",
        description: "Jam terisi seorang dokter pada satu tanggal di klinik akun yang sedang masuk. Dipakai form jadwal untuk memperingatkan bentrok sebelum menyimpan.",
        parameters: [
          { name: "date", in: "query", required: true, schema: { type: "string", format: "date" } },
          { name: "doctorId", in: "query", schema: { type: "string" }, description: "Kosong berarti dokter bawaan klinik." },
          { name: "excludeId", in: "query", schema: { type: "string" }, description: "ID jadwal yang sedang diubah, supaya tidak bentrok dengan dirinya sendiri." },
        ],
        responses: {
          200: ok("Daftar jam terisi, urut jam mulai.", { type: "object", properties: { busySlots: { type: "array", items: ref("BusySlot") } } }, { busySlots: [{ startTime: "09:00", endTime: "09:30" }] }),
          400: invalid("Tanggal untuk memeriksa ketersediaan tidak valid."), 401: unauthorized,
          409: error("Dokter bukan milik klinik ini.", "Dokter tidak tersedia untuk klinik ini."),
        },
      },
    },
    "/appointments/bulk-delete": {
      post: {
        tags: ["Jadwal"], summary: "Hapus beberapa jadwal", description: "Khusus admin, terbatas pada kliniknya. Jadwal `SCHEDULED` dihapus permanen. Kunjungan `COMPLETED` hanya disembunyikan dari daftar admin dan tetap dihitung di dashboard.",
        requestBody: { required: true, content: json({ type: "object", required: ["ids"], properties: { ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } } } }, { ids: ["cmg1x0abc0001xyz"] }) },
        responses: {
          200: ok("Jumlah yang dihapus permanen (`deleted`) dan yang hanya disembunyikan (`archived`).", { type: "object", properties: { deleted: { type: "integer" }, archived: { type: "integer" } } }, { deleted: 2, archived: 1 }),
          400: invalid("Pilih minimal satu jadwal."), 401: unauthorized, 403: badOrigin,
        },
      },
    },
    "/appointments/{id}": {
      put: {
        tags: ["Jadwal"], summary: "Ubah jadwal", description: "Khusus admin. Jadwal yang sudah `COMPLETED` tidak dapat diubah. `PATCH` pada alamat yang sama berperilaku identik.",
        parameters: [idParam],
        requestBody: { required: true, content: json(ref("AppointmentInput")) },
        responses: {
          200: ok("Jadwal diperbarui.", { type: "object", properties: { appointment: ref("Appointment") } }),
          400: invalid("Nama pasien wajib diisi"), 401: unauthorized, 403: badOrigin,
          404: error("Tidak ada, atau milik klinik lain.", "Jadwal tidak ditemukan"),
          409: error("Bentrok, sudah selesai, atau baru saja diubah orang lain.", "Jadwal yang sudah selesai tidak dapat diubah."),
        },
      },
      delete: {
        tags: ["Jadwal"], summary: "Hapus jadwal", description: "Khusus admin. Jadwal `SCHEDULED` dihapus permanen (`archived: false`). Kunjungan `COMPLETED` hanya disembunyikan dari daftar admin (`archived: true`).",
        parameters: [idParam],
        responses: {
          200: ok("Berhasil.", { type: "object", properties: { success: { type: "boolean" }, archived: { type: "boolean" } } }, { success: true, archived: false }),
          401: unauthorized, 403: badOrigin, 404: error("Tidak ada, atau milik klinik lain.", "Jadwal tidak ditemukan"),
        },
      },
    },
    "/appointments/{id}/status": {
      patch: {
        tags: ["Jadwal"], summary: "Tandai jadwal selesai",
        description: "Khusus admin. Hanya jadwal yang tanggalnya sudah tiba (waktu Indonesia Barat) yang dapat ditandai `COMPLETED`. Status Selesai bersifat final dan tidak dapat dikembalikan.",
        parameters: [idParam],
        requestBody: { required: true, content: json({ type: "object", required: ["status"], properties: { status: ref("AppointmentStatus") } }, { status: "COMPLETED" }) },
        responses: {
          200: ok("Status tersimpan.", { type: "object", properties: { status: ref("AppointmentStatus") } }, { status: "COMPLETED" }),
          400: invalid("Status jadwal tidak valid."), 401: unauthorized, 403: badOrigin,
          404: error("Tidak ada, atau milik klinik lain.", "Jadwal tidak ditemukan"),
          409: error("Tanggalnya belum tiba, atau jadwal sudah selesai.", "Jadwal yang belum tiba tanggalnya tidak dapat ditandai selesai."),
        },
      },
    },
    "/dashboard": {
      get: {
        tags: ["Dashboard"], summary: "Statistik kunjungan selesai",
        description: "Menghitung jadwal `COMPLETED` pada rentang tanggal. Rentang sampai 62 hari dirinci per hari, lebih panjang per bulan. `previousTotal` adalah jumlah pada rentang sepanjang sama tepat sebelum `from`.",
        parameters: [...rangeParams],
        responses: {
          200: ok("Statistik.", ref("DashboardData"), { granularity: "day", days: 3, total: 4, previousTotal: 2, series: [{ period: "2026-10-02", total: 1 }, { period: "2026-10-03", total: 2 }, { period: "2026-10-04", total: 1 }], byBranch: [{ branchId: "sikligi-main-branch", branchName: "Sikligi Dental Care", total: 4 }] }),
          400: invalid("Tanggal awal harus sebelum tanggal akhir"), 401: unauthorized,
          403: error("Admin tidak memiliki akses.", "Dashboard khusus untuk owner klinik."),
        },
      },
    },
    "/dashboard/branches": {
      get: {
        tags: ["Dashboard"], summary: "Daftar klinik", description: "Untuk pilihan filter klinik di dashboard dan daftar jadwal owner.",
        responses: { 200: ok("Daftar klinik, urut nama.", { type: "object", properties: { branches: { type: "array", items: ref("Branch") } } }), 401: unauthorized, 403: error("Admin tidak memiliki akses.", "Dashboard khusus untuk owner klinik.") },
      },
    },
    "/dashboard/purge": {
      get: {
        tags: ["Dashboard"], summary: "Pratinjau hapus data periode",
        description: "Khusus owner. Jumlah kunjungan `COMPLETED` yang akan terhapus. `to` harus sebelum hari ini.",
        parameters: [...rangeParams],
        responses: {
          200: ok("Jumlah kunjungan selesai pada periode itu.", { type: "object", properties: { completed: { type: "integer" } } }, { completed: 5 }),
          400: invalid("Hanya data sebelum hari ini yang dapat dihapus permanen."), 401: unauthorized,
          403: error("Bukan owner.", "Hanya owner yang dapat menghapus data periode."),
        },
      },
      post: {
        tags: ["Dashboard"], summary: "Hapus data periode",
        description: "Khusus owner. Menghapus permanen kunjungan `COMPLETED` pada periode lampau, termasuk yang sudah disembunyikan admin. Jadwal `SCHEDULED` tidak tersentuh. Tidak dapat dibatalkan.",
        requestBody: { required: true, content: json({ type: "object", required: ["from", "to"], properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, branchId: { type: "string", nullable: true } } }, { from: "2025-01-01", to: "2025-12-31", branchId: null }) },
        responses: {
          200: ok("Jumlah kunjungan yang dihapus.", { type: "object", properties: { deleted: { type: "integer" } } }, { deleted: 5 }),
          400: invalid("Hanya data sebelum hari ini yang dapat dihapus permanen."), 401: unauthorized,
          403: error("Bukan owner, atau origin tidak diizinkan.", "Hanya owner yang dapat menghapus data periode."),
        },
      },
    },
    "/tickets": {
      get: {
        tags: ["Tiket"], summary: "Daftar tiket",
        description: "Admin dan owner hanya menerima tiket yang mereka laporkan sendiri. Tim IT menerima semua tiket. Diurutkan dari yang terbaru.",
        parameters: [
          { name: "status", in: "query", schema: ref("TicketStatus"), description: "Nilai lain diabaikan." },
          ...pageParams.map((param) => (param.name === "limit" ? { ...param, schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } } : param)),
        ],
        responses: { 200: ok("Satu halaman tiket.", ref("TicketPage")), 401: unauthorized },
      },
      post: {
        tags: ["Tiket"], summary: "Laporkan masalah",
        description: "Untuk admin dan owner. Wajib melampirkan 1–2 screenshot sebagai data URL PNG atau JPG. Jenis file diperiksa dari isinya, gambar dirender ulang oleh Cloudinary, dan sisi terpendek minimal 100 piksel. Database hanya menyimpan URL gambarnya.",
        requestBody: { required: true, content: json(ref("TicketInput"), { title: "Jadwal tidak tersimpan", description: "Saat menekan tombol simpan jadwal, muncul pesan error dan data tidak masuk.", images: ["data:image/png;base64,iVBORw0KGgo..."] }) },
        responses: {
          201: ok("Tiket dibuat dengan status `OPEN`.", { type: "object", properties: { ticket: ref("Ticket") } }, { ticket: ticketExample }),
          400: invalid("Lampirkan minimal 1 screenshot."), 401: unauthorized,
          403: error("Akun tim IT tidak membuat tiket, atau origin tidak diizinkan.", "Akun tim IT tidak membuat tiket."),
          413: error("Gambar lebih dari 1,5 MB.", "Ukuran gambar terlalu besar."),
          502: error("Cloudinary gagal menerima gambar.", "Gambar gagal diunggah. Coba lagi."),
          503: error("Variabel `CLOUDINARY_*` belum diisi di server.", "Unggah gambar belum dikonfigurasi, sehingga tiket belum dapat dikirim. Hubungi tim IT."),
        },
      },
    },
    "/tickets/{id}": {
      patch: {
        tags: ["Tiket"], summary: "Ubah status tiket",
        description: "Khusus tim IT. Alurnya satu arah: `OPEN` → `IN_PROGRESS` → `RESOLVED`. Akun yang mengubah status tercatat sebagai penanggung jawab. Tiket yang sudah `RESOLVED` tidak dapat diubah lagi.",
        parameters: [idParam],
        requestBody: { required: true, content: json({ type: "object", required: ["status"], properties: { status: { type: "string", enum: ["IN_PROGRESS", "RESOLVED"] }, resolutionNote: { type: "string", maxLength: 1000, nullable: true, description: "Catatan untuk pelapor; hanya dipakai saat `RESOLVED`." } } }, { status: "RESOLVED", resolutionNote: "Sudah diperbaiki, silakan dicoba lagi." }) },
        responses: {
          200: ok("Tiket diperbarui.", { type: "object", properties: { ticket: ref("Ticket") } }),
          400: invalid("Status tiket tidak valid."), 401: unauthorized,
          403: error("Bukan tim IT, atau origin tidak diizinkan.", "Hanya tim IT yang dapat mengubah status tiket."),
          404: error("Tiket tidak ada.", "Tiket tidak ditemukan"),
          409: error("Tiket sudah selesai.", "Tiket yang sudah selesai tidak dapat diubah lagi."),
        },
      },
      delete: {
        tags: ["Tiket"], summary: "Batalkan atau hapus tiket",
        description: "Pelapor dapat membatalkan tiketnya sendiri selama masih `OPEN`. Tim IT dapat menghapus tiket yang sudah `RESOLVED`. Keduanya menghapus tiket secara permanen beserta gambarnya di Cloudinary.",
        parameters: [idParam],
        responses: {
          200: success, 401: unauthorized, 403: badOrigin,
          404: error("Tidak ada, atau bukan tiket milik akun ini.", "Tiket tidak ditemukan"),
          409: error("Status tiket tidak mengizinkan penghapusan oleh akun ini.", "Tiket yang sudah dikerjakan tim IT tidak dapat dibatalkan."),
        },
      },
    },
    "/tickets/image/{name}": {
      get: {
        tags: ["Tiket"], summary: "Ambil gambar tiket",
        description: "Gambar tiket privat di Cloudinary dan hanya diteruskan ke pelapor tiket atau tim IT yang sedang login. Alamat Cloudinary-nya tidak pernah dikirim ke browser.",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", pattern: "^Tiket-TT\\d+-Gambar-[1-9]$" }, example: "Tiket-TT012-Gambar-1", description: "Nomor tiket dan urutan gambarnya. Browser membukanya lewat alamat pendek `/Tiket-TT012-Gambar-1` di akar situs." }],
        responses: {
          200: { description: "Isi gambar.", content: { "image/jpeg": { schema: { type: "string", format: "binary" } }, "image/png": { schema: { type: "string", format: "binary" } } } },
          401: unauthorized,
          404: error("Tiket atau gambar tidak ada, atau bukan tiket milik akun ini.", "Gambar tidak ditemukan"),
          502: error("Cloudinary gagal memberikan gambar.", "Gambar gagal dimuat. Coba lagi."),
        },
      },
    },
    "/tickets/notifications": {
      get: {
        tags: ["Tiket"], summary: "Notifikasi tiket selesai",
        description: "Tiket milik akun ini yang sudah `RESOLVED` (paling banyak 30, terbaru lebih dulu) dan jumlah yang belum dibaca. Untuk admin dan owner.",
        responses: { 200: ok("Notifikasi.", { type: "object", properties: { tickets: { type: "array", items: ref("Ticket") }, unread: { type: "integer" } } }), 401: unauthorized },
      },
    },
    "/tickets/notifications/read": {
      post: {
        tags: ["Tiket"], summary: "Tandai notifikasi sudah dibaca", description: "Menandai semua notifikasi tiket selesai milik akun ini sebagai sudah dibaca.",
        responses: { 200: success, 401: unauthorized, 403: badOrigin },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "sikligi_admin", description: "Cookie sesi HTTP-only yang diperoleh dari `POST /auth/login`." },
    },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string", description: "Pesan kesalahan untuk ditampilkan ke pengguna." } } },
      Role: { type: "string", enum: ["ADMIN", "OWNER", "DEVELOPER"], description: "`DEVELOPER` ditampilkan ke pengguna sebagai \"Tim IT\"." },
      AppointmentStatus: { type: "string", enum: ["SCHEDULED", "COMPLETED"], description: "`SCHEDULED` = Terjadwal, `COMPLETED` = Selesai. Hanya `COMPLETED` yang dihitung di dashboard." },
      TicketStatus: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED"], description: "Menunggu, Dikerjakan, Selesai." },
      LoginInput: {
        type: "object", required: ["email", "password"],
        properties: { email: { type: "string", format: "email", maxLength: 254 }, password: { type: "string", minLength: 1, maxLength: 128 } },
      },
      Account: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" }, name: { type: "string", nullable: true, description: "Nama tampilan; diisi untuk akun tim IT." },
          branchName: { type: "string" }, darkMode: { type: "boolean" }, role: ref("Role"),
        },
        example: { email: "admin@sikligi.example", name: null, branchName: "Sikligi Dental Care", darkMode: false, role: "ADMIN" },
      },
      Branch: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, example: { id: "sikligi-main-branch", name: "Sikligi Dental Care" } },
      Doctor: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, isDefault: { type: "boolean", description: "Dipakai bila jadwal dibuat tanpa memilih dokter." }, branchId: { type: "string" } },
        example: { id: "sikligi-main-branch-drg-andini", name: "Drg. Andini", isDefault: true, branchId: "sikligi-main-branch" },
      },
      BusySlot: { type: "object", properties: { startTime: { type: "string", example: "09:00" }, endTime: { type: "string", example: "09:30" } } },
      AppointmentInput: {
        type: "object", required: ["patientName", "treatment", "scheduledDate", "startTime", "endTime"],
        properties: {
          patientName: { type: "string", minLength: 1, maxLength: 120 },
          treatment: { type: "string", minLength: 1, maxLength: 160 },
          doctorId: { type: "string", nullable: true, description: "Kosong atau null berarti dokter bawaan klinik (Drg. Andini)." },
          scheduledDate: { type: "string", format: "date" },
          startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "09:00" },
          endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "09:30", description: "Harus setelah `startTime`." },
          phone: { type: "string", pattern: "^\\d{8,15}$", nullable: true, description: "Hanya angka tanpa spasi, 8 sampai 15 angka." },
        },
      },
      Appointment: {
        type: "object",
        properties: {
          id: { type: "string" }, patientName: { type: "string" }, treatment: { type: "string" },
          scheduledDate: { type: "string", format: "date" }, startTime: { type: "string" }, endTime: { type: "string" },
          phone: { type: "string", nullable: true }, status: ref("AppointmentStatus"),
          doctorId: { type: "string" }, doctorName: { type: "string" }, branchName: { type: "string", nullable: true },
          completedAt: { type: "string", format: "date-time", nullable: true },
          deletedAt: { type: "string", format: "date-time", nullable: true, description: "Terisi bila kunjungan selesai sudah disembunyikan admin; hanya mungkin terlihat oleh owner dan tim IT." },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
        example: appointmentExample,
      },
      AppointmentPage: {
        type: "object",
        properties: { appointments: { type: "array", items: ref("Appointment") }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } },
      },
      DashboardData: {
        type: "object",
        properties: {
          granularity: { type: "string", enum: ["day", "month"] },
          days: { type: "integer", description: "Panjang rentang dalam hari." },
          total: { type: "integer" }, previousTotal: { type: "integer" },
          series: { type: "array", items: { type: "object", properties: { period: { type: "string", description: "`YYYY-MM-DD` atau `YYYY-MM`." }, total: { type: "integer" } } } },
          byBranch: { type: "array", items: { type: "object", properties: { branchId: { type: "string" }, branchName: { type: "string" }, total: { type: "integer" } } }, description: "Hanya klinik yang memiliki kunjungan, urut dari yang terbanyak." },
        },
      },
      TicketInput: {
        type: "object", required: ["title", "description", "images"],
        properties: {
          title: { type: "string", minLength: 8, maxLength: 120, description: "Minimal 2 kata; tanpa karakter yang diulang 5 kali berturut-turut." },
          description: { type: "string", minLength: 30, maxLength: 2000, description: "Minimal 5 kata; tidak boleh sama dengan judul." },
          images: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", description: "Data URL `data:image/png;base64,...` atau `data:image/jpeg;base64,...`, paling besar 1,5 MB." } },
        },
      },
      Ticket: {
        type: "object",
        properties: {
          id: { type: "string" }, number: { type: "integer", description: "Nomor urut lintas klinik; ditampilkan sebagai `#TT003`." },
          title: { type: "string" }, description: { type: "string" },
          imageUrls: { type: "array", items: { type: "string" }, description: "Alamat pendek di akar situs (bukan di bawah `/api`), diteruskan ke `GET /tickets/image/{name}`." }, status: ref("TicketStatus"),
          resolutionNote: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" }, resolvedAt: { type: "string", format: "date-time", nullable: true },
          seen: { type: "boolean", description: "Pelapor sudah membuka notifikasi penyelesaiannya." },
          reporterRole: ref("Role"), branchName: { type: "string", description: "Klinik akun pelapor." },
          assigneeName: { type: "string", nullable: true, description: "Nama tim IT yang menangani." },
        },
        example: ticketExample,
      },
      TicketPage: {
        type: "object",
        properties: { tickets: { type: "array", items: ref("Ticket") }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } },
      },
    },
  },
};

export function apiDocsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true";
}
