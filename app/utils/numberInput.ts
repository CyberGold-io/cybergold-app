import { getLocaleDecimalSeparator, getLocaleGroupSeparator } from "./formatting.ts";

/** Self-contained: this factory is also embedded in the cached form's pre-paint script. */
export function createNumberInputEditing(decimal: string, group: string) {
  const ungroupLocalizedNumber = (value: string) =>
    (group ? value.split(group).join("") : value).replace(/[\s'’]/g, "");

  const canonical = (value: string) => {
    const raw = value.trim();
    if (!raw) return "";
    let integer = "", fraction = "", sawDecimal = false;
    for (const char of raw) {
      if (/\d/.test(char)) {
        if (sawDecimal) fraction += char;
        else integer += char;
      } else if ((char === "." || char === "," || char === decimal) && !sawDecimal) sawDecimal = true;
    }
    if (!integer && !fraction && !sawDecimal) return "";
    integer = (integer || "0").replace(/^0+(?=\d)/, "");
    return `${raw.startsWith("-") ? "-" : ""}${integer}${sawDecimal ? `.${fraction}` : ""}`;
  };

  const formatDecimalInputForCursor = (value: string, selectionStart: number) => {
    const normalized = canonical(value);
    const [integer = "", fraction] = normalized.split(".");
    const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group)
      + (fraction === undefined ? "" : decimal + fraction);
    let remaining = canonical(value.slice(0, selectionStart)).length;
    let caret = 0;
    while (caret < formatted.length && remaining > 0) {
      if (group && formatted.startsWith(group, caret)) caret += group.length;
      else { caret += 1; remaining -= 1; }
    }
    return { value: formatted, selectionStart: caret };
  };

  /** Paste follows locale grouping; typing either punctuation always enters a decimal. */
  function decimalFromPaste(value: string) {
    const raw = value.trim().replace(/[\s'’]/g, "");
    const dot = raw.lastIndexOf(".");
    const comma = raw.lastIndexOf(",");
    let separator = decimal;
    if (dot >= 0 && comma >= 0) separator = dot > comma ? "." : ",";
    else {
      const punctuation = dot >= 0 ? "." : comma >= 0 ? "," : "";
      const parts = punctuation ? raw.replace(/^-/, "").split(punctuation) : [];
      const grouped = punctuation === group && parts.length > 1
        && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(part => /^\d{3}$/.test(part));
      if (grouped) return raw.split(punctuation).join("").replace(/[^\d-]/g, "");
      if (punctuation) separator = punctuation;
    }
    const separatorIndex = raw.lastIndexOf(separator);
    const integer = (separatorIndex < 0 ? raw : raw.slice(0, separatorIndex)).replace(/[.,]/g, "");
    const fraction = separatorIndex < 0 ? "" : `.${raw.slice(separatorIndex + 1).replace(/[.,]/g, "")}`;
    return `${integer}${fraction}`.replace(/[^\d.-]/g, "");
  }

  /** Apply an edit in logical characters, then put decorative grouping back. */
  function replaceNumberInput(
    previous: string, start: number, end: number, inserted: string,
  ) {
    const before = ungroupLocalizedNumber(previous.slice(0, start));
    const after = ungroupLocalizedNumber(previous.slice(end));
    const text = inserted.replace(/[.,]/g, decimal);
    return formatDecimalInputForCursor(before + text + after, before.length + text.length);
  }

  /** Native input also covers mobile deletion and input methods without keydown. */
  function editNumberInput(
    previous: string, next: string, inputType = "",
    selectionStart?: number | null, data?: string | null,
  ) {
    // InputEvent data identifies inserted punctuation even when a replacement
    // happens to share a prefix with an old grouping separator.
    if (inputType.startsWith("insert") && data != null && selectionStart != null) {
      return replaceNumberInput(previous, selectionStart - data.length,
        previous.length - (next.length - selectionStart), data);
    }
    if (inputType.startsWith("delete") && selectionStart != null) {
      const end = selectionStart + previous.length - next.length;
      if (end > selectionStart && !ungroupLocalizedNumber(previous.slice(selectionStart, end))) {
        return deleteNumberInput(previous, selectionStart, end, inputType.endsWith("Backward"));
      }
      return replaceNumberInput(previous, selectionStart, end, "");
    }
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
    let end = previous.length;
    let nextEnd = next.length;
    while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
    // Deleting only decoration must still remove the adjacent editable character.
    if (start < end && !ungroupLocalizedNumber(previous.slice(start, end)) && nextEnd === start) {
      if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
        return deleteNumberInput(previous, start, end, inputType === "deleteContentBackward");
      }
    }
    return replaceNumberInput(previous, start, end, next.slice(start, nextEnd));
  }

  function deleteNumberInput(previous: string, start: number, end: number, backward: boolean) {
    if (start === end || !ungroupLocalizedNumber(previous.slice(start, end))) {
      if (backward) {
        while (start > 0 && !ungroupLocalizedNumber(previous[start - 1])) start -= 1;
        start = Math.max(0, start - 1);
      } else {
        while (end < previous.length && !ungroupLocalizedNumber(previous[end])) end += 1;
        end = Math.min(previous.length, end + 1);
      }
    }
    return replaceNumberInput(previous, start, end, "");
  }

  const moveCursor = (input: HTMLInputElement, event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault">) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
    const left = event.key === "ArrowLeft";
    const active = input.selectionDirection === "backward" ? start : end;
    const plain = ungroupLocalizedNumber(input.value);
    const logicalPosition = (offset: number) => ungroupLocalizedNumber(input.value.slice(0, offset)).length;
    const displayPosition = (offset: number) => formatDecimalInputForCursor(plain, offset).selectionStart;
    const logical = !event.shiftKey && start !== end ? logicalPosition(left ? start : end)
      : Math.max(0, Math.min(plain.length, logicalPosition(active) + (left ? -1 : 1)));
    const position = displayPosition(logical);
    event.preventDefault();
    if (!event.shiftKey) input.setSelectionRange(position, position);
    else {
      const anchor = displayPosition(logicalPosition(input.selectionDirection === "backward" ? end : start));
      input.setSelectionRange(Math.min(anchor, position), Math.max(anchor, position), position < anchor ? "backward" : "forward");
    }
  };

  const bind = (input: HTMLInputElement) => {
    let previous = input.value;
    const commit = (edit: { value: string; selectionStart: number }, notify = false) => {
      previous = input.value = edit.value;
      input.setSelectionRange(edit.selectionStart, edit.selectionStart);
      if (notify) input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    input.addEventListener("beforeinput", () => { previous = input.value; });
    input.addEventListener("input", event => {
      if (previous === input.value) return;
      const native = event as InputEvent;
      commit(editNumberInput(previous, input.value, native.inputType, input.selectionStart, native.data));
    });
    input.addEventListener("keydown", event => { if (!event.isComposing) moveCursor(input, event); });
    input.addEventListener("copy", event => {
      const selected = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
      event.clipboardData?.setData("text/plain", ungroupLocalizedNumber(selected));
      event.preventDefault();
    });
    input.addEventListener("cut", event => {
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      event.clipboardData?.setData("text/plain", ungroupLocalizedNumber(input.value.slice(start, end)));
      event.preventDefault();
      if (!input.readOnly && !input.disabled && start !== end) commit(replaceNumberInput(input.value, start, end, ""), true);
    });
    input.addEventListener("paste", event => {
      if (input.readOnly || input.disabled) return;
      event.preventDefault();
      commit(replaceNumberInput(input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0,
        decimalFromPaste(event.clipboardData?.getData("text/plain") ?? "")), true);
    });
  };

  return { decimalFromPaste, replaceNumberInput, editNumberInput, deleteNumberInput, moveCursor, bind };
}

const editors = new Map<string, ReturnType<typeof createNumberInputEditing>>();
export function numberInputEditing(locale: string) {
  let editor = editors.get(locale);
  if (!editor) {
    editor = createNumberInputEditing(getLocaleDecimalSeparator(locale), getLocaleGroupSeparator(locale));
    editors.set(locale, editor);
  }
  return editor;
}

export const decimalFromPaste = (value: string, locale: string) => numberInputEditing(locale).decimalFromPaste(value);
export const replaceNumberInput = (previous: string, locale: string, start: number, end: number, inserted: string) =>
  numberInputEditing(locale).replaceNumberInput(previous, start, end, inserted);
export const editNumberInput = (previous: string, next: string, locale: string, inputType = "", selectionStart?: number | null, data?: string | null) =>
  numberInputEditing(locale).editNumberInput(previous, next, inputType, selectionStart, data);
export const deleteNumberInput = (previous: string, locale: string, start: number, end: number, backward: boolean) =>
  numberInputEditing(locale).deleteNumberInput(previous, start, end, backward);
