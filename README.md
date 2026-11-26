# Sikligi Patient Scheduler

Sikligi merupakan sistem penjadwalan pasien berbasis web untuk internal klinik gigi yang membantu staf mengelola jadwal kunjungan di setiap cabang klinik. Admin mengatur jadwal, owner memantau perkembangan kunjungan lewat dashboard, dan developer menangani laporan masalah website melalui fitur tiket.

## Fitur

- **Login khusus staf klinik** untuk admin, owner, dan developer. Tidak ada pendaftaran publik.
- **Jadwal pasien:** tambah, ubah, cari, dan hapus jadwal. Setiap jadwal mencatat nama pasien, perawatan/tindakan, dokter, tanggal, jam mulai dan selesai, serta nomor telepon (opsional).
- **Pilihan dokter per klinik**, dengan dokter bawaan bila dokter tidak dipilih.
- **Cegah jadwal bentrok:** jam yang sudah terisi untuk dokter yang sama pada tanggal yang sama tidak bisa dipakai lagi.
- **Status kunjungan:** jadwal ditandai **Selesai** setelah pasien ditangani.
- **Filter dan pencarian** berdasarkan tanggal, dokter, klinik, nama pasien, perawatan, atau nomor telepon, dengan daftar yang terurut dan bernomor.
- **Hapus banyak jadwal sekaligus.**
- **Ekspor jadwal ke Excel.**
- **Multi-cabang:** setiap admin hanya melihat dan mengelola jadwal cabangnya sendiri.
- **Dashboard owner:** grafik kunjungan selesai per hari atau per bulan, filter periode dan cabang, serta perbandingan dengan periode sebelumnya. Owner juga dapat melihat jadwal semua cabang dan menghapus data kunjungan lama per periode.
- **Tiket masalah website:** admin dan owner melaporkan masalah beserta screenshot, lalu memantau statusnya. Developer mengerjakan tiket dan menandainya selesai. Tiket yang sudah selesai muncul di menu **Notifikasi**.
- **Mode gelap** dan tampilan yang menyesuaikan layar ponsel.
- **Keamanan:** kata sandi disimpan dalam bentuk hash, sesi login otomatis berakhir bila tidak ada aktivitas, dan gambar tiket hanya bisa dibuka oleh pengguna yang berhak.
