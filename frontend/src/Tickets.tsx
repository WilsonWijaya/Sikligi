import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { Bell, Check, ChevronLeft, ChevronRight, ImagePlus, LifeBuoy, Maximize2, Plus, Trash2, Wrench, X } from "lucide-react";
import { SITE_URL, api, pageItems } from "./api";
import { Select } from "./Select";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type Ticket = {
  id: string;
  number: number;
  title: string;
  description: string;
  imageUrls: string[];
  status: TicketStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  seen: boolean;
  reporterRole: "ADMIN" | "OWNER" | "DEVELOPER";
  branchName: string;
  assigneeName: string | null;
};
type TicketPage = { tickets: Ticket[]; page: number; pageSize: number; total: number; totalPages: number };
type Notice = { title: string; message: string };

const MAX_IMAGES = 2;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: "Menunggu", IN_PROGRESS: "Dikerjakan", RESOLVED: "Selesai" };
const REPORTER_LABEL: Record<Ticket["reporterRole"], string> = { ADMIN: "Admin", OWNER: "Owner", DEVELOPER: "Tim IT" };
const STATUS_OPTIONS = [
  { value: "", label: "Semua status" },
  { value: "OPEN", label: STATUS_LABEL.OPEN },
  { value: "IN_PROGRESS", label: STATUS_LABEL.IN_PROGRESS },
  { value: "RESOLVED", label: STATUS_LABEL.RESOLVED },
];

function ticketCode(number: number) {
  return `#TT${String(number).padStart(3, "0")}`;
}

