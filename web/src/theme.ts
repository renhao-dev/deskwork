import type { Theme } from '../../shared/types.ts'

const KEY = 'deskwork.theme'

/** Sets the theme on <html>; "system" leaves it to the OS setting. Also remembered in this browser. */
export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {}
}

/** The theme used last time in this browser, so the page doesn't flash before your account loads. */
export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {}
  return 'system'
}
