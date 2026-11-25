import { type FormEvent, Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  CircleCheck,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  LifeBuoy,
  LogOut,
  Moon,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Sun,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { API_URL, ApiResponseError, api, formatDate, notifySessionExpired, pageItems, setSessionExpiredHandler } from "./api";
import { DatePicker } from "./DatePicker";
import { Select } from "./Select";
import { Dashboard } from "./Dashboard";
import { TicketNotifications, Tickets } from "./Tickets";
import "./admin.css";
import "./theme.css";

type Admin = { email: string; name: string | null; branchName: string; darkMode: boolean; role: "ADMIN" | "OWNER" | "DEVELOPER" };
type View = "dashboard" | "schedule" | "tickets" | "notifications";
type NavItem = { key: View; label: string; icon: ReactNode; badge?: number };
type Branch = { id: string; name: string };
const homeView = (admin: Admin): View => (admin.role === "OWNER" ? "dashboard" : admin.role === "DEVELOPER" ? "tickets" : "schedule");
type Appointment = {
  id: string;
  patientName: string;
  treatment: string;
  doctorId: string;
  doctorName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  phone: string | null;
  status: "SCHEDULED" | "COMPLETED";
  branchName: string | null;
};
type AppointmentInput = Omit<Appointment, "id" | "doctorName" | "status" | "branchName">;
type Doctor = { id: string; name: string; isDefault: boolean; branchId: string };
type AppointmentPage = { appointments: Appointment[]; page: number; pageSize: number; total: number; totalPages: number };
type SuccessNotice = { title: string; message: string };
type BusySlot = { startTime: string; endTime: string };

const PAGE_SIZE = 10;

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function slotOverlaps(startTime: string, endTime: string, busySlots: BusySlot[]) {
  return startTime >= endTime || busySlots.some((slot) => slot.startTime < endTime && slot.endTime > startTime);
}

const blankForm = (): AppointmentInput => ({
  patientName: "",
  treatment: "",
  doctorId: "",
  scheduledDate: today(),
  startTime: "09:00",
  endTime: "09:30",
  phone: "",
});

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const IDLE_WARNING_MS = 60 * 1000;
const SESSION_PING_MS = 60 * 1000;
const SESSION_ENDED_MESSAGE = "Sesi berakhir karena tidak ada aktivitas selama 15 menit.\nSilakan masuk kembali.";

const ACTIVITY_KEY = "sikligi-last-activity";
function shareActivity(time: number) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(time));
  } catch {
    return;
  }
}
function sharedActivity() {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${value}T00:00:00`));
}

function ExcelIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="excel-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="2.5" width="15" height="19" rx="2" fill="#235da1" />
      <path d="M7 2.5h7.5v6.33H7z" fill="#3676c2" />
      <path d="M14.5 8.83H22v6.34h-7.5z" fill="#11427b" />
      <path d="M7 15.17h7.5v6.33H9a2 2 0 0 1-2-2z" fill="#18385c" />
      <path d="M14.5 15.17H22v4.33a2 2 0 0 1-2 2h-5.5z" fill="#142d49" />
      <rect x="2" y="6.5" width="11" height="11" rx="1.6" fill="#11427b" />
      <path d="m5.2 9.3 4.6 5.4m0-5.4-4.6 5.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    <div className="side-clock" role="timer" aria-label="Waktu saat ini">
      <span className="side-clock-label"><Clock3 size={13} /> <span>WAKTU SEKARANG</span></span>
      <strong>{pad(now.getHours())}:{pad(now.getMinutes())}<small>:{pad(now.getSeconds())}</small></strong>
      <span className="side-clock-date">{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</span>
    </div>
  );
}

function brandLines(branchName: string) {
  const words = branchName.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return { title: words[0] ?? "SIKLIGI", subtitle: words.slice(1).join(" ") };
}

async function offerToSavePassword(id: string, password: string) {
  type PasswordCredentialConstructor = new (data: { id: string; password: string; name?: string }) => Credential;
  const PasswordCredential = (window as unknown as { PasswordCredential?: PasswordCredentialConstructor }).PasswordCredential;
  if (!PasswordCredential || !navigator.credentials) return;
  try {
    await navigator.credentials.store(new PasswordCredential({ id, password, name: id }));
  } catch {
    return;
  }
}

function LoginGreeting() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const hour = now.getHours();
  const greeting = hour >= 4 && hour < 10 ? "Selamat pagi" : hour < 15 && hour >= 10 ? "Selamat siang" : hour >= 15 && hour < 18 ? "Selamat sore" : "Selamat malam";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
      <div className="brand-welcome">
        <span className="brand-welcome-copy">
          <strong>{greeting}</strong>
          <small>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</small>
        </span>
        <span className="brand-welcome-time" role="timer" aria-label="Waktu saat ini">{pad(hour)}:{pad(now.getMinutes())}</span>
      </div>
  );
}

function ToothIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5.5c-1.5-1.2-3-1.8-4.5-1.5C5.3 4.4 4 6.3 4 8.8c0 2 .7 3.6 1.3 5.2.5 1.4.7 3 1 4.5.2 1.2.7 2.5 1.7 2.5 1.1 0 1.4-1.3 1.7-2.6.3-1.5.8-3.4 2.3-3.4s2 1.9 2.3 3.4c.3 1.3.6 2.6 1.7 2.6 1 0 1.5-1.3 1.7-2.5.3-1.5.5-3.1 1-4.5.6-1.6 1.3-3.2 1.3-5.2 0-2.5-1.3-4.4-3.5-4.8-1.5-.3-3 .3-4.5 1.5z" />
    </svg>
  );
}

function BrandMark({ size = 18 }: { size?: number }) {
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  return (
    <span className="brand-mark">
      {logoUnavailable ? <Sparkles size={size} /> : <img src="/sikligi-logo.svg" alt="Logo Sikligi" onError={() => setLogoUnavailable(true)} />}
    </span>
  );
}

function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [view, setView] = useState<View>("schedule");
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const clearUnreadNotifications = useCallback(() => setUnreadNotifications(0), []);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  const lastActivityRef = useRef(0);
  const lastPingRef = useRef(0);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.dataset.theme === "dark");
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionError, setActionError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [form, setForm] = useState<AppointmentInput>(blankForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [completing, setCompleting] = useState<Appointment | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [successNotice, setSuccessNotice] = useState<SuccessNotice | null>(null);
  const [conflictNotice, setConflictNotice] = useState("");
  const [availabilityState, setAvailabilityState] = useState<{ key: string; busySlots: BusySlot[]; error: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const availabilityKey = admin && modalOpen
    ? `${admin.email}:${editing?.id ?? "new"}:${form.scheduledDate}:${form.doctorId || "default"}`
    : null;
  const currentAvailability = availabilityState?.key === availabilityKey ? availabilityState : null;
  const busySlots = currentAvailability?.busySlots ?? [];
  const checkingAvailability = Boolean(availabilityKey && !currentAvailability);
  const availabilityError = currentAvailability?.error ?? "";

  const loadAppointments = useCallback(async (search = query, targetPage = 1, date = dateFilter, doctor = doctorFilter) => {
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(targetPage) });
    if (search.trim()) params.set("q", search.trim());
    if (date) params.set("date", date);
    if (doctor) params.set("doctor", doctor);
    if (branchFilter) params.set("branchId", branchFilter);
    try {
      const result = await api<AppointmentPage>(`/appointments?${params}`);
      setAppointments(result.appointments);
      setSelectedIds(new Set());
      setPage(result.page);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Daftar jadwal tidak dapat dimuat");
      setAppointments([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [query, dateFilter, doctorFilter, branchFilter]);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    api<{ doctors: Doctor[] }>("/appointments/doctors")
      .then((result) => { if (active) setDoctors(result.doctors); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [admin]);

  useEffect(() => {
    if (admin?.role !== "OWNER" && admin?.role !== "DEVELOPER") return;
    let active = true;
    api<{ branches: Branch[] }>("/dashboard/branches")
      .then((result) => { if (active) setBranches(result.branches); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [admin?.role]);

  useEffect(() => {
    if (darkMode) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("sikligi-theme", darkMode ? "dark" : "light");
    } catch {
      return;
    }
  }, [darkMode]);

  useEffect(() => {
    document.title = `${admin?.branchName ?? "Sikligi Dental Care"} | Jadwal Pasien`;
  }, [admin]);

  useEffect(() => {
    let active = true;
    api<{ admin: Admin }>("/auth/session")
      .then((result) => { if (active) { setAdmin(result.admin); setView(homeView(result.admin)); setDarkMode(result.admin.darkMode); } })
      .catch(() => { if (active) { setAdmin(null); setDarkMode(false); } })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!admin || admin.role === "DEVELOPER" || view === "notifications") return;
    let active = true;
    api<{ unread: number }>("/tickets/notifications")
      .then((result) => { if (active) setUnreadNotifications(result.unread); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [admin, view]);

  useEffect(() => {
    if (!admin || view !== "schedule") return;
    const timer = window.setTimeout(() => void loadAppointments(query), 220);
    return () => window.clearTimeout(timer);
  }, [admin, view, query, loadAppointments]);

  useEffect(() => {
    if (!availabilityKey || !form.scheduledDate) return;
    const controller = new AbortController();
    const requestKey = availabilityKey;
    const params = new URLSearchParams({ date: form.scheduledDate });
    if (form.doctorId) params.set("doctorId", form.doctorId);
    if (editing) params.set("excludeId", editing.id);
    api<{ busySlots: BusySlot[] }>(`/appointments/availability?${params}`, { signal: controller.signal })
      .then((result) => setAvailabilityState({ key: requestKey, busySlots: result.busySlots, error: "" }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAvailabilityState({
          key: requestKey,
          busySlots: [],
          error: error instanceof Error ? error.message : "Jadwal yang tersedia tidak dapat diperiksa.",
        });
      });
    return () => controller.abort();
  }, [availabilityKey, editing, form.doctorId, form.scheduledDate]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLoginError("Masukkan alamat email yang valid.");
      return;
    }
    if (!password) {
      setLoginError("Kata sandi wajib diisi.");
      return;
    }
    setLoggingIn(true);
    try {
      const result = await api<{ admin: Admin }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      void offerToSavePassword(email.trim(), password);
      setAdmin(result.admin);
      setView(homeView(result.admin));
      setDarkMode(result.admin.darkMode);
      setPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login gagal");
    } finally {
      setLoggingIn(false);
    }
  }

  const allOnPageSelected = appointments.length > 0 && appointments.every((appointment) => selectedIds.has(appointment.id));

  async function downloadExcel() {
    setExporting(true);
    setActionError("");
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (dateFilter) params.set("date", dateFilter);
    if (doctorFilter) params.set("doctor", doctorFilter);
    if (branchFilter) params.set("branchId", branchFilter);
    try {
      const response = await fetch(`${API_URL}/appointments/export?${params}`, { credentials: "include" });
      if (response.status === 401) notifySessionExpired();
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "File Excel tidak dapat dibuat.");
      }
      const [year, month, day] = dateFilter.split("-");
      const datePart = dateFilter ? `${day}_${month}_${year.slice(2)}` : "Semua_Tanggal";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = `ADS_Jadwal_Pasien_${datePart}_${doctorFilter ? doctorFilter.replace(/[^A-Za-z0-9]+/g, "_") : "Semua_Dokter"}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      setSuccessNotice({ title: "File Excel berhasil diunduh", message: `File ${link.download} berisi ${total} jadwal sudah tersimpan di folder unduhan Anda.` });
    } catch (error) {
      setActionError(error instanceof TypeError ? "Tidak dapat terhubung ke server. Pastikan backend sedang berjalan." : error instanceof Error ? error.message : "File Excel tidak dapat dibuat.");
    } finally {
      setExporting(false);
    }
  }

  async function toggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    try {
      await api("/auth/preferences", { method: "PATCH", body: JSON.stringify({ darkMode: next }) });
    } catch {
      setDarkMode(!next);
    }
  }

  const returnToLogin = useCallback((message = "") => {
    setLogoutOpen(false);
    setModalOpen(false);
    setDeleting(null);
    setBulkDeleteOpen(false);
    setIdleSecondsLeft(null);
    setAdmin(null);
    setView("schedule");
    setBranchFilter("");
    setBranches([]);
    setDoctors([]);
    setDoctorFilter("");
    setUnreadNotifications(0);
    setDarkMode(false);
    setAppointments([]);
    setLoginError(message);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => returnToLogin(SESSION_ENDED_MESSAGE));
    return () => setSessionExpiredHandler(null);
  }, [returnToLogin]);

  const keepSessionAlive = useCallback(() => {
    lastActivityRef.current = Date.now();
    lastPingRef.current = Date.now();
    shareActivity(Date.now());
    setIdleSecondsLeft(null);
    void api("/auth/session").catch(() => returnToLogin(SESSION_ENDED_MESSAGE));
  }, [returnToLogin]);

  useEffect(() => {
    if (!admin) return;
    lastActivityRef.current = Date.now();
    lastPingRef.current = Date.now();
    shareActivity(Date.now());
    let lastShared = Date.now();
    const markActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastShared >= 5000) {
        lastShared = now;
        shareActivity(now);
      }
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, markActivity, { passive: true });
    const timer = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - Math.max(lastActivityRef.current, sharedActivity());
      if (idleFor >= IDLE_LIMIT_MS) {
        void api("/auth/session", { method: "DELETE" }).catch(() => undefined);
        returnToLogin(SESSION_ENDED_MESSAGE);
        return;
      }
      setIdleSecondsLeft(idleFor >= IDLE_LIMIT_MS - IDLE_WARNING_MS ? Math.ceil((IDLE_LIMIT_MS - idleFor) / 1000) : null);
      if (lastActivityRef.current > lastPingRef.current && now - lastPingRef.current >= SESSION_PING_MS) {
        lastPingRef.current = now;
        void api("/auth/session").catch(() => returnToLogin(SESSION_ENDED_MESSAGE));
      }
    }, 1000);
    return () => {
      for (const name of events) window.removeEventListener(name, markActivity);
      window.clearInterval(timer);
    };
  }, [admin, returnToLogin]);

  async function handleLogout() {
    setLoggingOut(true);
    await api("/auth/session", { method: "DELETE" }).catch(() => undefined);
    setLoggingOut(false);
    returnToLogin();
  }

  function openCreate() {
    setEditing(null);
    setAvailabilityState(null);
    setForm(blankForm());
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(appointment: Appointment) {
    setEditing(appointment);
    setAvailabilityState(null);
    setForm({
      ...appointment,
      phone: appointment.phone ?? "",
    });
    setFormError("");
    setModalOpen(true);
  }

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    const payload = { ...form, phone: form.phone?.trim() || null, doctorId: form.doctorId || null };
    const time24Hour = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!payload.patientName.trim() || !payload.treatment.trim()) {
      setFormError("Nama pasien dan perawatan atau tindakan wajib diisi.");
      setSaving(false);
      return;
    }
    if (payload.phone && !/^\d{8,15}$/.test(payload.phone)) {
      setFormError("Nomor telepon hanya boleh berisi angka tanpa spasi, 8 sampai 15 angka.");
      setSaving(false);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.scheduledDate)) {
      setFormError("Tanggal kedatangan wajib diisi dengan benar.");
      setSaving(false);
      return;
    }
    if (!time24Hour.test(payload.startTime) || !time24Hour.test(payload.endTime)) {
      setFormError("Isi jam dengan format 24 jam HH:mm, misalnya 09:10.");
      setSaving(false);
      return;
    }
    if (slotOverlaps(payload.startTime, payload.endTime, busySlots)) {
      setConflictNotice("Waktu yang dipilih bertabrakan dengan jadwal lain pada dokter dan tanggal tersebut. Pilih waktu yang tersedia.");
      setSaving(false);
      return;
    }
    if (checkingAvailability || availabilityError) {
      setFormError(availabilityError || "Tunggu sampai ketersediaan jadwal selesai diperiksa.");
      setSaving(false);
      return;
    }
    if (payload.endTime <= payload.startTime) {
      setFormError("Jam selesai harus setelah jam kedatangan.");
      setSaving(false);
      return;
    }
    try {
      const wasEditing = Boolean(editing);
      await api(editing ? `/appointments/${editing.id}` : "/appointments", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setModalOpen(false);
      setEditing(null);
      await loadAppointments(query, page);
      setSuccessNotice(wasEditing
        ? { title: "Jadwal diperbarui", message: "Perubahan jadwal pasien berhasil disimpan." }
        : { title: "Jadwal dibuat", message: "Jadwal pasien berhasil ditambahkan." });
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        setConflictNotice(error.message);
      } else {
        setFormError(error instanceof Error ? error.message : "Jadwal tidak dapat disimpan");
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelectedIds(allOnPageSelected ? new Set() : new Set(appointments.map((appointment) => appointment.id)));
  }

  async function confirmBulkDelete() {
    setBulkDeleting(true);
    setBulkDeleteError("");
    try {
      const result = await api<{ deleted: number; archived: number }>("/appointments/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      setBulkDeleteOpen(false);
      await loadAppointments(query, page);
      setSuccessNotice({
        title: "Jadwal dihapus",
        message: `${result.deleted + result.archived} jadwal pasien berhasil dihapus.`,
      });
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : "Jadwal tidak dapat dihapus");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function toggleCompleted(appointment: Appointment) {
    const status = appointment.status === "COMPLETED" ? "SCHEDULED" : "COMPLETED";
    setStatusUpdating(appointment.id);
    setActionError("");
    try {
      await api(`/appointments/${appointment.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setAppointments((current) => current.map((item) => (item.id === appointment.id ? { ...item, status } : item)));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Status jadwal tidak dapat diubah.");
    } finally {
      setStatusUpdating(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError("");
    const patientName = deleting.patientName;
    try {
      await api(`/appointments/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await loadAppointments(query, page);
      setSuccessNotice({
        title: "Jadwal dihapus",
        message: `Jadwal pasien ${patientName} berhasil dihapus.`,
      });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Jadwal tidak dapat dihapus");
    }
  }

  if (checkingSession) {
    return <main className="session-check"><span className="loading-mark"><ToothIcon size={22} /></span><p>Menyiapkan ruang kerja...</p></main>;
  }

  if (!admin) {
    return (
      <main className="login-screen">
        <section className="login-brand">
          <div className="brand-lockup"><BrandMark size={19} /><span>SIKLIGI<small>DENTAL CARE</small></span></div>
          <div className="brand-message">
            <LoginGreeting />
            <span className="eyebrow">RUANG KERJA KLINIK</span>
            <h1>Perawatan baik dimulai dari jadwal yang tertata.</h1>
            <p>Kelola kunjungan pasien Sikligi dalam satu ruang kerja.</p>
            <ul className="brand-values">
              <li><Check size={14} /> Rapi</li>
              <li><Check size={14} /> Aman</li>
              <li><Check size={14} /> Terpercaya</li>
            </ul>
          </div>
          <div className="brand-foot"><span><ShieldCheck size={15} /> Akses khusus administrator</span><span>INDONESIA</span></div>
          <div className="brand-orbit orbit-one" /><div className="brand-orbit orbit-two" />
        </section>
        <section className="login-panel">
          <form className="login-form" onSubmit={handleLogin} noValidate>
            <div className="mobile-brand"><BrandMark size={18} /><strong>SIKLIGI <small>DENTAL CARE</small></strong></div>
            <span className="eyebrow">SELAMAT DATANG</span>
            <h2>Masuk ke ruang admin</h2>
            <p className="form-intro">Gunakan akun administrator klinik untuk melanjutkan.</p>
            <label htmlFor="email">Email administrator</label>
            <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@klinik.com" required />
            <label htmlFor="password">Kata sandi</label>
            <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan kata sandi" required />
            {loginError && <p className="inline-error" role="alert">{loginError}</p>}
            <button className="button button-primary login-submit" type="submit" disabled={loggingIn} aria-busy={loggingIn}>
              {loggingIn ? <><LoaderCircle className="login-loading-icon" size={18} /> Memeriksa akun...</> : "Masuk"}
            </button>
            <p className="login-note"><ShieldCheck size={17} /> Halaman ini hanya untuk akses internal klinik.</p>
          </form>
          <p className="login-copyright">&copy; {new Date().getFullYear()} Sikligi Dental Care. All Rights Reserved</p>
        </section>
      </main>
    );
  }

  const isOwner = admin.role === "OWNER";
  const doctorFormOptions = doctors.map((doctor) => ({ value: doctor.id, label: doctor.name }));
  const doctorFilterOptions = [{ value: "", label: "Semua dokter" }, ...[...new Set(doctors.map((doctor) => doctor.name))].map((name) => ({ value: name, label: name }))];
  const isDeveloper = admin.role === "DEVELOPER";
  const readOnly = isOwner || isDeveloper;
  const activeView: View = (view === "dashboard" && !readOnly) || (view === "notifications" && isDeveloper) ? "schedule" : view;
  const showDashboard = activeView === "dashboard";
  const clinicItems: NavItem[] = [
    ...(readOnly ? [{ key: "dashboard" as const, label: "Dashboard", icon: <ChartColumn size={18} /> }] : []),
    { key: "schedule", label: "Jadwal pasien", icon: <CalendarDays size={18} /> },
  ];
  const helpItems: NavItem[] = [
    { key: "tickets", label: "Tiketing", icon: <LifeBuoy size={18} /> },
    ...(isDeveloper ? [] : [{ key: "notifications" as const, label: "Notifikasi", icon: <Bell size={18} />, badge: unreadNotifications }]),
  ];
  const navGroups = [{ label: "KLINIK", items: clinicItems }, { label: isDeveloper ? "PENANGANAN" : "BANTUAN", items: helpItems }].filter((group) => group.items.length > 0);
  const viewTitle = [...clinicItems, ...helpItems].find((item) => item.key === activeView)?.label ?? "Jadwal pasien";
  const roleLabel = isOwner ? "owner" : isDeveloper ? "tim IT" : "admin";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup" title={admin.branchName}><BrandMark size={18} /><span>{brandLines(admin.branchName).title}{brandLines(admin.branchName).subtitle && <small>{brandLines(admin.branchName).subtitle}</small>}</span></div>
        <LiveClock />
        {navGroups.map((group) => (
          <Fragment key={group.label}>
            <div className="side-label">{group.label}</div>
            {group.items.map((item) => (
              <button key={item.key} className={`side-link${activeView === item.key ? " active" : ""}`} aria-current={activeView === item.key ? "page" : undefined} aria-label={item.badge ? `${item.label}, ${item.badge} belum dibaca` : item.label} title={item.label} onClick={() => setView(item.key)}>{item.icon}<span>{item.label}</span>{item.badge ? <span className="side-badge" aria-label={`${item.badge} belum dibaca`}>{item.badge}</span> : activeView === item.key && <span className="side-dot" />}</button>
            ))}
          </Fragment>
        ))}
        <div className="side-label">TAMPILAN</div>
        <button className="side-link theme-toggle" role="switch" aria-checked={darkMode} aria-label="Mode gelap" title="Mode gelap" onClick={() => void toggleDarkMode()}>{darkMode ? <Moon size={18} /> : <Sun size={18} />}<span>Mode gelap</span><span className="theme-switch" /></button>
        <div className="sidebar-bottom">
          <div className="secure-note"><ShieldCheck size={17} /><span><strong>{isOwner || isDeveloper ? "Semua klinik" : admin.branchName}</strong><small>Akses {roleLabel} aktif</small></span></div>
          <div className="profile-card">
            <span className="avatar">{admin.email.slice(0, 1).toUpperCase()}</span>
            <span className="profile-copy"><strong>{isOwner ? "Nadia Pratiwi (Owner)" : isDeveloper ? `${admin.name ?? "Tim IT"} (Tim IT)` : "Administrator"}</strong><small title={admin.email}>{admin.email}</small></span>
          </div>
          <button className="logout-button" aria-label="Keluar dari akun" onClick={() => setLogoutOpen(true)}><LogOut size={16} /><span>Keluar</span></button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><span className="breadcrumb">Ruang kerja <ChevronRight size={14} /> <strong>{viewTitle}</strong></span><span className="today-chip"><span className="online-dot" /> SISTEM AKTIF <span className="topbar-divider" /> {new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span><button className="topbar-theme" aria-label={darkMode ? "Ganti ke mode terang" : "Ganti ke mode gelap"} onClick={() => void toggleDarkMode()}>{darkMode ? <Sun size={15} /> : <Moon size={15} />}</button><button className="topbar-logout" aria-label="Keluar dari akun" onClick={() => setLogoutOpen(true)}><LogOut size={15} /> Keluar</button></header>
        <nav className="mobile-nav" aria-label="Menu">
          {navGroups.flatMap((group) => group.items).map((item) => (
            <button key={item.key} className={`date-chip${activeView === item.key ? " active" : ""}`} aria-current={activeView === item.key ? "page" : undefined} aria-label={item.badge ? `${item.label}, ${item.badge} belum dibaca` : item.label} title={item.label} onClick={() => setView(item.key)}>{item.label}{item.badge ? ` (${item.badge})` : ""}</button>
          ))}
        </nav>
        {showDashboard ? <Dashboard branches={branches} canPurge={isOwner} onNotice={setSuccessNotice} />
          : activeView === "tickets" ? <Tickets isDeveloper={isDeveloper} onNotice={setSuccessNotice} />
          : activeView === "notifications" ? <TicketNotifications onRead={clearUnreadNotifications} />
          : <>
        <section className="page-heading">
          {readOnly
            ? <div><span className="eyebrow">PEMANTAUAN KUNJUNGAN</span><h1>Jadwal pasien</h1><p>Lihat jadwal kunjungan semua klinik. Akun {roleLabel} hanya dapat melihat.</p></div>
            : <div><span className="eyebrow">PENGELOLAAN KUNJUNGAN</span><h1>Jadwal pasien</h1><p>Catat dan pantau jadwal kunjungan klinik.</p></div>}
          {!readOnly && <button className="button button-primary create-button" onClick={openCreate}><Plus size={17} /> Jadwalkan pasien</button>}
        </section>

        <section className="schedule-toolbar" aria-label="Filter jadwal">
          <div className="list-heading"><span className="list-icon"><CalendarDays size={18} /></span><div><h2>Daftar kunjungan</h2><p>Diurutkan berdasarkan tanggal dan waktu kedatangan</p></div></div>
          <label className="search-box"><Search size={17} /><input ref={searchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, tindakan, atau telepon" /><kbd>/</kbd></label>
        </section>

        <section className="date-filter-bar" aria-label="Saring berdasarkan tanggal dan dokter">
          <span className="date-filter-label">Tampilkan tanggal</span>
          <div className="date-chips">
            <button className={`date-chip${dateFilter === "" ? " active" : ""}`} aria-pressed={dateFilter === ""} onClick={() => setDateFilter("")}>Semua tanggal</button>
            <button className={`date-chip${dateFilter === today() ? " active" : ""}`} aria-pressed={dateFilter === today()} onClick={() => setDateFilter(today())}>Hari ini</button>
            <button className={`date-chip${dateFilter === tomorrow() ? " active" : ""}`} aria-pressed={dateFilter === tomorrow()} onClick={() => setDateFilter(tomorrow())}>Besok</button>
          </div>
          <DatePicker id="dateFilter" value={dateFilter} onChange={setDateFilter} />
          <span className="filter-group">
            <label className="date-filter-label" htmlFor="doctorFilter">Dokter</label>
            <Select id="doctorFilter" value={doctorFilter} onChange={setDoctorFilter} options={doctorFilterOptions} />
          </span>
          {readOnly && <span className="filter-group">
            <label className="date-filter-label" htmlFor="branchFilter">Klinik</label>
            <Select id="branchFilter" value={branchFilter} onChange={setBranchFilter} options={[{ value: "", label: "Semua klinik" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]} />
          </span>}
          <button className="button button-soft export-button" disabled={exporting || total === 0} onClick={() => void downloadExcel()}><Download size={15} /> {exporting ? "Menyiapkan..." : "Unduh Excel"} <ExcelIcon size={18} /></button>
        </section>
        {actionError && <p className="inline-error export-error" role="alert">{actionError}</p>}

        {selectedIds.size > 0 && (
          <section className="bulk-bar" aria-label="Aksi untuk jadwal terpilih">
            <strong>{selectedIds.size} jadwal dipilih</strong>
            <button className="text-button" onClick={toggleSelectPage}>{allOnPageSelected ? "Batalkan semua" : "Pilih semua di halaman ini"}</button>
            <span className="bulk-bar-actions">
              <button className="button button-plain" onClick={() => setSelectedIds(new Set())}>Batal</button>
              <button className="button button-danger" onClick={() => { setBulkDeleteError(""); setBulkDeleteOpen(true); }}><Trash2 size={15} /> Hapus terpilih</button>
            </span>
          </section>
        )}

        <section className={`table-frame${readOnly ? " read-only" : ""}`} aria-label="Daftar jadwal pasien">
          <div className="table-head">{!readOnly && <span className="select-cell"><input type="checkbox" className="row-check" aria-label="Pilih semua jadwal di halaman ini" checked={allOnPageSelected} disabled={appointments.length === 0} onChange={toggleSelectPage} /></span>}<span className="number-heading">NO</span><span>PASIEN</span><span>PERAWATAN</span><span>TANGGAL KEDATANGAN</span><span>WAKTU KUNJUNGAN</span><span className="dental-heading">DOKTER</span>{!readOnly && <span className="actions-heading">TINDAKAN</span>}</div>
          {loading && appointments.length === 0 && <div className="table-state"><span className="spinner" /> Memuat daftar pasien...</div>}
          {!loading && listError && <div className="table-state state-error"><strong>Jadwal belum dapat dimuat.</strong><span>{listError}</span><button className="text-button" onClick={() => void loadAppointments(query, page)}>Coba lagi</button></div>}
          {!loading && !listError && appointments.length === 0 && <div className="empty-state"><span className="empty-icon"><CalendarDays size={24} /></span><strong>{query ? "Pasien tidak ditemukan" : dateFilter || doctorFilter ? "Tidak ada jadwal yang cocok dengan filter" : "Belum ada jadwal pasien"}</strong><p>{query ? "Coba kata pencarian yang berbeda." : dateFilter || doctorFilter ? "Ubah tanggal atau dokter yang dipilih." : "Jadwal baru akan muncul di sini setelah ditambahkan."}</p>{!readOnly && !query && !dateFilter && !doctorFilter && <button className="button button-soft" onClick={openCreate}><Plus size={16} /> Buat jadwal pertama</button>}</div>}
          {appointments.map((appointment, index) => (
            <Fragment key={appointment.id}>
            {appointment.scheduledDate !== appointments[index - 1]?.scheduledDate && (
              <div className="date-group"><CalendarDays size={13} /><strong>{formatLongDate(appointment.scheduledDate)}</strong>{appointment.scheduledDate === today() && <em>Hari ini</em>}</div>
            )}
            <article className={`appointment-row${selectedIds.has(appointment.id) ? " selected" : ""}`} style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}>
              {!readOnly && <div className="select-cell"><input type="checkbox" className="row-check" aria-label={`Pilih jadwal ${appointment.patientName}`} checked={selectedIds.has(appointment.id)} onChange={() => toggleSelected(appointment.id)} /></div>}
              <div className="visit-number-cell"><span className="visit-number">{(page - 1) * PAGE_SIZE + index + 1}</span></div>
              <div className="patient-cell"><span className="patient-avatar">{appointment.patientName.trim().slice(0, 1).toUpperCase()}</span><span className="patient-copy"><strong>{appointment.patientName}</strong><small>{appointment.phone || "Nomor telepon tidak dicantumkan"}</small></span></div>
              <div className="treatment-cell"><strong>{appointment.treatment}</strong></div>
              <div className="date-cell"><strong>{formatDate(appointment.scheduledDate)}</strong><small>{readOnly ? appointment.branchName : appointment.scheduledDate === today() ? "Hari ini" : "Jadwal kunjungan"}</small></div>
              <div className="time-cell"><span className="time-pill"><Clock3 size={14} /> {appointment.startTime} <ChevronRight size={13} /> {appointment.endTime}</span>{appointment.status === "COMPLETED" ? <span className="status-badge status-completed"><Check size={11} /> Selesai</span> : <span className="status-badge">Terjadwal</span>}</div>
              <div className="dental-unit-cell"><span className="doctor-name">{appointment.doctorName}</span></div>
              {!readOnly && <div className="row-actions">{appointment.status === "COMPLETED"
                ? <span className="done-mark" role="img" aria-label="Sudah selesai"><i><Check size={11} strokeWidth={3.2} /></i></span>
                : <button className="icon-button success-icon" aria-label={`Tandai selesai ${appointment.patientName}`} disabled={statusUpdating === appointment.id || appointment.scheduledDate > today()} onClick={() => setCompleting(appointment)}><CircleCheck size={16} /></button>}<button className="icon-button" aria-label={`Ubah jadwal ${appointment.patientName}`} disabled={appointment.status === "COMPLETED"} onClick={() => openEdit(appointment)}><Pencil size={16} /></button><button className="icon-button danger-icon" aria-label={`Hapus jadwal ${appointment.patientName}`} onClick={() => { setDeleting(appointment); setDeleteError(""); }}><Trash2 size={16} /></button></div>}
            </article>
            </Fragment>
          ))}
          {loading && appointments.length > 0 && <div className="loading-more"><span className="spinner" /> Memperbarui daftar...</div>}
        </section>
        <footer className="list-footer">
          <span>{total === 0 ? "Tidak ada jadwal untuk ditampilkan" : <>Menampilkan <strong>{(page - 1) * PAGE_SIZE + 1} – {(page - 1) * PAGE_SIZE + appointments.length}</strong> dari <strong>{total}</strong> jadwal</>}</span>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Halaman daftar jadwal">
              <button className="page-button page-step" disabled={loading || page <= 1} onClick={() => void loadAppointments(query, page - 1)}><ChevronLeft size={14} /> Sebelumnya</button>
              {pageItems(page, totalPages).map((item, index) => item === "gap"
                ? <span className="page-gap" key={`gap-${index}`}>…</span>
                : <button className={`page-button${item === page ? " active" : ""}`} key={item} disabled={loading} aria-label={`Halaman ${item}`} aria-current={item === page ? "page" : undefined} onClick={() => item !== page && void loadAppointments(query, item)}>{item}</button>)}
              <button className="page-button page-step" disabled={loading || page >= totalPages} onClick={() => void loadAppointments(query, page + 1)}>Berikutnya <ChevronRight size={14} /></button>
            </nav>
          )}
        </footer>
        </>}
      </main>

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
        <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="appointment-title">
          <header className="modal-header"><span className="modal-icon"><CalendarDays size={19} /></span><button className="icon-button close-button" aria-label="Tutup" onClick={() => setModalOpen(false)}><X size={18} /></button></header>
          <span className="eyebrow">DATA KUNJUNGAN</span><h2 id="appointment-title">{editing ? "Ubah jadwal pasien" : "Jadwalkan pasien"}</h2><p className="modal-intro">Lengkapi detail kunjungan pasien di bawah ini.</p>
          <form className="appointment-form" onSubmit={saveAppointment} noValidate>
            <label htmlFor="patientName">Nama pasien <span>*</span></label><input id="patientName" autoFocus maxLength={120} value={form.patientName} onChange={(event) => setForm({ ...form, patientName: event.target.value })} placeholder="Nama lengkap pasien" required />
            <label htmlFor="treatment">Perawatan atau tindakan <span>*</span></label><input id="treatment" maxLength={160} value={form.treatment} onChange={(event) => setForm({ ...form, treatment: event.target.value })} placeholder="Contoh: Scaling gigi" required />
            <label htmlFor="doctorId">Dokter</label><Select id="doctorId" variant="field" value={form.doctorId} disabled={checkingAvailability} onChange={(doctorId) => setForm({ ...form, doctorId })} options={doctorFormOptions} />
            <label htmlFor="scheduledDate">Tanggal kedatangan <span>*</span></label><DatePicker id="scheduledDate" value={form.scheduledDate} onChange={(scheduledDate) => setForm({ ...form, scheduledDate })} />
            <div className="time-fields"><div><label htmlFor="startTime">Jam kedatangan <span>*</span></label><input id="startTime" type="text" inputMode="text" maxLength={5} placeholder="09:00" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required /></div><div><label htmlFor="endTime">Jam selesai <span>*</span></label><input id="endTime" type="text" inputMode="text" maxLength={5} placeholder="09:30" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required /></div></div>
            <p className={availabilityError ? "availability-note availability-error" : "availability-note"} role={availabilityError ? "alert" : undefined}>{availabilityError || (checkingAvailability ? "Memeriksa bentrok jadwal..." : "Format 24 jam HH:mm, misalnya 09:10. Bentrok akan ditolak saat disimpan.")}</p>
            <label htmlFor="phone">Nomor telepon <small>(opsional)</small></label><input id="phone" type="tel" maxLength={20} value={form.phone ?? ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Contoh: 081234567890" />
            {formError && <p className="inline-error" role="alert">{formError}</p>}
            <div className="modal-actions"><button type="button" className="button button-plain" onClick={() => setModalOpen(false)}>Batal</button><button type="submit" className="button button-primary" disabled={saving || checkingAvailability || Boolean(availabilityError)}>{saving ? "Menyimpan..." : <><Check size={16} /> {editing ? "Simpan perubahan" : "Simpan jadwal"}</>}</button></div>
          </form>
        </section>
      </div>}

      {bulkDeleteOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkDeleting) setBulkDeleteOpen(false); }}>
        <section className="confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="bulk-delete-title" aria-describedby="bulk-delete-description">
          <span className="delete-mark"><Trash2 size={20} /></span><span className="eyebrow">HAPUS JADWAL</span><h2 id="bulk-delete-title">Hapus {selectedIds.size} jadwal?</h2><p id="bulk-delete-description"><strong>{selectedIds.size} jadwal pasien</strong> yang dipilih akan dihapus dari daftar jadwal.</p>
          {bulkDeleteError && <p className="inline-error" role="alert">{bulkDeleteError}</p>}
          <div className="modal-actions"><button className="button button-plain" autoFocus disabled={bulkDeleting} onClick={() => setBulkDeleteOpen(false)}>Batal</button><button className="button button-danger" disabled={bulkDeleting} onClick={() => void confirmBulkDelete()}><Trash2 size={16} /> {bulkDeleting ? "Menghapus..." : `Hapus ${selectedIds.size} jadwal`}</button></div>
        </section>
      </div>}

      {deleting && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleting(null); }}>
        <section className="confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <span className="delete-mark"><Trash2 size={20} /></span><span className="eyebrow">HAPUS JADWAL</span><h2 id="delete-title">Hapus jadwal ini?</h2><p id="delete-description">Jadwal untuk <strong>{deleting.patientName}</strong> pada {formatDate(deleting.scheduledDate)} akan dihapus dari daftar jadwal.</p>
          {deleteError && <p className="inline-error" role="alert">{deleteError}</p>}
          <div className="modal-actions"><button className="button button-plain" onClick={() => setDeleting(null)}>Batal</button><button className="button button-danger" onClick={() => void confirmDelete()}><Trash2 size={16} /> Hapus jadwal</button></div>
        </section>
      </div>}

      {completing && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompleting(null); }}>
        <section className="confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="complete-title" aria-describedby="complete-description">
          <span className="delete-mark logout-mark"><CircleCheck size={20} /></span><span className="eyebrow">TANDAI SELESAI</span><h2 id="complete-title">Tandai kunjungan selesai?</h2><p id="complete-description">Kunjungan <strong>{completing.patientName}</strong> ({completing.treatment}) pada {formatDate(completing.scheduledDate)} pukul {completing.startTime} – {completing.endTime} akan ditandai Selesai. Setelah itu jadwal ini tidak dapat diubah lagi.</p>
          <div className="modal-actions"><button className="button button-plain" autoFocus onClick={() => setCompleting(null)}>Batal</button><button className="button button-primary" onClick={() => { const target = completing; setCompleting(null); void toggleCompleted(target); }}><CircleCheck size={16} /> Tandai selesai</button></div>
        </section>
      </div>}

      {idleSecondsLeft !== null && <div className="modal-backdrop conflict-backdrop">
        <section className="conflict-panel" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-description">
          <span className="conflict-mark"><Clock3 size={22} /></span>
          <h2 id="idle-title">Sesi akan berakhir</h2>
          <p id="idle-description">Tidak ada aktivitas selama hampir 15 menit. Anda akan keluar otomatis dalam <strong>{idleSecondsLeft} detik</strong>.</p>
          <div className="modal-actions"><button className="button button-plain" onClick={() => void handleLogout()}>Keluar sekarang</button><button className="button button-primary" autoFocus onClick={keepSessionAlive}>Tetap masuk</button></div>
        </section>
      </div>}

      {logoutOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !loggingOut) setLogoutOpen(false); }}>
        <section className="confirm-panel logout-panel" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description">
          <span className="delete-mark logout-mark"><LogOut size={20} /></span><h2 id="logout-title">Keluar dari akun?</h2><p id="logout-description">{isOwner
            ? <>Sesi owner <strong>{admin.email}</strong> akan diakhiri. Anda perlu masuk kembali untuk memantau perkembangan dan jadwal kunjungan klinik.</>
            : isDeveloper ? <>Sesi tim IT <strong>{admin.email}</strong> akan diakhiri. Anda perlu masuk kembali untuk mengerjakan tiket.</>
            : <>Sesi admin <strong>{admin.email}</strong> akan diakhiri. Anda perlu masuk kembali untuk mengelola jadwal pasien.{modalOpen && " Isian form jadwal yang belum disimpan akan hilang."}</>}</p>
          <div className="modal-actions"><button className="button button-plain" autoFocus disabled={loggingOut} onClick={() => setLogoutOpen(false)}>Batal</button><button className="button button-primary" disabled={loggingOut} onClick={() => void handleLogout()}><LogOut size={16} /> {loggingOut ? "Keluar..." : "Keluar"}</button></div>
        </section>
      </div>}

      {successNotice && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSuccessNotice(null); }}>
        <section className="success-panel" role="dialog" aria-modal="true" aria-labelledby="success-title" aria-describedby="success-description">
          <span className="success-mark"><CircleCheck size={23} /></span>
          <h2 id="success-title">{successNotice.title}</h2>
          <p id="success-description">{successNotice.message}</p>
          <div className="modal-actions"><button className="button button-primary" autoFocus onClick={() => setSuccessNotice(null)}>Tutup</button></div>
        </section>
      </div>}

      {conflictNotice && <div className="modal-backdrop conflict-backdrop">
        <section className="conflict-panel" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description">
          <span className="conflict-mark"><CircleAlert size={22} /></span>
          <h2 id="conflict-title">Jadwal bertabrakan</h2>
          <p id="conflict-description">{conflictNotice}</p>
          <div className="modal-actions"><button className="button button-primary" autoFocus onClick={() => setConflictNotice("")}>Pilih waktu lain</button></div>
        </section>
      </div>}
    </div>
  );
}

export default App;
