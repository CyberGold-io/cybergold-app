"use client";

import type { InputHTMLAttributes, Ref } from "react";
import { useLocale } from "next-intl";
import { ungroupLocalizedNumber } from "../utils/formatting";
import { decimalFromPaste, editNumberInput, replaceNumberInput, numberInputEditing } from "../utils/numberInput";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  ref?: Ref<HTMLInputElement>;
  onValueChange?: (value: string) => void;
};

/** Grouping remains visible, but editing and the clipboard operate on number characters. */
export function LocalizedNumberInput({ value, onValueChange, ...props }: Props) {
  const locale = useLocale();
  const commit = (input: HTMLInputElement, edit: { value: string; selectionStart: number }) => {
    input.value = edit.value;
    onValueChange?.(edit.value);
    input.setSelectionRange(edit.selectionStart, edit.selectionStart);
  };
  return <input {...props} type="text" inputMode="decimal" value={value}
    onChange={event => {
      const native = event.nativeEvent as InputEvent;
      commit(event.currentTarget, editNumberInput(value, event.currentTarget.value, locale,
        native.inputType, event.currentTarget.selectionStart, native.data));
    }}
    onKeyDown={event => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      numberInputEditing(locale).moveCursor(event.currentTarget, event.nativeEvent);
    }}
    onCopy={event => {
      props.onCopy?.(event);
      if (event.defaultPrevented) return;
      const input = event.currentTarget;
      const selected = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
      event.clipboardData.setData("text/plain", ungroupLocalizedNumber(selected, locale));
      event.preventDefault();
    }}
    onCut={event => {
      props.onCut?.(event);
      if (event.defaultPrevented) return;
      const input = event.currentTarget;
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      event.clipboardData.setData("text/plain", ungroupLocalizedNumber(input.value.slice(start, end), locale));
      event.preventDefault();
      if (!input.readOnly && !input.disabled && start !== end) commit(input, replaceNumberInput(value, locale, start, end, ""));
    }}
    onPaste={event => {
      props.onPaste?.(event);
      const input = event.currentTarget;
      if (event.defaultPrevented || input.readOnly || input.disabled) return;
      event.preventDefault();
      commit(input, replaceNumberInput(value, locale, input.selectionStart ?? 0, input.selectionEnd ?? 0,
        decimalFromPaste(event.clipboardData.getData("text/plain"), locale)));
    }} />;
}
