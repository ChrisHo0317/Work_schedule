(() => {
  const today = new Date();
  const state = {
    imageBlob: null,
    rotation: 0,
    rows: [],
    gridAnalysis: null,
    ocrLines: null,
    calendarYear: today.getFullYear(),
    calendarMonth: today.getMonth() + 1, // 1-12
    selectedDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  };

  const el = {
    imageInput: document.getElementById("imageInput"),
    rotateBtn: document.getElementById("rotateBtn"),
    previewWrap: document.getElementById("previewWrap"),
    previewImg: document.getElementById("previewImg"),
    recognizeBtn: document.getElementById("recognizeBtn"),
    progressWrap: document.getElementById("progressWrap"),
    progressFill: document.getElementById("progressFill"),
    progressLabel: document.getElementById("progressLabel"),
    resultSection: document.getElementById("resultSection"),
    shiftTableBody: document.getElementById("shiftTableBody"),
    addRowBtn: document.getElementById("addRowBtn"),
    rawTextOutput: document.getElementById("rawTextOutput"),
    saveBtn: document.getElementById("saveBtn"),
    emptyState: document.getElementById("emptyState"),
    weekRow: document.getElementById("weekRow"),
    monthTitle: document.getElementById("monthTitle"),
    prevMonthBtn: document.getElementById("prevMonthBtn"),
    nextMonthBtn: document.getElementById("nextMonthBtn"),
    calendarGrid: document.getElementById("calendarGrid"),
    dayDetailCard: document.getElementById("dayDetailCard"),
    dayDetailDate: document.getElementById("dayDetailDate"),
    dayDetailTime: document.getElementById("dayDetailTime"),
    dayDetailNote: document.getElementById("dayDetailNote"),
    dayDetailEditBtn: document.getElementById("dayDetailEditBtn"),
    dayDetailDeleteBtn: document.getElementById("dayDetailDeleteBtn"),
    dayTimelineWrap: document.getElementById("dayTimelineWrap"),
    nameSelectSection: document.getElementById("nameSelectSection"),
    nameCandidateList: document.getElementById("nameCandidateList"),
    manualNameInput: document.getElementById("manualNameInput"),
    manualNameConfirmBtn: document.getElementById("manualNameConfirmBtn"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    views: document.querySelectorAll(".view"),
  };

  // ---------- Tab navigation ----------
  el.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  function switchView(viewId) {
    el.views.forEach((v) => v.classList.toggle("active", v.id === viewId));
    el.tabBtns.forEach((b) =>
      b.classList.toggle("active", b.dataset.view === viewId)
    );
    if (viewId === "view-list") renderCalendarView();
  }

  // ---------- Image upload & rotation ----------
  // Photos straight from a phone camera carry an EXIF orientation tag rather
  // than physically rotated pixels. <img>/canvas decoding applies that tag
  // consistently, but Tesseract's own image loader does not always do so the
  // same way across browsers/platforms - so a phone photo and its "identical"
  // desktop copy could be fed to OCR at different orientations and produce
  // very different results. Routing every image through canvas up front,
  // before OCR ever sees it, bakes the correct orientation into plain pixels
  // so recognition is deterministic regardless of device.
  //
  // An upscale+contrast preprocessing pass was tried here too, but measured
  // testing against a real schedule photo showed it made recognition *worse*
  // (even a same-size no-op round-trip through getImageData/putImageData and
  // ctx.scale() shifted results) - so it was reverted. Keep this pass exactly
  // as small as the orientation fix requires.
  el.imageInput.addEventListener("change", async () => {
    const file = el.imageInput.files[0];
    if (!file) return;
    el.recognizeBtn.disabled = true;
    const normalized = await rotateImage(file, 0);
    state.imageBlob = normalized;
    state.rotation = 0;
    showPreview(normalized);
    el.rotateBtn.hidden = false;
    el.recognizeBtn.disabled = false;
  });

  function showPreview(blob) {
    const url = URL.createObjectURL(blob);
    el.previewImg.src = url;
    el.previewWrap.hidden = false;
  }

  el.rotateBtn.addEventListener("click", async () => {
    state.rotation = (state.rotation + 90) % 360;
    const rotatedBlob = await rotateImage(state.imageBlob, 90);
    state.imageBlob = rotatedBlob;
    showPreview(rotatedBlob);
  });

  // A full-resolution phone camera photo (12MP+, ~3000-4000px per side) is far
  // larger than anything tested against so far (~1500px screenshots), and iOS
  // Safari specifically has known canvas size/memory limits desktop browsers
  // don't hit the same way - a canvas that large can render corrupted/blank
  // instead of erroring, which would explain OCR "completing" but on garbage
  // pixel data. Downscaling to a size still far larger than this table's text
  // needs sidesteps that without touching anything for already-small images
  // (scale stays exactly 1, so the canvas call is skipped and the code path
  // is byte-for-byte what was already validated).
  const MAX_DIMENSION = 2400;

  function rotateImage(blob, degrees) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const rad = (degrees * Math.PI) / 180;
        const swap = degrees % 180 !== 0;
        const rotatedWidth = swap ? img.height : img.width;
        const rotatedHeight = swap ? img.width : img.height;
        const longestSide = Math.max(rotatedWidth, rotatedHeight);
        const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(rotatedWidth * scale);
        canvas.height = Math.round(rotatedHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rad);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        // Lossless: a JPEG re-encode here measurably hurt OCR accuracy on
        // already-clean screenshots (compression artifacts on fine text).
        canvas.toBlob((newBlob) => resolve(newBlob), "image/png");
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  // ---------- OCR ----------
  const STATUS_LABELS = {
    "loading tesseract core": "載入辨識引擎…",
    "initializing tesseract": "初始化中…",
    "loading language traineddata": "載入語言資料…",
    "initializing api": "準備中…",
    "recognizing text": "辨識文字中…",
  };

  el.recognizeBtn.addEventListener("click", async () => {
    if (!state.imageBlob) return;

    el.recognizeBtn.disabled = true;
    el.progressWrap.hidden = false;
    el.progressFill.style.width = "0%";
    el.progressLabel.textContent = "準備中…";
    el.nameSelectSection.hidden = true;
    el.resultSection.hidden = true;

    try {
      const { lines, rawText } = await OCR.recognizeGrid(state.imageBlob, (msg) => {
        const pct = Math.round((msg.progress || 0) * 100);
        el.progressFill.style.width = pct + "%";
        el.progressLabel.textContent =
          (STATUS_LABELS[msg.status] || msg.status || "處理中…") + ` ${pct}%`;
      });

      el.rawTextOutput.textContent = rawText || "(未辨識到任何文字)";

      const analysis = GridParser.analyzeGrid(lines);
      state.gridAnalysis = analysis;
      state.ocrLines = lines;

      if (analysis.warnings.length) {
        alert(analysis.warnings.join("\n"));
      }

      if (analysis.candidates.length === 0) {
        state.rows = [emptyRow()];
        renderTable();
        el.resultSection.hidden = false;
        el.resultSection.scrollIntoView({ behavior: "smooth" });
      } else {
        renderNameCandidates(analysis.candidates);
        el.nameSelectSection.hidden = false;
        el.nameSelectSection.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
      alert("辨識失敗，請重新嘗試：" + err.message);
    } finally {
      el.recognizeBtn.disabled = false;
      el.progressWrap.hidden = true;
    }
  });

  // ---------- Name candidate selection ----------
  function renderNameCandidates(candidates) {
    el.nameCandidateList.innerHTML = "";
    candidates.forEach((candidate) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-block name-candidate-btn";
      btn.textContent = candidate.label;
      btn.addEventListener("click", () => chooseEmployeeLine(candidate.line));
      el.nameCandidateList.appendChild(btn);
    });
  }

  function chooseEmployeeLine(line) {
    const rows = GridParser.extractRowsForLine(state.gridAnalysis, line);
    state.rows = rows.map((r) => ({
      id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: r.date,
      weekday: r.weekday,
      start: r.start,
      end: r.end,
      note: r.note,
    }));
    if (state.rows.length === 0) state.rows.push(emptyRow());
    renderTable();
    el.nameSelectSection.hidden = true;
    el.resultSection.hidden = false;
    el.resultSection.scrollIntoView({ behavior: "smooth" });
  }

  el.manualNameConfirmBtn.addEventListener("click", () => {
    if (!state.gridAnalysis || !state.ocrLines) return;
    const line = GridParser.findLineByQuery(
      state.ocrLines,
      state.gridAnalysis.topY,
      state.gridAnalysis.bottomY,
      el.manualNameInput.value
    );
    if (!line) {
      alert("圖片中找不到符合這個關鍵字的那一列，請確認輸入是否正確。");
      return;
    }
    chooseEmployeeLine(line);
  });

  // ---------- Editable table ----------
  function emptyRow() {
    return {
      id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: "",
      weekday: "",
      start: "",
      end: "",
      note: "",
    };
  }

  function renderTable() {
    el.shiftTableBody.innerHTML = "";
    state.rows.forEach((row) => {
      el.shiftTableBody.appendChild(buildRowEl(row));
    });
  }

  function buildRowEl(row) {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;

    const dateTd = document.createElement("td");
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = row.date || "";
    dateInput.addEventListener("change", () => {
      row.date = dateInput.value;
      row.weekday = row.date ? Parser.weekdayFromDate(row.date) : row.weekday;
      weekdaySpan.textContent = row.weekday;
    });
    dateTd.appendChild(dateInput);

    const weekdayTd = document.createElement("td");
    const weekdaySpan = document.createElement("span");
    weekdaySpan.textContent = row.weekday || "";
    weekdayTd.appendChild(weekdaySpan);

    const startTd = document.createElement("td");
    const startInput = document.createElement("input");
    startInput.type = "time";
    startInput.value = row.start || "";
    startInput.addEventListener("change", () => (row.start = startInput.value));
    startTd.appendChild(startInput);

    const endTd = document.createElement("td");
    const endInput = document.createElement("input");
    endInput.type = "time";
    endInput.value = row.end || "";
    endInput.addEventListener("change", () => (row.end = endInput.value));
    endTd.appendChild(endInput);

    const noteTd = document.createElement("td");
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = "備註";
    noteInput.value = row.note || "";
    noteInput.addEventListener("input", () => (row.note = noteInput.value));
    noteTd.appendChild(noteInput);

    const actionTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete-btn";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      renderTable();
    });
    actionTd.appendChild(delBtn);

    tr.append(dateTd, weekdayTd, startTd, endTd, noteTd, actionTd);
    return tr;
  }

  el.addRowBtn.addEventListener("click", () => {
    state.rows.push(emptyRow());
    renderTable();
    el.resultSection.hidden = false;
  });

  el.saveBtn.addEventListener("click", () => {
    const valid = state.rows.filter((r) => r.date && (r.start || r.end || r.note));
    if (valid.length === 0) {
      alert("請至少填寫一列有效的日期與時間");
      return;
    }
    Storage.upsertMany(valid);
    alert(`已儲存 ${valid.length} 筆班表`);
    switchView("view-list");
  });

  // ---------- Calendar (本週 + 月曆) ----------
  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function shiftSummary(shift) {
    if (!shift) return "";
    if (shift.start || shift.end) return `${shift.start || "--:--"}-${shift.end || "--:--"}`;
    return shift.note || "";
  }

  function renderCalendarView() {
    const shiftsByDate = {};
    Storage.getAll().forEach((s) => {
      shiftsByDate[s.date] = s;
    });
    el.emptyState.hidden = Object.keys(shiftsByDate).length > 0;
    renderWeek(shiftsByDate);
    renderCalendar(state.calendarYear, state.calendarMonth, shiftsByDate);
    renderDayDetail(shiftsByDate);
  }

  function isLeaveShift(shift) {
    return !!shift && !shift.start && !shift.end;
  }

  function renderWeek(shiftsByDate) {
    el.weekRow.innerHTML = "";
    const now = new Date();
    const todayISO = toISODate(now);

    // Today always sits in the middle slot (index 3 of 7), not a fixed Sun-Sat week.
    for (let offset = -3; offset <= 3; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      const iso = toISODate(d);
      const shift = shiftsByDate[iso];

      const cell = document.createElement("div");
      cell.className = "week-day";
      if (iso === todayISO) cell.classList.add("today");
      if (shift) cell.classList.add("has-shift");
      if (isLeaveShift(shift)) cell.classList.add("is-leave");
      cell.innerHTML = `
        <div class="wd-label">${"日一二三四五六"[d.getDay()]}</div>
        <div class="wd-date">${d.getDate()}</div>
        <div class="wd-info">${shiftSummary(shift)}</div>
      `;
      cell.addEventListener("click", () => selectDate(iso));
      el.weekRow.appendChild(cell);
    }
  }

  function renderCalendar(year, month, shiftsByDate) {
    el.monthTitle.textContent = `${year}年${month}月`;
    el.calendarGrid.innerHTML = "";

    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const todayISO = toISODate(new Date());

    for (let i = 0; i < firstWeekday; i++) {
      const filler = document.createElement("div");
      filler.className = "cal-day empty-cell";
      el.calendarGrid.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const shift = shiftsByDate[iso];

      const cell = document.createElement("div");
      cell.className = "cal-day";
      if (iso === todayISO) cell.classList.add("today");
      if (shift) cell.classList.add("has-shift");
      if (isLeaveShift(shift)) cell.classList.add("is-leave");
      if (iso === state.selectedDate) cell.classList.add("selected");
      cell.innerHTML = `
        <div class="cal-date-num">${day}</div>
        <div class="cal-info">${shiftSummary(shift)}</div>
      `;
      cell.addEventListener("click", () => selectDate(iso));
      el.calendarGrid.appendChild(cell);
    }
  }

  function selectDate(iso) {
    state.selectedDate = iso;
    const [y, m] = iso.split("-").map(Number);
    state.calendarYear = y;
    state.calendarMonth = m;
    renderCalendarView();
  }

  el.prevMonthBtn.addEventListener("click", () => {
    state.calendarMonth -= 1;
    if (state.calendarMonth < 1) {
      state.calendarMonth = 12;
      state.calendarYear -= 1;
    }
    renderCalendarView();
  });

  el.nextMonthBtn.addEventListener("click", () => {
    state.calendarMonth += 1;
    if (state.calendarMonth > 12) {
      state.calendarMonth = 1;
      state.calendarYear += 1;
    }
    renderCalendarView();
  });

  function renderDayDetail(shiftsByDate) {
    if (!state.selectedDate) {
      el.dayDetailCard.hidden = true;
      return;
    }
    const shift = shiftsByDate[state.selectedDate];
    const weekday = Parser.weekdayFromDate(state.selectedDate);
    el.dayDetailCard.hidden = false;
    el.dayDetailDate.textContent = `${state.selectedDate} (週${weekday})`;
    el.dayDetailTime.textContent = shift
      ? shift.start || shift.end
        ? `${shift.start || "--:--"} - ${shift.end || "--:--"}`
        : "未設定時間"
      : "尚未新增班表";
    el.dayDetailNote.textContent = shift ? shift.note || "" : "";
    el.dayDetailDeleteBtn.hidden = !shift;
    el.dayDetailEditBtn.textContent = shift ? "編輯" : "新增";
    renderDayTimeline(shift, state.selectedDate);
  }

  function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  function renderDayTimeline(shift, dateISO) {
    el.dayTimelineWrap.innerHTML = "";
    if (!shift || !shift.start || !shift.end) return;

    let startMin = timeToMinutes(shift.start);
    let endMin = timeToMinutes(shift.end);
    if (endMin <= startMin) endMin = 24 * 60; // guard against bad/overnight data

    const startPct = (startMin / 1440) * 100;
    const endPct = (endMin / 1440) * 100;

    const wrap = document.createElement("div");
    wrap.className = "day-timeline";

    const labelRow = document.createElement("div");
    labelRow.className = "timeline-label-row";
    labelRow.innerHTML = `
      <span class="timeline-end-label" style="left:${startPct}%">${shift.start}</span>
      <span class="timeline-end-label" style="left:${endPct}%; transform:translateX(-100%)">${shift.end}</span>
    `;

    const track = document.createElement("div");
    track.className = "timeline-track";
    const fill = document.createElement("div");
    fill.className = "timeline-fill";
    fill.style.left = startPct + "%";
    fill.style.width = endPct - startPct + "%";
    track.appendChild(fill);

    const todayISO = toISODate(new Date());
    if (dateISO === todayISO) {
      const now = new Date();
      const nowPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
      const nowMark = document.createElement("div");
      nowMark.className = "timeline-now";
      nowMark.style.left = nowPct + "%";
      track.appendChild(nowMark);
    }

    const hours = document.createElement("div");
    hours.className = "timeline-hours";
    hours.innerHTML = "<span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>";

    wrap.append(labelRow, track, hours);
    el.dayTimelineWrap.appendChild(wrap);
  }

  el.dayDetailEditBtn.addEventListener("click", () => {
    if (!state.selectedDate) return;
    editShiftForDate(state.selectedDate);
  });

  el.dayDetailDeleteBtn.addEventListener("click", () => {
    const shift = Storage.getAll().find((s) => s.date === state.selectedDate);
    if (!shift) return;
    if (confirm(`確定刪除 ${shift.date} 的班表？`)) {
      Storage.remove(shift.id);
      renderCalendarView();
    }
  });

  function editShiftForDate(date) {
    const shift = Storage.getAll().find((s) => s.date === date);
    if (shift) {
      state.rows = [{ ...shift }];
    } else {
      const row = emptyRow();
      row.date = date;
      row.weekday = Parser.weekdayFromDate(date);
      state.rows = [row];
    }
    renderTable();
    el.rawTextOutput.textContent = "(手動新增／編輯班表，無原始辨識文字)";
    el.resultSection.hidden = false;
    switchView("view-upload");
    el.resultSection.scrollIntoView({ behavior: "smooth" });
  }

  // ---------- PWA service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW 註冊失敗", e));
    });
  }

  renderCalendarView();
})();
