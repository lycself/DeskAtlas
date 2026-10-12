"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; disabled?: boolean };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Smaller control for toolbars and dense tables. */
  compact?: boolean;
  className?: string;
  "aria-label"?: string;
};

type Placement = { left: number; top?: number; bottom?: number; width: number; maxHeight: number };

const GAP = 4;
const EDGE = 8;

function place(trigger: HTMLElement): Placement {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const width = viewport?.width ?? window.innerWidth;
  const below = height - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  // Open upwards only when the space below cannot show a useful list and above has more room.
  const up = below < 200 && above > below;
  const listWidth = Math.min(Math.max(rect.width, 160), width - EDGE * 2);
  const left = Math.min(Math.max(rect.left, EDGE), width - listWidth - EDGE);
  return up
    ? { left, bottom: height - rect.top + GAP, width: listWidth, maxHeight: Math.min(320, above) }
    : { left, top: rect.bottom + GAP, width: listWidth, maxHeight: Math.min(320, below) };
}

/**
 * Single-choice dropdown that replaces the native `<select>`: labels never truncate, the list is
 * portalled so dialogs and scroll areas cannot clip it, and it follows the theme. A visually hidden
 * native select keeps `required` validation and form semantics. Focus stays on the trigger; the
 * list is driven with `aria-activedescendant`.
 */
export function Select({ value, onChange, options, placeholder = "请选择", required, disabled, compact, className = "", ...rest }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<Placement | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const enabled = useCallback((index: number) => !!options[index] && !options[index].disabled, [options]);
  const step = (from: number, delta: number) => {
    for (let index = from + delta; index >= 0 && index < options.length; index += delta) if (enabled(index)) return index;
    return from;
  };
  const edge = (fromEnd: boolean) => fromEnd ? step(options.length, -1) : step(-1, 1);

  const show = () => {
    if (disabled || !trigger.current) return;
    setPosition(place(trigger.current));
    setActive(selectedIndex >= 0 ? selectedIndex : edge(false));
    setOpen(true);
  };
  const hide = () => setOpen(false);
  const choose = (index: number) => {
    if (!enabled(index)) return;
    hide();
    if (options[index].value !== value) onChange(options[index].value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => { if (trigger.current) setPosition(place(trigger.current)); };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) hide();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  // Type-ahead, like the native control: letters jump to the next matching option.
  const seek = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + key.toLowerCase(), at: now };
    const from = open ? active : Math.max(selectedIndex, 0);
    const order = [...options.keys()].map((offset) => (from + (typed.current.text.length === 1 ? 1 : 0) + offset) % options.length);
    const match = order.find((index) => enabled(index) && options[index].label.toLowerCase().startsWith(typed.current.text));
    if (match === undefined) return;
    if (open) setActive(match); else if (options[match].value !== value) onChange(options[match].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || disabled) return;
    const key = event.key;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") { event.preventDefault(); show(); }
      else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) seek(key);
      return;
    }
    if (key === "Escape") {
      // Closing the list must not also close the dialog around it.
      event.preventDefault(); event.stopPropagation(); hide();
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault(); setActive((index) => step(index, key === "ArrowDown" ? 1 : -1));
    } else if (key === "Home" || key === "End" || key === "PageUp" || key === "PageDown") {
      event.preventDefault(); setActive(edge(key === "End" || key === "PageDown"));
    } else if (key === "Enter" || key === " ") {
      event.preventDefault(); choose(active);
    } else if (key === "Tab") {
      hide();
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      seek(key);
    }
  };

  const listId = `${id}-list`;
  return (
    <span className={`select-control ${compact ? "compact" : ""} ${className}`}>
      <button
        ref={trigger} type="button" role="combobox" className="select-trigger" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        aria-label={rest["aria-label"]} aria-required={required || undefined}
        onClick={() => (open ? hide() : show())} onKeyDown={onKeyDown}
      >
        <span className={selected ? "select-value" : "select-value placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      <select
        className="select-native" tabIndex={-1} aria-hidden="true" required={required} disabled={disabled}
        value={selected ? value : ""} onChange={(event) => onChange(event.target.value)}
        onFocus={() => trigger.current?.focus()}
      >
        {!selected && <option value="" />}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      {open && position && createPortal(
        <div
          ref={list} id={listId} role="listbox" className="select-list" aria-label={rest["aria-label"]}
          style={{ left: position.left, top: position.top, bottom: position.bottom, minWidth: position.width, maxHeight: position.maxHeight }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={option.value} id={`${id}-option-${index}`} role="option" className="select-option"
              aria-selected={index === selectedIndex} aria-disabled={option.disabled || undefined} data-active={index === active}
              onMouseMove={() => { if (index !== active && enabled(index)) setActive(index); }}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>{index === selectedIndex && <Check aria-hidden="true" />}
            </div>
          ))}
          {!options.length && <div className="select-empty">没有可选项</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}
