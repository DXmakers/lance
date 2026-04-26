"use client";

import { useCallback, useId, useMemo, useRef } from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";

/**
 * Rich text editor for job and bid descriptions (#143).
 *
 * The editor is intentionally markdown-driven rather than wrapping a heavy WYSIWYG
 * library — content is stored as plain markdown so it round-trips cleanly through
 * the on-chain metadata hash and the existing TanStack Query payloads. The toolbar
 * exposes the four formatting primitives requested by the issue (bold, italic,
 * unordered list, link) by mutating the underlying `<textarea>` selection so
 * markdown power-users can keep typing without leaving the keyboard.
 */
export interface RichTextEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Minimum characters required (Zod). Defaults to 0. */
  minLength?: number;
  /** Maximum characters allowed (Zod). Defaults to 5_000. */
  maxLength?: number;
  /** Optional id for label association. Auto-generated when omitted. */
  id?: string;
  /** Disables the editor + toolbar. */
  disabled?: boolean;
  /** Externally-supplied error to display below the editor. */
  error?: string;
  /** ARIA label when no visible label is rendered above the field. */
  ariaLabel?: string;
  /** Optional override for `data-testid` on the root container. */
  testId?: string;
  className?: string;
}

const DEFAULT_MAX = 5_000;

export interface RichTextEditorValidation {
  ok: boolean;
  errors: string[];
}

/** Zod-backed validation hook callers can run on submit. */
export function buildRichTextSchema(minLength = 0, maxLength = DEFAULT_MAX) {
  return z
    .string()
    .min(minLength, { message: `Description must be at least ${minLength} characters.` })
    .max(maxLength, { message: `Description cannot exceed ${maxLength} characters.` });
}

export function validateRichText(
  value: string,
  minLength = 0,
  maxLength = DEFAULT_MAX,
): RichTextEditorValidation {
  const result = buildRichTextSchema(minLength, maxLength).safeParse(value);
  if (result.success) return { ok: true, errors: [] };
  return { ok: false, errors: result.error.issues.map((issue) => issue.message) };
}

interface ToolbarAction {
  id: "bold" | "italic" | "list" | "link";
  label: string;
  shortLabel: string;
}

const ACTIONS: ToolbarAction[] = [
  { id: "bold", label: "Bold", shortLabel: "B" },
  { id: "italic", label: "Italic", shortLabel: "I" },
  { id: "list", label: "Unordered list", shortLabel: "•" },
  { id: "link", label: "Insert link", shortLabel: "↗" },
];

function applyAction(
  textarea: HTMLTextAreaElement,
  action: ToolbarAction["id"],
): { next: string; selectionStart: number; selectionEnd: number } {
  const value = textarea.value;
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);

  switch (action) {
    case "bold": {
      const wrapped = `**${selected || "bold text"}**`;
      const next = value.slice(0, start) + wrapped + value.slice(end);
      return {
        next,
        selectionStart: start + 2,
        selectionEnd: start + 2 + (selected.length || "bold text".length),
      };
    }
    case "italic": {
      const wrapped = `_${selected || "italic text"}_`;
      const next = value.slice(0, start) + wrapped + value.slice(end);
      return {
        next,
        selectionStart: start + 1,
        selectionEnd: start + 1 + (selected.length || "italic text".length),
      };
    }
    case "list": {
      const lines = (selected || "List item").split("\n");
      const bulleted = lines.map((line) => (line.startsWith("- ") ? line : `- ${line}`)).join("\n");
      const next = value.slice(0, start) + bulleted + value.slice(end);
      return {
        next,
        selectionStart: start,
        selectionEnd: start + bulleted.length,
      };
    }
    case "link": {
      const label = selected || "link text";
      const wrapped = `[${label}](https://)`;
      const next = value.slice(0, start) + wrapped + value.slice(end);
      // Place caret inside the URL so the user can paste / type.
      const urlStart = start + label.length + 3; // `[` + label + `](`
      return {
        next,
        selectionStart: urlStart,
        selectionEnd: urlStart + "https://".length,
      };
    }
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Describe the work in detail. Markdown is supported.",
  minLength = 0,
  maxLength = DEFAULT_MAX,
  id,
  disabled = false,
  error,
  ariaLabel,
  testId = "rich-text-editor",
  className,
}: RichTextEditorProps) {
  const generatedId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = id ?? generatedId;
  const counterId = `${fieldId}-counter`;
  const errorId = `${fieldId}-error`;

  const validation = useMemo(
    () => validateRichText(value, minLength, maxLength),
    [value, minLength, maxLength],
  );
  const inlineError = error ?? (validation.ok ? null : validation.errors[0]);

  const handleAction = useCallback(
    (action: ToolbarAction["id"]) => {
      const ta = textareaRef.current;
      if (!ta || disabled) return;
      const result = applyAction(ta, action);
      onChange(result.next);
      // Restore selection after React reconciles the new value.
      window.requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [disabled, onChange],
  );

  const overLimit = value.length > maxLength;
  const remaining = maxLength - value.length;

  return (
    <div
      className={cn("rounded-xl border border-zinc-800/80 bg-zinc-950/60", className)}
      data-testid={testId}
    >
      <div
        role="toolbar"
        aria-label="Formatting toolbar"
        className="flex flex-wrap gap-1 border-b border-zinc-800/80 px-2 py-1.5"
        data-testid={`${testId}-toolbar`}
      >
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => handleAction(action.id)}
            aria-label={action.label}
            title={action.label}
            disabled={disabled}
            className="inline-flex items-center justify-center rounded-md border border-transparent px-2 py-1 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`${testId}-${action.id}`}
          >
            {action.shortLabel}
          </button>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={`${counterId}${inlineError ? ` ${errorId}` : ""}`}
        aria-invalid={inlineError ? true : undefined}
        rows={6}
        className="block w-full resize-y bg-transparent px-3 py-2 font-sans text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        data-testid={`${testId}-textarea`}
      />
      <div className="flex items-center justify-between border-t border-zinc-800/80 px-3 py-1.5 text-xs">
        {inlineError ? (
          <span
            id={errorId}
            role="alert"
            className="text-rose-400"
            data-testid={`${testId}-error`}
          >
            {inlineError}
          </span>
        ) : (
          <span className="text-zinc-500">Markdown supported</span>
        )}
        <span
          id={counterId}
          className={cn("font-mono text-[11px]", overLimit ? "text-rose-400" : "text-zinc-500")}
          data-testid={`${testId}-counter`}
        >
          {remaining}
        </span>
      </div>
    </div>
  );
}

export default RichTextEditor;
