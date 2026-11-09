import {
  formatDecimalInputForCursor,
  getLocaleDecimalSeparator,
  getLocaleGroupSeparator,
  ungroupLocalizedNumber,
} from "./formatting.ts";

/** Paste follows locale grouping; typing either punctuation always enters a decimal. */
export function decimalFromPaste(value: string, locale: string) {
  const raw = value.trim().replace(/[\s'’]/g, "");
  const dot = raw.lastIndexOf(".");
  const comma = raw.lastIndexOf(",");
  let decimal = getLocaleDecimalSeparator(locale);
  if (dot >= 0 && comma >= 0) decimal = dot > comma ? "." : ",";
  else {
    const punctuation = dot >= 0 ? "." : comma >= 0 ? "," : "";
    const group = getLocaleGroupSeparator(locale);
    const parts = punctuation ? raw.replace(/^-/, "").split(punctuation) : [];
    const grouped = punctuation === group && parts.length > 1
      && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(part => /^\d{3}$/.test(part));
    if (grouped) return raw.split(punctuation).join("").replace(/[^\d-]/g, "");
    if (punctuation) decimal = punctuation;
  }
  const separatorIndex = raw.lastIndexOf(decimal);
  const integer = (separatorIndex < 0 ? raw : raw.slice(0, separatorIndex)).replace(/[.,]/g, "");
  const fraction = separatorIndex < 0 ? "" : `.${raw.slice(separatorIndex + 1).replace(/[.,]/g, "")}`;
  return `${integer}${fraction}`.replace(/[^\d.-]/g, "");
}

/** Apply an edit in logical characters, then put decorative grouping back. */
export function replaceNumberInput(
  previous: string, locale: string, start: number, end: number, inserted: string,
) {
  const before = ungroupLocalizedNumber(previous.slice(0, start), locale);
  const after = ungroupLocalizedNumber(previous.slice(end), locale);
  const decimal = getLocaleDecimalSeparator(locale);
  const text = inserted.replace(/[.,]/g, decimal);
  return formatDecimalInputForCursor(before + text + after, locale, before.length + text.length);
}

/** Native input also covers mobile deletion and input methods without keydown. */
export function editNumberInput(
  previous: string, next: string, locale: string, inputType = "",
  selectionStart?: number | null, data?: string | null,
) {
  // InputEvent data identifies inserted punctuation even when a replacement
  // happens to share a prefix with an old grouping separator.
  if (inputType.startsWith("insert") && data != null && selectionStart != null) {
    return replaceNumberInput(previous, locale, selectionStart - data.length,
      previous.length - (next.length - selectionStart), data);
  }
  if (inputType.startsWith("delete") && selectionStart != null) {
    const end = selectionStart + previous.length - next.length;
    if (end > selectionStart && !ungroupLocalizedNumber(previous.slice(selectionStart, end), locale)) {
      return deleteNumberInput(previous, locale, selectionStart, end, inputType.endsWith("Backward"));
    }
    return replaceNumberInput(previous, locale, selectionStart, end, "");
  }
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
  // Deleting only decoration must still remove the adjacent editable character.
  if (start < end && !ungroupLocalizedNumber(previous.slice(start, end), locale) && nextEnd === start) {
    if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
      return deleteNumberInput(previous, locale, start, end, inputType === "deleteContentBackward");
    }
  }
  return replaceNumberInput(previous, locale, start, end, next.slice(start, nextEnd));
}

export function deleteNumberInput(previous: string, locale: string, start: number, end: number, backward: boolean) {
  if (start === end || !ungroupLocalizedNumber(previous.slice(start, end), locale)) {
    if (backward) {
      while (start > 0 && !ungroupLocalizedNumber(previous[start - 1], locale)) start -= 1;
      start = Math.max(0, start - 1);
    } else {
      while (end < previous.length && !ungroupLocalizedNumber(previous[end], locale)) end += 1;
      end = Math.min(previous.length, end + 1);
    }
  }
  return replaceNumberInput(previous, locale, start, end, "");
}
