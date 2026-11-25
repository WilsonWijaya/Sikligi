import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarCheck, ChartColumn, Minus, ShieldAlert, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { api, formatDate } from "./api";
import { DatePicker } from "./DatePicker";
import { Select } from "./Select";

type Branch = { id: string; name: string };
type Notice = { title: string; message: string };
type Point = { period: string; total: number };
type DashboardData = {
  granularity: "day" | "month";
  days: number;
  total: number;
  previousTotal: number;
  series: Point[];
  byBranch: { branchId: string; branchName: string; total: number }[];
};
type Preset = "30d" | "90d" | "12m" | "year" | "custom";

const numberFormat = new Intl.NumberFormat("id-ID");

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localKey(date);
}

function presetRange(preset: Exclude<Preset, "custom">) {
  const now = new Date();
  if (preset === "30d") return { from: shiftDays(-29), to: localKey(now) };
  if (preset === "90d") return { from: shiftDays(-89), to: localKey(now) };
  if (preset === "12m") return { from: localKey(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: localKey(now) };
  return { from: `${now.getFullYear()}-01-01`, to: localKey(now) };
}

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "30d", label: "30 hari" },
  { key: "90d", label: "90 hari" },
  { key: "12m", label: "12 bulan" },
  { key: "year", label: "Tahun ini" },
];

function periodLabel(period: string, granularity: DashboardData["granularity"], long = false) {
  if (granularity === "day") {
    return long ? formatDate(period) : new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(`${period}T00:00:00`));
  }
  return new Intl.DateTimeFormat("id-ID", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit" }).format(new Date(`${period}-01T00:00:00`));
}

function niceStep(max: number) {
  const raw = Math.max(max / 4, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw) ?? raw;
}

function barPath(x: number, y: number, width: number, base: number) {
  const radius = Math.min(4, width / 2, base - y);
  return `M${x},${base}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${base}Z`;
}

