const Parser = (() => {
  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

  function toHalfWidth(str) {
    return str
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[：﹕]/g, ":")
      .replace(/[～〜]/g, "~")
      .replace(/[－—–]/g, "-");
  }

  function weekdayFromDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return WEEKDAY_LABELS[d.getDay()];
  }

  function extractDate(line, fallbackYear) {
    let m = line.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/);
    if (m) {
      const [, y, mo, da] = m;
      return { date: toISO(y, mo, da), matched: m[0] };
    }
    m = line.match(/(\d{1,2})[\/\-月](\d{1,2})日?/);
    if (m) {
      const [, mo, da] = m;
      return { date: toISO(fallbackYear, mo, da), matched: m[0] };
    }
    return null;
  }

  function toISO(y, mo, da) {
    const yyyy = String(y).length === 4 ? String(y) : String(y);
    const mm = String(mo).padStart(2, "0");
    const dd = String(da).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function extractWeekdayText(line) {
    const m = line.match(/(?:星期|週|周)?([一二三四五六日])(?=[)）]|$|\s)/);
    return m ? m[1] : "";
  }

  function extractTimeRange(line) {
    const m = line.match(
      /([01]?\d|2[0-3])[:：]([0-5]\d)\s*[-~至到]\s*([01]?\d|2[0-3])[:：]([0-5]\d)/
    );
    if (!m) return null;
    const start = `${m[1].padStart(2, "0")}:${m[2]}`;
    const end = `${m[3].padStart(2, "0")}:${m[4]}`;
    return { start, end, matched: m[0] };
  }

  function makeId() {
    return (
      "s_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function parseScheduleText(rawText) {
    const text = toHalfWidth(rawText || "");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const currentYear = new Date().getFullYear();
    const rows = [];
    let lastDate = "";

    lines.forEach((line) => {
      const timeInfo = extractTimeRange(line);
      const dateInfo = extractDate(line, currentYear);
      if (dateInfo) lastDate = dateInfo.date;

      if (!timeInfo && !dateInfo) return;

      const date = dateInfo ? dateInfo.date : lastDate;
      const weekdayText = extractWeekdayText(line);
      const weekday = weekdayText || (date ? weekdayFromDate(date) : "");

      let note = line;
      if (timeInfo) note = note.replace(timeInfo.matched, "");
      if (dateInfo) note = note.replace(dateInfo.matched, "");
      note = note.replace(/[()（）星期週周一二三四五六日\s]/g, "");

      rows.push({
        id: makeId(),
        date: date || "",
        weekday,
        start: timeInfo ? timeInfo.start : "",
        end: timeInfo ? timeInfo.end : "",
        note,
      });
    });

    return rows;
  }

  return { parseScheduleText, weekdayFromDate, WEEKDAY_LABELS };
})();