function ticketTextError(rawTitle: string, rawDescription: string) {
  const collapse = (value: string) => value.trim().replace(/[ \t]+/g, " ");
  const words = (value: string) => value.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
  const letters = (value: string) => (value.match(/\p{L}/gu) ?? []).length;
  const repeated = (value: string) => /(.)\1{4,}/u.test(value);
  const title = collapse(rawTitle);
  const description = collapse(rawDescription);
  if (title.length < 8) return "Judul minimal 8 karakter.";
  if (words(title) < 2) return "Judul minimal 2 kata, misalnya \"Jadwal tidak tersimpan\".";
  if (repeated(title)) return "Judul tidak boleh berisi karakter yang diulang-ulang.";
  if (description.length < 30) return "Penjelasan minimal 30 karakter.";
  if (words(description) < 5 || letters(description) < 20) return "Penjelasan minimal 5 kata. Ceritakan apa yang dilakukan dan apa yang terjadi.";
  if (repeated(description)) return "Penjelasan tidak boleh berisi karakter yang diulang-ulang.";
  if (description.toLowerCase() === title.toLowerCase()) return "Penjelasan tidak boleh sama dengan judul.";
  return "";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${day}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function compressImage(file: File) {
  const bitmap = await createImageBitmap(file);
  if (bitmap.width < 100 || bitmap.height < 100) {
    bitmap.close();
    throw new Error("Gambar terlalu kecil untuk sebuah screenshot (minimal 100 × 100 piksel).");
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(Math.round(bitmap.width * scale), 1);
  canvas.height = Math.max(Math.round(bitmap.height * scale), 1);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gambar tidak dapat diproses di browser ini.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function TicketCard({ ticket, showReporter, actions }: { ticket: Ticket; showReporter: boolean; actions?: ReactNode }) {
  return (
    <article className="ticket-card">
      <header className="ticket-card-head">
        <span className="ticket-number">{ticketCode(ticket.number)}</span>
        <h3>{ticket.title}</h3>
        <span className={`ticket-status ticket-${ticket.status.toLowerCase()}`}>{STATUS_LABEL[ticket.status]}</span>
      </header>
      <p className="ticket-meta">
        Dilaporkan {formatDateTime(ticket.createdAt)}
        {showReporter && <> oleh {REPORTER_LABEL[ticket.reporterRole]}{ticket.reporterRole !== "OWNER" && <> {ticket.branchName}</>}</>}
        {ticket.assigneeName && <>. Ditangani oleh <strong>{ticket.assigneeName}</strong></>}
      </p>
      <p className="ticket-description">{ticket.description}</p>
      {ticket.imageUrls.length > 0 && (
        <div className="ticket-images">
          {ticket.imageUrls.map((path, index) => (
            <a key={path} href={`${SITE_URL}${path}`} target="_blank" rel="noreferrer" aria-label={`Buka gambar ${index + 1} tiket ${ticketCode(ticket.number)}`}><img src={`${SITE_URL}${path}`} alt={`Lampiran ${index + 1}`} loading="lazy" /></a>
          ))}
        </div>
      )}
      {ticket.status === "RESOLVED" && (
        <p className="ticket-resolution">
          <strong>Diselesaikan{ticket.resolvedAt ? ` ${formatDateTime(ticket.resolvedAt)}` : ""}.</strong> {ticket.resolutionNote ?? "Tidak ada catatan dari tim IT."}
        </p>
      )}
      {actions && <div className="ticket-actions">{actions}</div>}
    </article>
  );
}

export function Tickets({ isDeveloper, onNotice }: { isDeveloper: boolean; onNotice: (notice: Notice) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);

  const [updating, setUpdating] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Ticket | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolveError, setResolveError] = useState("");
  const [removing, setRemoving] = useState<Ticket | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const load = useCallback(async (status: string, targetPage = 1) => {
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ page: String(targetPage) });
    if (status) params.set("status", status);
    try {
      const result = await api<TicketPage>(`/tickets?${params}`);
      setTickets(result.tickets);
      setPage(result.page);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Daftar tiket tidak dapat dimuat");
      setTickets([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(statusFilter), 0);
    return () => window.clearTimeout(timer);
  }, [statusFilter, load]);

  function openForm() {
    setTitle("");
    setDescription("");
    setImages([]);
    setPreviewIndex(null);
    setFormError("");
    setFormOpen(true);
  }

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setFormError("");
    if (files.length + images.length > MAX_IMAGES) {
      setFormError(`Maksimal ${MAX_IMAGES} gambar per tiket.`);
      return;
    }
    if (files.some((file) => !["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_SOURCE_BYTES)) {
      setFormError("Gambar harus berformat PNG atau JPG dengan ukuran maksimal 10 MB.");
      return;
    }
    try {
      const compressed = await Promise.all(files.map(compressImage));
      setImages((current) => [...current, ...compressed].slice(0, MAX_IMAGES));
    } catch (error) {
      setFormError(error instanceof Error && error.message.startsWith("Gambar terlalu kecil") ? error.message : "Gambar tidak dapat dibaca. Coba file lain.");
    }
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const textError = ticketTextError(title, description);
    if (textError) {
      setFormError(textError);
      return;
    }
    if (images.length === 0) {
      setFormError("Lampirkan minimal 1 screenshot agar tim IT mengetahui bagian mana yang bermasalah.");
      return;
    }
    setSending(true);
    try {
      const result = await api<{ ticket: Ticket }>("/tickets", { method: "POST", body: JSON.stringify({ title, description, images }) });
      setFormOpen(false);
      setStatusFilter("");
      await load("", 1);
      onNotice({ title: "Tiket terkirim", message: `Tiket ${ticketCode(result.ticket.number)} sudah diteruskan ke tim IT. Anda akan mendapat notifikasi setelah selesai dikerjakan.` });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Tiket tidak dapat dikirim");
    } finally {
      setSending(false);
    }
  }

  const canRemove = (ticket: Ticket) => ticket.status === (isDeveloper ? "RESOLVED" : "OPEN");

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError("");
    const code = ticketCode(removing.number);
    try {
      await api(`/tickets/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await load(statusFilter, page);
      onNotice(isDeveloper
        ? { title: "Tiket dihapus", message: `Tiket ${code} beserta gambarnya sudah dihapus.` }
        : { title: "Tiket dibatalkan", message: `Tiket ${code} sudah dibatalkan dan tidak diteruskan ke tim IT.` });
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Tiket tidak dapat dihapus");
    } finally {
      setRemoveBusy(false);
    }
  }

  async function updateStatus(ticket: Ticket, status: "IN_PROGRESS" | "RESOLVED", note?: string) {
    setUpdating(ticket.id);
    setResolveError("");
    setListError("");
    try {
      await api(`/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify({ status, resolutionNote: note ?? null }) });
      setResolving(null);
      await load(statusFilter, page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Status tiket tidak dapat diubah";
      if (status === "RESOLVED") setResolveError(message);
      else setListError(message);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <>
      <section className="page-heading">
        {isDeveloper
          ? <div><span className="eyebrow">PENANGANAN MASALAH</span><h1>Tiketing</h1><p>Tiket masalah website dari admin dan owner semua klinik.</p></div>
          : <div><span className="eyebrow">BANTUAN WEBSITE</span><h1>Tiketing</h1><p>Laporkan masalah atau error pada website ini kepada tim IT.</p></div>}
        {!isDeveloper && <button className="button button-primary create-button" onClick={openForm}><Plus size={17} /> Laporkan masalah</button>}
      </section>

      <section className="schedule-toolbar" aria-label="Saring tiket">
        <div className="list-heading"><span className="list-icon"><LifeBuoy size={18} /></span><div><h2>{isDeveloper ? "Semua tiket" : "Tiket saya"}</h2><p>Diurutkan dari yang paling baru</p></div></div>
        <span className="ticket-filter"><label className="date-filter-label" htmlFor="ticketStatus">Status</label><Select id="ticketStatus" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} /></span>
      </section>

      {listError && <p className="inline-error export-error" role="alert">{listError}</p>}
      <section className="ticket-list" aria-label="Daftar tiket" aria-busy={loading}>
        {loading && tickets.length === 0 && <div className="table-state"><span className="spinner" /> Memuat tiket...</div>}
        {!loading && !listError && tickets.length === 0 && (
          <div className="empty-state"><span className="empty-icon"><LifeBuoy size={24} /></span><strong>{statusFilter ? "Tidak ada tiket dengan status ini" : "Belum ada tiket"}</strong><p>{isDeveloper ? "Tiket baru dari admin atau owner akan muncul di sini." : "Tiket yang Anda laporkan akan muncul di sini."}</p></div>
        )}
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            showReporter={isDeveloper}
            actions={isDeveloper ? (
              <>
                {canRemove(ticket) && <button className="button button-plain" onClick={() => { setRemoveError(""); setRemoving(ticket); }}><Trash2 size={15} /> Hapus tiket</button>}
                {ticket.status === "OPEN" && <button className="button button-soft" disabled={updating === ticket.id} onClick={() => void updateStatus(ticket, "IN_PROGRESS")}><Wrench size={15} /> Kerjakan</button>}
                {ticket.status !== "RESOLVED" && <button className="button button-primary" disabled={updating === ticket.id} onClick={() => { setResolutionNote(""); setResolveError(""); setResolving(ticket); }}><Check size={15} /> Tandai selesai</button>}
              </>
            ) : canRemove(ticket) && <button className="button button-plain" onClick={() => { setRemoveError(""); setRemoving(ticket); }}><X size={15} /> Batalkan tiket</button>}
          />
        ))}
      </section>
      <footer className="list-footer">
        <span>{total === 0 ? "Tidak ada tiket untuk ditampilkan" : <>Menampilkan <strong>{tickets.length}</strong> dari <strong>{total}</strong> tiket</>}</span>
        {totalPages > 1 && (
          <nav className="pagination" aria-label="Halaman daftar tiket">
            <button className="page-button page-step" disabled={loading || page <= 1} onClick={() => void load(statusFilter, page - 1)}><ChevronLeft size={14} /> Sebelumnya</button>
            {pageItems(page, totalPages).map((item, index) => item === "gap"
              ? <span className="page-gap" key={`gap-${index}`}>…</span>
              : <button className={`page-button${item === page ? " active" : ""}`} key={item} disabled={loading} aria-label={`Halaman ${item}`} aria-current={item === page ? "page" : undefined} onClick={() => item !== page && void load(statusFilter, item)}>{item}</button>)}
            <button className="page-button page-step" disabled={loading || page >= totalPages} onClick={() => void load(statusFilter, page + 1)}>Berikutnya <ChevronRight size={14} /></button>
          </nav>
        )}
      </footer>

      {formOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) setFormOpen(false); }}>
        <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ticket-title">
          <header className="modal-header"><span className="modal-icon"><LifeBuoy size={19} /></span><button className="icon-button close-button" aria-label="Tutup" disabled={sending} onClick={() => setFormOpen(false)}><X size={18} /></button></header>
          <span className="eyebrow">TIKET BARU</span><h2 id="ticket-title">Laporkan masalah</h2><p className="modal-intro">Jelaskan masalah atau error yang Anda temui di website ini, disertai screenshot-nya.</p>
          <form className="appointment-form" onSubmit={submitTicket} noValidate>
            <label htmlFor="ticketTitle">Judul <span>*</span></label>
            <input id="ticketTitle" autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Contoh: Jadwal tidak bisa disimpan" required />
            <label htmlFor="ticketDescription">Penjelasan masalah <span>*</span></label>
            <textarea id="ticketDescription" rows={5} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Apa yang Anda lakukan, apa yang terjadi, dan pesan error yang muncul." required />
            <label htmlFor="ticketImages">Screenshot masalah <span>*</span> <small>(maksimal {MAX_IMAGES})</small></label>
            <div className="ticket-upload">
              {images.map((image, index) => (
                <span className="ticket-thumb" key={image.slice(-40) + index}>
                  <button type="button" className="thumb-view" aria-label={`Lihat gambar ${index + 1} dalam ukuran besar`} onClick={() => setPreviewIndex(index)}><img src={image} alt={`Gambar ${index + 1}`} /><span><Maximize2 size={13} /> Lihat</span></button>
                  <button type="button" className="thumb-remove" aria-label={`Hapus gambar ${index + 1}`} onClick={() => setImages((current) => current.filter((_, position) => position !== index))}><X size={13} /></button>
                </span>
              ))}
              {images.length < MAX_IMAGES && (
                <label className="ticket-add" htmlFor="ticketImages"><ImagePlus size={18} /><span>Tambah gambar</span>
                  <input id="ticketImages" type="file" accept="image/png,image/jpeg" multiple onChange={(event) => void addImages(event)} />
                </label>
              )}
            </div>
            {formError && <p className="inline-error" role="alert">{formError}</p>}
            <div className="modal-actions"><button type="button" className="button button-plain" disabled={sending} onClick={() => setFormOpen(false)}>Batal</button><button type="submit" className="button button-primary" disabled={sending}>{sending ? "Mengirim..." : <><Check size={16} /> Kirim tiket</>}</button></div>
          </form>
        </section>
      </div>}

      {formOpen && previewIndex !== null && images[previewIndex] && <div className="modal-backdrop image-preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewIndex(null); }}>
        <section className="image-preview-panel" role="dialog" aria-modal="true" aria-label={`Pratinjau gambar ${previewIndex + 1}`}>
          <header><strong>Gambar {previewIndex + 1} dari {images.length}</strong><button type="button" className="icon-button" aria-label="Tutup pratinjau" autoFocus onClick={() => setPreviewIndex(null)}><X size={18} /></button></header>
          <img src={images[previewIndex]} alt={`Pratinjau gambar ${previewIndex + 1}`} />
          <p>Gambar tersebut akan dikirim bersama tiket. Jika keliru, tutup pratinjau lalu hapus dan ganti gambarnya.</p>
        </section>
      </div>}

      {removing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !removeBusy) setRemoving(null); }}>
        <section className="confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-description">
          <span className="delete-mark"><Trash2 size={20} /></span><span className="eyebrow">TIKET {ticketCode(removing.number)}</span>
          <h2 id="remove-title">{isDeveloper ? "Hapus tiket ini?" : "Batalkan tiket ini?"}</h2>
          <p id="remove-description">Tiket <strong>{removing.title}</strong> beserta gambarnya akan terhapus{isDeveloper ? " dan tidak dapat dipulihkan. Tiket ini juga hilang dari daftar tiket dan notifikasi pelapornya." : " dan tidak diteruskan ke tim IT."}</p>
          {isDeveloper && !removing.seen && <p className="inline-error" role="alert">Pelapor belum membuka notifikasi penyelesaian tiket ini. Jika dihapus sekarang, pelapor tidak akan tahu bahwa masalahnya sudah diselesaikan.</p>}
          {removeError && <p className="inline-error" role="alert">{removeError}</p>}
          <div className="modal-actions"><button className="button button-plain" autoFocus disabled={removeBusy} onClick={() => setRemoving(null)}>Kembali</button><button className="button button-danger" disabled={removeBusy} onClick={() => void confirmRemove()}><Trash2 size={16} /> {removeBusy ? "Menghapus..." : isDeveloper ? "Hapus tiket" : "Batalkan tiket"}</button></div>
        </section>
      </div>}

      {resolving && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && updating === null) setResolving(null); }}>
        <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="resolve-title">
          <span className="eyebrow">TIKET {ticketCode(resolving.number)}</span><h2 id="resolve-title">Tandai tiket selesai</h2><p className="modal-intro">{resolving.title}. Pelapor akan menerima notifikasi beserta catatan di bawah ini.</p>
          <div className="appointment-form">
            <label htmlFor="resolutionNote">Catatan penyelesaian <small>(opsional)</small></label>
            <textarea id="resolutionNote" autoFocus rows={4} maxLength={1000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Apa yang diperbaiki atau yang perlu dilakukan pelapor." />
            {resolveError && <p className="inline-error" role="alert">{resolveError}</p>}
            <div className="modal-actions"><button type="button" className="button button-plain" disabled={updating !== null} onClick={() => setResolving(null)}>Batal</button><button type="button" className="button button-primary" disabled={updating !== null} onClick={() => void updateStatus(resolving, "RESOLVED", resolutionNote)}><Check size={16} /> {updating ? "Menyimpan..." : "Tandai selesai"}</button></div>
          </div>
        </section>
      </div>}
    </>
  );
}

