"use client";

import { PencilLine } from "lucide-react";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

/**
 * A form over values that are already saved. It reads as plain text until 编辑 is pressed, so a
 * stray click or keystroke cannot change anything; then 保存 submits and 取消 (or Esc) puts the
 * saved values back. The fields sit in a disabled <fieldset> while reading, which also disables
 * every Select and button inside.
 *
 * The caller owns the values: `onCancel` restores them, and a successful save sets `editing` false.
 */
export function EditableForm({ editing, onEdit, onCancel, onSubmit, busy = false, canEdit = true, editLabel = "编辑", saveLabel = "保存", className = "", actionsClassName = "", header, children, extraActions }: {
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  canEdit?: boolean;
  editLabel?: string;
  saveLabel?: string;
  className?: string;
  actionsClassName?: string;
  /** Rendered above the fields and outside the locked fieldset, so links in it stay usable. */
  header?: ReactNode;
  children: ReactNode;
  /** Shown beside 编辑 while reading, such as a link that opens the record elsewhere. */
  extraActions?: ReactNode;
}) {
  const fields = useRef<HTMLFieldSetElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    // An empty field reads "未填写" through :placeholder-shown, which needs some placeholder to exist.
    fields.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([placeholder]), textarea:not([placeholder])")
      .forEach((field) => field.setAttribute("placeholder", " "));
  });
  useEffect(() => {
    // Entering edit puts the caret in the first field; leaving it hands focus back to 编辑.
    if (editing && !wasEditing.current) fields.current?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=hidden]), textarea, .select-trigger")?.focus();
    // Disabling the fieldset has already dropped focus to <body> by now.
    if (!editing && wasEditing.current && (document.activeElement === document.body || fields.current?.contains(document.activeElement))) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <form
      className={`editable-form ${className}`} data-editing={editing || undefined} aria-busy={busy || undefined}
      onSubmit={(event) => { event.preventDefault(); if (editing && !busy) onSubmit(event); }}
      onKeyDown={(event) => {
        // A dropdown inside may already have used Escape to close itself.
        if (event.key === "Escape" && editing && !busy && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); onCancel(); }
      }}
    >
      {header}
      <fieldset ref={fields} className="edit-gate" disabled={!editing}>{children}</fieldset>
      <div className={`editable-actions ${actionsClassName}`}>
        {editing ? <>
          <button type="submit" className="primary-action compact" disabled={busy}>{busy ? "正在保存…" : saveLabel}</button>
          <button type="button" className="secondary-action compact" disabled={busy} onClick={onCancel}>取消</button>
        </> : <>
          <button ref={editButton} type="button" className="secondary-action compact" disabled={!canEdit || busy} onClick={onEdit}><PencilLine />{editLabel}</button>
          {extraActions}
        </>}
      </div>
    </form>
  );
}
