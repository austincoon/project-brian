export const THEMES = ["default", "dark", "wacky", "medieval", "pixel", "gothic"];
export const THEME_STORAGE_KEY = "project-brian-theme";

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : "default";
}

export function loadTheme(storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "default";
  }
}

export function applyTheme(root, storage, value) {
  const theme = normalizeTheme(value);
  // Dark is the default skin with a dark palette layered on top.
  root.dataset.theme = theme === "dark" ? "default" : theme;
  if (theme === "dark") root.dataset.dark = "";
  else delete root.dataset.dark;
  try { storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Preference remains active for this page. */ }
  return theme;
}
