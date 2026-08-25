export const THEMES = ["wacky", "medieval", "pixel"];
export const THEME_STORAGE_KEY = "project-brian-theme";

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : "wacky";
}

export function loadTheme(storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "wacky";
  }
}

export function applyTheme(root, storage, value) {
  const theme = normalizeTheme(value);
  root.dataset.theme = theme;
  try { storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Preference remains active for this page. */ }
  return theme;
}
