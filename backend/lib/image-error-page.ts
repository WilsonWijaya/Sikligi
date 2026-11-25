const messages: Record<number, { title: string; body: string; action: string }> = {
  401: {
    title: "Akses terbatas",
    body: "Gambar ini hanya dapat dibuka oleh staf klinik yang berwenang. Jika Anda staf, masuk terlebih dahulu.",
    action: "Masuk sebagai staf",
  },
  404: {
    title: "Gambar tidak ditemukan",
    body: "Gambar ini tidak ada, sudah dihapus bersama tiketnya, atau bukan lampiran tiket milik akun Anda.",
    action: "Kembali ke website",
  },
  502: {
    title: "Gambar gagal dimuat",
    body: "Gambar belum dapat diambil saat ini. Muat ulang halaman ini beberapa saat lagi.",
    action: "Kembali ke website",
  },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export function ticketImageErrorPage(status: number, branchName?: string) {
  const message = messages[status] ?? messages[502];
  const clinic = escapeHtml(branchName ?? "Sikligi Dental Care");
  const home = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const page = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${clinic} | ${message.title}</title>
  <style>
    @font-face { font-family: "Plus Jakarta Sans"; font-weight: 400; font-display: swap; src: url("/fonts/plus-jakarta-sans-latin-400-normal.woff2") format("woff2"); }
    @font-face { font-family: "Plus Jakarta Sans"; font-weight: 600; font-display: swap; src: url("/fonts/plus-jakarta-sans-latin-600-normal.woff2") format("woff2"); }
    @font-face { font-family: "Plus Jakarta Sans"; font-weight: 700; font-display: swap; src: url("/fonts/plus-jakarta-sans-latin-700-normal.woff2") format("woff2"); }
    @font-face { font-family: "Sora"; font-weight: 700; font-display: swap; src: url("/fonts/sora-latin-700-normal.woff2") format("woff2"); }
    :root { --ink: #0f172a; --muted: #64748b; --line: #e5eaf1; --paper: #ffffff; --canvas: #f5f8fc; --green: #0b6bdb; --green-soft: #eaf3fe; }
    :root[data-theme="dark"] { --ink: #e6edf6; --muted: #8d9bb0; --line: #22314a; --paper: #111c2d; --canvas: #0a1220; --green: #4da3ff; --green-soft: rgba(91, 155, 255, 0.14); color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--canvas); color: var(--ink); font-family: "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    main { width: 100%; max-width: 440px; padding: 36px 32px; border: 1px solid var(--line); border-radius: 18px; background: var(--paper); text-align: center; box-shadow: 0 10px 30px -12px rgba(15, 34, 56, 0.18); }
    .brand { margin: 0 0 22px; color: var(--green); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
    .badge { width: 56px; height: 56px; margin: 0 auto 18px; display: grid; place-items: center; border-radius: 50%; background: var(--green-soft); color: var(--green); }
    h1 { margin: 0 0 10px; font-family: "Sora", "Segoe UI", system-ui, sans-serif; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
    p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.65; }
    a { min-height: 42px; margin-top: 26px; padding: 0 20px; display: inline-flex; align-items: center; border-radius: 10px; background: var(--green); color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; }
    a:hover, a:focus-visible { box-shadow: 0 0 0 3px rgba(11, 107, 219, 0.22); outline: none; }
  </style>
  <script>
    try {
      var theme = localStorage.getItem("sikligi-theme");
      if (theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.dataset.theme = "dark";
    } catch (error) {}
  </script>
</head>
<body>
  <main>
    <p class="brand">${clinic}</p>
    <div class="badge" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
    </div>
    <h1>${message.title}</h1>
    <p>${message.body}</p>
    <a href="${home}">${message.action}</a>
  </main>
</body>
</html>`;
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
