export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_PREFERENCE_KEY = "theme";

export function parseTheme(value: string | null | undefined): Theme | null {
  if (value === "light" || value === "dark") {
    return value;
  }

  return null;
}