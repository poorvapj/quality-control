import React, { useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Click-to-pick date range calendar — click a start day, click an end day,
 *  the range between highlights. Matches the reference's month-grid picker
 *  instead of two bare <input type="date"> fields. */
export default function CalendarRangePicker({
  from, to, onApply, onCancel
}: {
  from: string; to: string; onApply: (from: string, to: string) => void; onCancel: () => void;
}) {
  const initial = from ? new Date(from) : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [start, setStart] = useState(from || "");
  const [end, setEnd] = useState(to || "");

  const todayStr = ymd(new Date());
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ date: new Date(viewYear, viewMonth - 1, daysInPrevMonth - i), inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(viewYear, viewMonth, d), inMonth: true });
  while (cells.length % 7 !== 0 || cells.length < 42) cells.push({ date: new Date(viewYear, viewMonth + 1, cells.length - startDow - daysInMonth + 1), inMonth: false });

  function pick(dateStr: string) {
    if (!start || (start && end)) { setStart(dateStr); setEnd(""); return; }
    if (dateStr < start) { setEnd(start); setStart(dateStr); }
    else setEnd(dateStr);
  }

  function prevMonth() { const m = viewMonth === 0 ? 11 : viewMonth - 1; setViewMonth(m); setViewYear(m === 11 ? viewYear - 1 : viewYear); }
  function nextMonth() { const m = viewMonth === 11 ? 0 : viewMonth + 1; setViewMonth(m); setViewYear(m === 0 ? viewYear + 1 : viewYear); }

  return (
    <div className="calendar-picker">
      <div className="calendar-header">
        <button type="button" className="btn-icon" style={{ width: 30, height: 30 }} onClick={prevMonth}>‹</button>
        <div className="calendar-title">{firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
        <button type="button" className="btn-icon" style={{ width: 30, height: 30 }} onClick={nextMonth}>›</button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="calendar-grid">
        {cells.map(({ date, inMonth }, i) => {
          const dStr = ymd(date);
          const isToday = dStr === todayStr;
          const isStart = dStr === start;
          const isEnd = dStr === end;
          const inRange = start && end && dStr > start && dStr < end;
          return (
            <button
              type="button"
              key={i}
              className={
                "calendar-day" +
                (!inMonth ? " outside" : "") +
                (isToday ? " today" : "") +
                (isStart || isEnd ? " selected" : "") +
                (inRange ? " in-range" : "")
              }
              onClick={() => pick(dStr)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <button type="button" className="calendar-today-link" onClick={() => { setStart(todayStr); setEnd(todayStr); setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }}>
        Today
      </button>
      <div className="calendar-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!start} onClick={() => onApply(start, end || start)}>Apply Range</button>
      </div>
    </div>
  );
}
