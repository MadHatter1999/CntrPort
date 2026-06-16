import { messages } from "./messages";
import { state } from "../state/store";
import type { LangCode } from "../data/types";

export { languages } from "./messages";

/**
 * Translate `key` for an explicit language. Falls back to English, then to the
 * raw key so missing strings are obvious rather than blank.
 */
export function translate(
  lang: LangCode,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = messages[lang]?.[key] ?? messages.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

/** Convenience: translate using the app's current language. */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(state.lang, key, params);
}
