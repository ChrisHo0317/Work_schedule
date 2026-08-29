const Storage = (() => {
  const KEY = "workSchedule.shifts";
  const SETTINGS_KEY = "workSchedule.settings";

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function setSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function getAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("讀取班表失敗", e);
      return [];
    }
  }

  function saveAll(shifts) {
    localStorage.setItem(KEY, JSON.stringify(shifts));
  }

  function upsertMany(newShifts) {
    const existing = getAll();
    newShifts.forEach((shift) => {
      const idx = existing.findIndex((s) => s.id === shift.id);
      if (idx >= 0) existing[idx] = shift;
      else existing.push(shift);
    });
    saveAll(existing);
    return existing;
  }

  function remove(id) {
    const existing = getAll().filter((s) => s.id !== id);
    saveAll(existing);
    return existing;
  }

  function update(id, patch) {
    const existing = getAll();
    const idx = existing.findIndex((s) => s.id === id);
    if (idx >= 0) existing[idx] = { ...existing[idx], ...patch };
    saveAll(existing);
    return existing;
  }

  return { getAll, saveAll, upsertMany, remove, update, getSettings, setSetting };
})();