export function TicketNotifications({ onRead }: { onRead: () => void }) {
  const [state, setState] = useState<{ tickets: Ticket[]; error: string } | null>(null);

  useEffect(() => {
    let active = true;
    api<{ tickets: Ticket[]; unread: number }>("/tickets/notifications")
      .then((result) => {
        if (!active) return;
        setState({ tickets: result.tickets, error: "" });
        if (result.unread > 0) void api("/tickets/notifications/read", { method: "POST" }).then(onRead).catch(() => undefined);
      })
      .catch((error) => { if (active) setState({ tickets: [], error: error instanceof Error ? error.message : "Notifikasi tidak dapat dimuat" }); });
    return () => { active = false; };
  }, [onRead]);

  return (
    <>
      <section className="page-heading">
        <div><span className="eyebrow">TIKET SELESAI</span><h1>Notifikasi</h1><p>Tiket Anda yang sudah diselesaikan tim IT.</p></div>
      </section>
      {state?.error && <p className="inline-error export-error" role="alert">{state.error}</p>}
      <section className="ticket-list" aria-label="Daftar notifikasi">
        {!state && <div className="table-state"><span className="spinner" /> Memuat notifikasi...</div>}
        {state && !state.error && state.tickets.length === 0 && (
          <div className="empty-state"><span className="empty-icon"><Bell size={24} /></span><strong>Belum ada notifikasi</strong><p>Tiket yang selesai dikerjakan tim IT akan muncul di sini.</p></div>
        )}
        {state?.tickets.map((ticket) => (
          <div className={`ticket-notice${ticket.seen ? "" : " unread"}`} key={ticket.id}>
            {!ticket.seen && <span className="ticket-new">Baru</span>}
            <TicketCard ticket={ticket} showReporter={false} />
          </div>
        ))}
      </section>
    </>
  );
}