function VisitChart({ data }: { data: DashboardData }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const height = 260;
  const margin = { top: 22, right: 8, bottom: 28, left: 36 };
  const plotWidth = Math.max(width - margin.left - margin.right, 0);
  const plotHeight = height - margin.top - margin.bottom;
  const base = margin.top + plotHeight;
  const maxValue = Math.max(...data.series.map((point) => point.total), 0);
  const step = niceStep(maxValue);
  const top = Math.max(Math.ceil(maxValue / step) * step, step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const band = data.series.length ? plotWidth / data.series.length : 0;
  const barWidth = Math.max(Math.min(24, band - 2), 1);
  const labelEvery = Math.max(Math.ceil(data.series.length / Math.max(Math.floor(plotWidth / 56), 1)), 1);
  const peakIndex = maxValue > 0 ? data.series.findIndex((point) => point.total === maxValue) : -1;
  const yFor = (value: number) => base - (value / top) * plotHeight;
  const hoveredPoint = hovered === null ? null : data.series[hovered];

  return (
    <div className="dash-chart" ref={frameRef}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Grafik kunjungan selesai per ${data.granularity === "day" ? "hari" : "bulan"}`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="dash-grid" x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} />
              <text className="dash-axis" x={margin.left - 8} y={yFor(tick)} dy="0.32em" textAnchor="end">{numberFormat.format(tick)}</text>
            </g>
          ))}
          {data.series.map((point, index) => {
            const x = margin.left + index * band + (band - barWidth) / 2;
            const y = yFor(point.total);
            return (
              <g key={point.period}>
                {point.total > 0 && <path className={`dash-bar${hovered === index ? " active" : ""}`} d={barPath(x, y, barWidth, base)} />}
                {index === peakIndex && <text className="dash-peak" x={x + barWidth / 2} y={y - 6} textAnchor="middle">{numberFormat.format(point.total)}</text>}
                {index % labelEvery === 0 && <text className="dash-axis" x={x + barWidth / 2} y={base + 18} textAnchor="middle">{periodLabel(point.period, data.granularity)}</text>}
                <rect
                  className="dash-hit"
                  x={margin.left + index * band}
                  y={margin.top}
                  width={band}
                  height={plotHeight}
                  tabIndex={0}
                  aria-label={`${periodLabel(point.period, data.granularity, true)}: ${point.total} kunjungan selesai`}
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            );
          })}
          <line className="dash-baseline" x1={margin.left} x2={width - margin.right} y1={base} y2={base} />
        </svg>
      )}
      {hoveredPoint && hovered !== null && (
        <div
          className="dash-tooltip"
          style={{ left: Math.min(Math.max(margin.left + hovered * band + band / 2, 70), width - 70), top: Math.max(yFor(hoveredPoint.total) - 12, 4) }}
        >
          <strong>{numberFormat.format(hoveredPoint.total)} kunjungan</strong>
          <span>{periodLabel(hoveredPoint.period, data.granularity, true)}</span>
        </div>
      )}
    </div>
  );
}

function averageLabel(total: number, days: number) {
  const average = total / days;
  if (total > 0 && average < 0.1) return "< 0,1";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(average);
}

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return localKey(value);
}

function Delta({ total, previous }: { total: number; previous: number }) {
  if (total === 0 && previous === 0) return <span className="dash-delta"><Minus size={14} /> Belum ada data untuk dibandingkan</span>;
  if (total === previous) return <span className="dash-delta"><Minus size={14} /> Sama dengan periode sebelumnya</span>;
  const up = total > previous;
  const text = previous === 0 ? "Periode sebelumnya belum ada kunjungan" : `${up ? "Naik" : "Turun"} ${numberFormat.format(Math.round((Math.abs(total - previous) / previous) * 100))}% dari periode sebelumnya`;
  return <span className={`dash-delta ${up ? "delta-up" : "delta-down"}`}>{up ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {text}</span>;
}

export function Dashboard({ branches, canPurge, onNotice }: { branches: Branch[]; canPurge: boolean; onNotice: (notice: Notice) => void }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState(() => presetRange("30d"));
  const [branchId, setBranchId] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [result, setResult] = useState<{ key: string; data: DashboardData | null; error: string } | null>(null);

  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeRange, setPurgeRange] = useState({ from: "", to: "" });
  const [purgeBranchId, setPurgeBranchId] = useState("");
  const [preview, setPreview] = useState<{ key: string; completed: number; error: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState("");

  const validRange = Boolean(range.from && range.to && range.from <= range.to);
  const requestKey = validRange ? `${range.from}|${range.to}|${branchId}|${refreshToken}` : null;
  const current = result?.key === requestKey ? result : null;
  const loading = Boolean(requestKey && !current);
  const data = current?.data ?? result?.data ?? null;

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (branchId) params.set("branchId", branchId);
    api<DashboardData>(`/dashboard?${params}`, { signal: controller.signal })
      .then((next) => setResult({ key: requestKey, data: next, error: "" }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, data: null, error: error instanceof Error ? error.message : "Data dashboard tidak dapat dimuat." });
      });
    return () => controller.abort();
  }, [requestKey, range.from, range.to, branchId]);

  const yesterday = shiftDays(-1);
  const purgeValid = Boolean(purgeRange.from && purgeRange.to && purgeRange.from <= purgeRange.to && purgeRange.to <= yesterday);
  const previewKey = purgeOpen && purgeValid ? `${purgeRange.from}|${purgeRange.to}|${purgeBranchId}` : null;
  const currentPreview = preview?.key === previewKey ? preview : null;

  useEffect(() => {
    if (!previewKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ from: purgeRange.from, to: purgeRange.to });
    if (purgeBranchId) params.set("branchId", purgeBranchId);
    api<{ completed: number }>(`/dashboard/purge?${params}`, { signal: controller.signal })
      .then((next) => setPreview({ key: previewKey, ...next, error: "" }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPreview({ key: previewKey, completed: 0, error: error instanceof Error ? error.message : "Jumlah data tidak dapat diperiksa." });
      });
    return () => controller.abort();
  }, [previewKey, purgeRange.from, purgeRange.to, purgeBranchId]);

  function choosePreset(next: Exclude<Preset, "custom">) {
    setPreset(next);
    setRange(presetRange(next));
  }

  function openPurge() {
    setPurgeRange({ from: range.from, to: range.to > yesterday ? yesterday : range.to });
    setPurgeBranchId(branchId);
    setConfirmText("");
    setPurgeError("");
    setPurgeOpen(true);
  }

  async function confirmPurge() {
    setPurging(true);
    setPurgeError("");
    try {
      const response = await api<{ deleted: number }>("/dashboard/purge", {
        method: "POST",
        body: JSON.stringify({ from: purgeRange.from, to: purgeRange.to, branchId: purgeBranchId || null }),
      });
      setPurgeOpen(false);
      setRefreshToken((value) => value + 1);
      onNotice({ title: "Data periode dihapus", message: `${numberFormat.format(response.deleted)} kunjungan selesai pada ${formatDate(purgeRange.from)} – ${formatDate(purgeRange.to)} berhasil dihapus permanen.` });
    } catch (error) {
      setPurgeError(error instanceof Error ? error.message : "Data tidak dapat dihapus.");
    } finally {
      setPurging(false);
    }
  }

  const branchName = branches.find((branch) => branch.id === branchId)?.name;
  const branchOptions = [{ value: "", label: "Semua klinik" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))];
  const unit = data?.granularity === "month" ? "bulan" : "hari";
  const maxBranch = Math.max(...(data?.byBranch.map((row) => row.total) ?? [0]), 1);

  return (
    <>
      <section className="page-heading">
        <div><span className="eyebrow">PERKEMBANGAN KLINIK</span><h1>Dashboard</h1><p>Jumlah kunjungan pasien yang sudah berstatus <strong>Selesai</strong>.</p></div>
        {canPurge && <button className="button button-primary create-button" onClick={openPurge}><Trash2 size={16} /> Hapus data periode</button>}
      </section>

      <section className="date-filter-bar dash-filters" aria-label="Saring dashboard">
        <span className="date-filter-label">Periode</span>
        <div className="date-chips">
          {PRESETS.map((item) => (
            <button key={item.key} className={`date-chip${preset === item.key ? " active" : ""}`} aria-pressed={preset === item.key} onClick={() => choosePreset(item.key)}>{item.label}</button>
          ))}
        </div>
        <span className="dash-range">
          <DatePicker id="dashFrom" label="Dari" value={range.from} onChange={(from) => { setPreset("custom"); setRange((value) => ({ ...value, from })); }} />
          <DatePicker id="dashTo" label="Sampai" value={range.to} onChange={(to) => { setPreset("custom"); setRange((value) => ({ ...value, to })); }} />
        </span>
        <span className="filter-group">
          <label className="date-filter-label" htmlFor="dashBranch">Klinik</label>
          <Select id="dashBranch" value={branchId} onChange={setBranchId} options={branchOptions} />
        </span>
      </section>
      {!validRange && <p className="inline-error export-error" role="alert">Tanggal awal harus sebelum atau sama dengan tanggal akhir.</p>}
      {current?.error && <p className="inline-error export-error" role="alert">{current.error}</p>}

      <div className={`dash-body${loading ? " is-loading" : ""}`} aria-busy={loading}>
        <section className="dash-stats" aria-label="Ringkasan">
          <article className="dash-stat dash-stat-hero">
            <span className="dash-stat-label"><CalendarCheck size={15} /> Kunjungan selesai</span>
            <strong className="dash-hero">{data ? numberFormat.format(data.total) : "–"}</strong>
            {data && <Delta total={data.total} previous={data.previousTotal} />}
          </article>
          <article className="dash-stat">
            <span className="dash-stat-label">Rata-rata per hari</span>
            <strong>{data ? averageLabel(data.total, data.days) : "–"}</strong>
            <small>{data ? `Dari ${numberFormat.format(data.days)} hari` : ""}</small>
          </article>
          <article className="dash-stat">
            <span className="dash-stat-label">Periode sebelumnya</span>
            <strong>{data ? numberFormat.format(data.previousTotal) : "–"}</strong>
            <small>{data && validRange ? `${formatDate(offsetDate(range.from, -data.days))} – ${formatDate(offsetDate(range.from, -1))}` : ""}</small>
          </article>
        </section>

        <section className="dash-card" aria-labelledby="dash-chart-title">
          <header className="dash-card-head">
            <span className="list-icon"><ChartColumn size={18} /></span>
            <div>
              <h2 id="dash-chart-title">Kunjungan selesai per {unit}</h2>
              <p>{validRange ? `${formatDate(range.from)} – ${formatDate(range.to)}` : ""} · {branchName ?? "Semua klinik"}</p>
            </div>
          </header>
          {data && data.total === 0 && <p className="dash-empty">Belum ada kunjungan berstatus Selesai pada periode ini.</p>}
          {data && <VisitChart data={data} />}
          {!data && loading && <div className="table-state"><span className="spinner" /> Memuat dashboard...</div>}
          {data && (
            <details className="dash-table">
              <summary>Lihat data dalam tabel</summary>
              <table>
                <thead><tr><th scope="col">{data.granularity === "day" ? "Tanggal" : "Bulan"}</th><th scope="col">Kunjungan selesai</th></tr></thead>
                <tbody>{data.series.map((point) => <tr key={point.period}><td>{periodLabel(point.period, data.granularity, true)}</td><td>{numberFormat.format(point.total)}</td></tr>)}</tbody>
              </table>
            </details>
          )}
        </section>

        {data && !branchId && branches.length > 1 && (
          <section className="dash-card" aria-labelledby="dash-branch-title">
            <header className="dash-card-head">
              <span className="list-icon"><CalendarCheck size={18} /></span>
              <div><h2 id="dash-branch-title">Per klinik</h2><p>Kunjungan selesai pada periode yang sama</p></div>
            </header>
            <ul className="dash-branches">
              {branches.map((branch) => {
                const total = data.byBranch.find((row) => row.branchId === branch.id)?.total ?? 0;
                return (
                  <li key={branch.id}>
                    <span className="dash-branch-name">{branch.name}</span>
                    <span className="dash-branch-track">{total > 0 && <span className="dash-branch-bar" style={{ width: `${(total / maxBranch) * 100}%` }} />}</span>
                    <strong>{numberFormat.format(total)}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {purgeOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !purging) setPurgeOpen(false); }}>
        <section className="modal-panel dash-purge-panel" role="dialog" aria-modal="true" aria-labelledby="purge-title">
          <span className="delete-mark"><ShieldAlert size={20} /></span>
          <span className="eyebrow">HAPUS PERMANEN</span>
          <h2 id="purge-title">Hapus data periode</h2>
          <p className="modal-intro">Kunjungan berstatus Selesai pada periode ini akan dihapus permanen dari database dan dari grafik. Jadwal yang masih Terjadwal tidak terpengaruh. Data hari ini dan setelahnya tidak dapat dihapus.</p>
          <div className="appointment-form">
            <label htmlFor="purgeFrom">Dari tanggal</label>
            <DatePicker id="purgeFrom" value={purgeRange.from} onChange={(from) => setPurgeRange((value) => ({ ...value, from }))} />
            <label htmlFor="purgeTo">Sampai tanggal</label>
            <DatePicker id="purgeTo" value={purgeRange.to} onChange={(to) => setPurgeRange((value) => ({ ...value, to }))} />
            <label htmlFor="purgeBranch">Klinik</label>
            <Select id="purgeBranch" variant="field" value={purgeBranchId} onChange={setPurgeBranchId} options={branchOptions} />
            {!purgeValid && <p className="inline-error" role="alert">Pilih rentang yang benar dengan tanggal akhir paling lambat kemarin ({formatDate(yesterday)}).</p>}
            {purgeValid && !currentPreview && <p className="availability-note">Menghitung data...</p>}
            {currentPreview?.error && <p className="inline-error" role="alert">{currentPreview.error}</p>}
            {currentPreview && !currentPreview.error && (
              <p className="dash-purge-count">
                {currentPreview.completed === 0
                  ? "Tidak ada kunjungan selesai pada periode ini."
                  : <><strong>{numberFormat.format(currentPreview.completed)} kunjungan selesai</strong> akan dihapus permanen dari grafik dan database. Tindakan ini tidak dapat dibatalkan.</>}
              </p>
            )}
            <label htmlFor="purgeConfirm">Ketik <strong>HAPUS</strong> untuk konfirmasi</label>
            <input id="purgeConfirm" autoComplete="off" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="HAPUS" />
            {purgeError && <p className="inline-error" role="alert">{purgeError}</p>}
            <div className="modal-actions">
              <button type="button" className="button button-plain" disabled={purging} onClick={() => setPurgeOpen(false)}>Batal</button>
              <button
                type="button"
                className="button button-danger"
                disabled={purging || !currentPreview || Boolean(currentPreview.error) || currentPreview.completed === 0 || confirmText.trim() !== "HAPUS"}
                onClick={() => void confirmPurge()}
              >
                <Trash2 size={16} /> {purging ? "Menghapus..." : "Hapus permanen"}
              </button>
            </div>
          </div>
        </section>
      </div>}
    </>
  );
}
