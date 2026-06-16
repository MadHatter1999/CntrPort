/** Escape untrusted text for safe interpolation into innerHTML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** querySelector with a non-null assertion, scoped to an optional root. */
export function $<T extends Element = HTMLElement>(
  sel: string,
  root: ParentNode = document,
): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`Element not found: ${sel}`);
  return node;
}
