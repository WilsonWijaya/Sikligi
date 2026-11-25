import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("id-ID", { month: "long" }).format(new Date(2000, month, 1)));
const YEARS_PER_PAGE = 12;
type Mode = "days" | "months" | "years";

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function calendarDays(year: number, month: number) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, index + 1 - offset));
}

type DatePickerProps = { id: string; value: string; onChange: (value: string) => void; label?: string };

export function DatePicker({ id, value, onChange, label }: DatePickerProps) {
  const selected = parseDate(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = selected ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [mode, setMode] = useState<Mode>("days");
  const rootRef = useRef<HTMLDivElement>(null);
  const todayKey = dateKey(new Date());

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function toggle() {
    if (!open) {
      const base = selected ?? new Date();
      setView({ year: base.getFullYear(), month: base.getMonth() });
      setMode("days");
    }
    setOpen(!open);
  }

  const today = new Date();
  const yearPageStart = Math.floor(view.year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const navLabel = mode === "days" ? "Bulan" : mode === "months" ? "Tahun" : `${YEARS_PER_PAGE} tahun`;

  function move(step: number) {
    if (mode === "days") {
      const next = new Date(view.year, view.month + step, 1);
      setView({ year: next.getFullYear(), month: next.getMonth() });
    } else {
      setView({ ...view, year: view.year + step * (mode === "months" ? 1 : YEARS_PER_PAGE) });
    }
  }

  function pick(date: Date) {
    onChange(dateKey(date));
    setOpen(false);
  }

  return (
    <div className={`date-picker${label ? " labeled" : ""}`} ref={rootRef} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); } }}>
      <button type="button" id={id} className={`date-trigger${open ? " open" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <CalendarDays size={16} />
        {label && <small>{label}</small>}
        <span>{selected ? new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(selected) : "Pilih tanggal"}</span>
        {value === todayKey && <em>Hari ini</em>}
      </button>
      {open && (
        <div className="date-panel" role="dialog" aria-label="Pilih tanggal kedatangan">
          <div className="date-panel-head">
            <button type="button" className="date-nav" aria-label={`${navLabel} sebelumnya`} onClick={() => move(-1)}><ChevronLeft size={16} /></button>
            {mode === "days" && <button type="button" className="date-title" aria-label="Pilih bulan dan tahun" onClick={() => setMode("months")}>{MONTHS[view.month]} {view.year} <ChevronDown size={14} /></button>}
            {mode === "months" && <button type="button" className="date-title" aria-label="Pilih tahun" onClick={() => setMode("years")}>{view.year} <ChevronDown size={14} /></button>}
            {mode === "years" && <strong className="date-title">{yearPageStart} – {yearPageStart + YEARS_PER_PAGE - 1}</strong>}
            <button type="button" className="date-nav" aria-label={`${navLabel} berikutnya`} onClick={() => move(1)}><ChevronRight size={16} /></button>
          </div>
          {mode === "days" && <>
            <div className="date-grid date-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="date-grid">
              {calendarDays(view.year, view.month).map((date) => {
                const key = dateKey(date);
                const classes = ["date-day", date.getMonth() !== view.month && "outside", key === todayKey && "today", key === value && "selected"].filter(Boolean).join(" ");
                return (
                  <button type="button" key={key} className={classes} aria-pressed={key === value} aria-label={new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(date)} onClick={() => pick(date)}>
                    {date.getDate()}
                  </button>
                );
              })}
            </div>
          </>}
          {mode === "months" && (
            <div className="date-options">
              {MONTHS.map((name, month) => {
                const classes = ["date-option", view.year === today.getFullYear() && month === today.getMonth() && "today", selected?.getFullYear() === view.year && selected.getMonth() === month && "selected"].filter(Boolean).join(" ");
                return <button type="button" key={name} className={classes} onClick={() => { setView({ ...view, month }); setMode("days"); }}>{name}</button>;
              })}
            </div>
          )}
          {mode === "years" && (
            <div className="date-options">
              {Array.from({ length: YEARS_PER_PAGE }, (_, index) => yearPageStart + index).map((year) => {
                const classes = ["date-option", year === today.getFullYear() && "today", selected?.getFullYear() === year && "selected"].filter(Boolean).join(" ");
                return <button type="button" key={year} className={classes} onClick={() => { setView({ ...view, year }); setMode("months"); }}>{year}</button>;
              })}
            </div>
          )}
          <div className="date-panel-foot">
            <span><i className="date-legend" /> Hari ini</span>
            <button type="button" className="text-button" onClick={() => pick(new Date())}>Pilih hari ini</button>
          </div>
        </div>
      )}
    </div>
  );
}
