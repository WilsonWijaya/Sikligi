export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeContent: "center", padding: 24, background: "#f5f8fc", color: "#0f172a", fontFamily: "\"Segoe UI\", system-ui, sans-serif" }}>
      <section style={{ maxWidth: 560 }}>
        <p style={{ color: "#0a5fc2", fontSize: 12, fontWeight: 700, letterSpacing: ".2em" }}>SIKLIGI DENTAL CARE</p>
        <h1 style={{ margin: "12px 0", fontSize: 30 }}>Layanan API jadwal pasien</h1>
        <p style={{ color: "#696f76", lineHeight: 1.7 }}>Backend aktif untuk aplikasi admin. Gunakan frontend React untuk mengelola jadwal kunjungan.</p>
      </section>
    </main>
  );
}
