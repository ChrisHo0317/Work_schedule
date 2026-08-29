/*
 * Parses the "employee x date" matrix schedule format (grid of shift codes
 * per date, plus a legend table mapping 班別代碼 -> 上班時間 at the bottom)
 * using Tesseract.js word-level bounding boxes instead of plain text,
 * since OCR reading order alone cannot reconstruct a wide table's columns.
 */
(function (root) {
  const LABEL_COLUMN_MAX_X = 160; // employee-name / row-label column ends here
  // Keys include common OCR look-alikes of the real characters ("体" for 休,
  // "囯" for 國), since at this text size Tesseract regularly returns the
  // variant form and they carry no other meaning in this table.
  const KNOWN_LEAVE_LABELS = {
    "休": "公休",
    "体": "公休",
    "例": "例假",
    "囫": "例假",
    "國": "國定假日",
    "囯": "國定假日",
  };

  function cleanToken(text) {
    return (text || "")
      .replace(/^[「」『』|｜\[\]（）()。.\s]+/, "")
      .replace(/[「」『』|｜\[\]（）()。.\s]+$/, "")
      .trim();
  }

  function stripSpaces(text) {
    return (text || "").replace(/\s+/g, "");
  }

  // Shift codes in this template are always D/N plus digits (D, N, D2, N2, N4,
  // N5, N6, DD, DN, DN2, DN4...) - a lowercase "z" is never legitimate and is a
  // recurring OCR misread of a stylized "2", so it is safe to strip outright.
  function normalizeShiftCode(text) {
    return (text || "").toUpperCase().replace(/Z/g, "");
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  // A code that doesn't match the legend outright might just be a one-character
  // OCR misread of one that does (e.g. "0N2" for "DN2"). Only worth trying for
  // codes of 2+ chars - a single stray character is too ambiguous to correct
  // safely (every single-char code is "distance 1" from every other one).
  function fuzzyMatchLegendCode(legend, code) {
    if (!code || code.length < 2) return null;
    const keys = Object.keys(legend);
    let bestKey = null;
    let bestDist = Infinity;
    let tie = false;
    keys.forEach((key) => {
      const dist = levenshtein(code, key);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
        tie = false;
      } else if (dist === bestDist) {
        tie = true;
      }
    });
    if (bestKey && bestDist === 1 && !tie) return bestKey;
    return null;
  }

  function median(nums) {
    const s = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function findYearMonth(lines) {
    let year = new Date().getFullYear();
    let month = new Date().getMonth() + 1;
    for (const line of lines) {
      const y = line.text.match(/(\d{4})/);
      if (/年/.test(line.text) && y) year = parseInt(y[1], 10);
      const m = line.text.match(/月[^\d]*(\d{1,2})\b/);
      if (/月/.test(line.text) && m && !/年/.test(line.text)) {
        const mv = parseInt(m[1], 10);
        if (mv >= 1 && mv <= 12) month = mv;
      }
    }
    return { year, month };
  }

  function findGridWindow(lines) {
    let topY = 0;
    let bottomY = Infinity;
    for (const line of lines) {
      const t = stripSpaces(line.text);
      if (/班人員|到職日|職日/.test(t)) {
        topY = Math.max(topY, line.bbox.y1);
      }
    }
    for (const line of lines) {
      const t = stripSpaces(line.text);
      if (/店務交接|飛簽代碼|代碼.*上班時間/.test(t) && line.bbox.y0 > topY) {
        bottomY = Math.min(bottomY, line.bbox.y0);
      }
    }
    return { topY, bottomY };
  }

  function collectDataWords(lines, topY, bottomY) {
    const words = [];
    lines.forEach((line) => {
      if (line.bbox.y0 < topY || line.bbox.y0 >= bottomY) return;
      line.words.forEach((w) => {
        if (w.bbox.x0 >= LABEL_COLUMN_MAX_X) words.push(w);
      });
    });
    return words;
  }

  function calibrateColumns(dataWords, daysInMonth) {
    if (dataWords.length < 2) return null;
    const centers = dataWords.map((w) => (w.bbox.x0 + w.bbox.x1) / 2);
    const leftCenter = Math.min(...centers);
    const rightCenter = Math.max(...centers);
    const pitch = (rightCenter - leftCenter) / Math.max(1, daysInMonth - 1);
    return { leftCenter, pitch };
  }

  // A row's leftmost label (before the date columns start) is either an
  // employee name or a "備註/指休V" note-row sitting under it. Note-rows are
  // told apart by the "指" character, which survives OCR far more reliably
  // than "備" does (often garbled) - real names never contain it.
  function findEmployeeCandidates(lines, topY, bottomY) {
    const candidates = [];
    lines.forEach((line) => {
      if (line.bbox.y0 < topY || line.bbox.y0 >= bottomY) return;
      const labelWords = line.words.filter((w) => w.bbox.x0 < LABEL_COLUMN_MAX_X);
      const label = labelWords
        .map((w) => cleanToken(w.text))
        .filter(Boolean)
        .join("")
        .trim();
      if (!label || label.length < 2) return;
      if (/指|備註/.test(label)) return;
      candidates.push({ label, line });
    });
    return candidates;
  }

  function assignWordsToDays(dataWords, calib, daysInMonth) {
    const byDay = {};
    dataWords.forEach((w) => {
      const center = (w.bbox.x0 + w.bbox.x1) / 2;
      let day = Math.round((center - calib.leftCenter) / calib.pitch) + 1;
      day = Math.max(1, Math.min(daysInMonth, day));
      const dist = Math.abs(calib.leftCenter + calib.pitch * (day - 1) - center);
      if (!byDay[day] || dist < byDay[day].dist) {
        byDay[day] = { text: cleanToken(w.text), dist };
      }
    });
    return byDay;
  }

  // ---------- Legend table (代碼 / 上班時間 / 班別 / 時數) ----------
  function parseTimeRange(text) {
    const m = text.match(/(\d{3,4})\s*-\s*(\d{3,4})/);
    if (!m) return null;
    const pad = (s) => s.padStart(4, "0");
    const a = pad(m[1]);
    const b = pad(m[2]);
    return {
      start: `${a.slice(0, 2)}:${a.slice(2)}`,
      end: `${b.slice(0, 2)}:${b.slice(2)}`,
    };
  }

  // A legend line packs up to 3 side-by-side mini-tables (代碼/上班時間/班別/時數).
  // Rather than clustering by x-gap (unreliable: the gap between a time cell and
  // its own 班別 cell can be as large as the gap between two different tables),
  // scan words left-to-right and use token shape to decide role: a long
  // letter+digit token (5-8 chars, e.g. "FLD46") starts a new entry; the next
  // "HHMM-HHMM" token is its time range; a short 1-3 char alnum token after that
  // is the 班別 code actually used in the day grid; a following plain number is hours.
  function parseLegendLine(words) {
    const entries = [];
    let current = null;
    const sorted = words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);

    sorted.forEach((w) => {
      const clean = cleanToken(w.text);
      if (!clean) return;

      const time = parseTimeRange(w.text);
      if (time && current && !current.time) {
        current.time = time;
        if (/扣|餐/.test(w.text)) current.note = "已扣餐休時間";
        return;
      }

      if (/^[A-Za-z0-9]{4,8}$/.test(clean) && /[A-Za-z]/.test(clean) && /[0-9]/.test(clean)) {
        if (current && current.time && current.shiftType) entries.push(current);
        current = { shiftType: null, time: null, hours: null, note: "" };
        return;
      }

      if (current && current.time && !current.shiftType && /^[A-Za-z]{1,3}[0-9]{0,2}$/.test(clean)) {
        current.shiftType = normalizeShiftCode(clean);
        return;
      }

      if (current && current.shiftType && current.hours == null && /^\d+(\.\d+)?$/.test(clean)) {
        let h = parseFloat(clean);
        if (h >= 20) h /= 10;
        current.hours = h;
        return;
      }
    });
    if (current && current.time && current.shiftType) entries.push(current);
    return entries;
  }

  function parseLegend(lines, bottomY) {
    const map = {};
    lines.forEach((line) => {
      if (line.bbox.y0 <= bottomY) return;
      const dataWords = line.words.filter((w) => cleanToken(w.text).length > 0);
      parseLegendLine(dataWords).forEach((entry) => {
        if (!map[entry.shiftType]) {
          map[entry.shiftType] = {
            code: entry.shiftType,
            start: entry.time.start,
            end: entry.time.end,
            hours: entry.hours,
            note: entry.note,
          };
        }
      });
    });
    return map;
  }

  // ---------- Main entry ----------
  // Step 1: read the image once - locate the grid, parse the legend, list every
  // employee row found - without committing to any one person yet.
  function analyzeGrid(lines) {
    const warnings = [];
    const { year, month } = findYearMonth(lines);
    const daysInMonth = new Date(year, month, 0).getDate();
    const { topY, bottomY } = findGridWindow(lines);

    if (!isFinite(bottomY)) {
      warnings.push("找不到代碼對照表區域，可能會影響時間換算");
    }

    const legendBottomY = isFinite(bottomY) ? bottomY : lines[lines.length - 1].bbox.y1;
    const legend = parseLegend(lines, legendBottomY);

    const candidates = findEmployeeCandidates(lines, topY, bottomY);
    if (candidates.length === 0) {
      warnings.push("圖片中找不到任何員工姓名列，請確認圖片是否包含完整表格");
    }

    const dataWords = collectDataWords(lines, topY, bottomY);
    const calib = calibrateColumns(dataWords, daysInMonth);
    if (!calib) {
      warnings.push("無法定位日期欄位，圖片可能太模糊或格式不符");
    }

    return { year, month, daysInMonth, legend, candidates, calib, warnings, topY, bottomY };
  }

  // Manual-override fallback: search all lines in the grid window by substring,
  // for when the detected candidate list is missing or wrong.
  function findLineByQuery(lines, topY, bottomY, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return null;
    return (
      lines.find(
        (line) =>
          line.bbox.y0 >= topY &&
          line.bbox.y0 < bottomY &&
          line.text.toLowerCase().includes(q)
      ) || null
    );
  }

  // Step 2: given the analysis from analyzeGrid() and one chosen candidate's
  // line, extract that person's day-by-day shifts.
  function extractRowsForLine(analysis, employeeLine) {
    const { year, month, daysInMonth, legend, calib } = analysis;
    if (!calib || !employeeLine) return [];

    const employeeDataWords = employeeLine.words.filter((w) => w.bbox.x0 >= LABEL_COLUMN_MAX_X);
    const byDay = assignWordsToDays(employeeDataWords, calib, daysInMonth);

    const rows = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = byDay[day];
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const weekday = "日一二三四五六"[new Date(date + "T00:00:00").getDay()];

      // Cells at the left/right edge of the table (day 1, the last day) are
      // the ones most likely to be clipped or blurred out of frame, so OCR
      // misses them more often than interior days. Rather than silently
      // dropping the date from the results (easy to miss you're even short a
      // day), always emit a row - blank and flagged - so it shows up in the
      // editable table ready to fill in by hand.
      if (!cell || !cell.text) {
        rows.push({ date, weekday, start: "", end: "", note: "未辨識到，請確認", rawCode: "" });
        continue;
      }
      const code = cell.text;

      if (KNOWN_LEAVE_LABELS[code]) {
        rows.push({ date, weekday, start: "", end: "", note: KNOWN_LEAVE_LABELS[code], rawCode: code });
        continue;
      }
      const normalizedCode = normalizeShiftCode(code);
      const legendEntry = legend[normalizedCode];
      if (legendEntry) {
        rows.push({
          date,
          weekday,
          start: legendEntry.start,
          end: legendEntry.end,
          note: legendEntry.note || "",
          rawCode: code,
        });
        continue;
      }

      const fuzzyKey = fuzzyMatchLegendCode(legend, normalizedCode);
      if (fuzzyKey) {
        const fuzzyEntry = legend[fuzzyKey];
        rows.push({
          date,
          weekday,
          start: fuzzyEntry.start,
          end: fuzzyEntry.end,
          note: `${fuzzyEntry.note ? fuzzyEntry.note + "；" : ""}代碼「${code}」疑似為「${fuzzyKey}」，已自動校正，請確認`,
          rawCode: code,
        });
        continue;
      }

      rows.push({
        date,
        weekday,
        start: "",
        end: "",
        note: `代碼「${code}」需手動確認時間`,
        rawCode: code,
      });
    }
    return rows;
  }

  const api = { analyzeGrid, extractRowsForLine, findLineByQuery };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GridParser = api;
})(typeof window !== "undefined" ? window : globalThis);
