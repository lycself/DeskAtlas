"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; disabled?: boolean; group?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  searchable?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Smaller control for toolbars and dense tables. */
  compact?: boolean;
  /** Menus beside action buttons share their surface and density. */
  appearance?: "field" | "action";
  icon?: ReactNode;
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
export function Select({ value, onChange, options, placeholder = "请选择", required, disabled, compact, appearance = "field", icon, className = "", searchable = options.length > 8, ...rest }: Props) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<Placement | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const visible = options.map((option, index) => ({ option, index })).filter(({ option }) => !query || `${option.group ?? ""} ${option.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  const enabled = useCallback((index: number) => !!options[index] && !options[index].disabled && (!query || `${options[index].group ?? ""} ${options[index].label}`.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const step = (from: number, delta: number) => {
    for (let index = from + delta; index >= 0 && index < options.length; index += delta) if (enabled(index)) return index;
    return from;
  };
  const edge = (fromEnd: boolean) => fromEnd ? step(options.length, -1) : step(-1, 1);

  const show = () => {
    if (disabled || !anchor.current) return;
    setQuery("");
    setPosition(place(anchor.current));
    setActive(selectedIndex >= 0 ? selectedIndex : edge(false));
    setOpen(true);
  };
  const hide = (restore = false) => { setOpen(false); setQuery(""); if (restore) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); };
  const choose = (index: number) => {
    if (!enabled(index)) return;
    hide(searchable);
    if (options[index].value !== value) onChange(options[index].value);
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus({ preventScroll: true });
  }, [open, searchable]);
  useLayoutEffect(() => {
    const menu = list.current;
    const option = menu?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || !menu || !option) return;
    // Scroll only the menu, never its containing page or dialog.
    const bounds = menu.getBoundingClientRect(), item = option.getBoundingClientRect();
    if (item.top < bounds.top + 6) menu.scrollTop -= bounds.top + 6 - item.top;
    else if (item.bottom > bounds.bottom - 6) menu.scrollTop += item.bottom - bounds.bottom + 6;
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const reposition = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      if (anchor.current) setPosition(place(anchor.current));
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !list.current?.contains(target)) hide();
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

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement | HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || disabled) return;
    const key = event.key;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") { event.preventDefault(); show(); }
      else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) seek(key);
      return;
    }
    if (key === "Escape") {
      // Closing the list must not also close the dialog around it.
      event.preventDefault(); event.stopPropagation(); hide(searchable);
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault(); setActive((index) => step(index, key === "ArrowDown" ? 1 : -1));
    } else if (!searchable && (key === "Home" || key === "End" || key === "PageUp" || key === "PageDown")) {
      event.preventDefault(); setActive(edge(key === "End" || key === "PageDown"));
    } else if (key === "Enter" || (!searchable && key === " ")) {
      event.preventDefault(); choose(active);
    } else if (key === "Tab") {
      // Let native Tab move from the search input before replacing it with the trigger.
      if (searchable) requestAnimationFrame(() => hide()); else hide();
    } else if (!searchable && key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      seek(key);
    }
  };

  const listId = `${id}-list`;
  return (
    <span ref={anchor} className={`select-control ${compact ? "compact" : ""} ${appearance === "action" ? "select-action" : ""} ${className}`}>
      {open && searchable ? <input ref={search} className="select-search" role="combobox" aria-label={`搜索${rest["aria-label"] ?? "选项"}`} aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-required={required || undefined} aria-activedescendant={enabled(active) ? `${id}-option-${active}` : undefined} value={query} placeholder="输入关键词筛选" onChange={(event) => { const text = event.target.value; setQuery(text); setActive(options.findIndex((option) => !option.disabled && `${option.group ?? ""} ${option.label}`.toLowerCase().includes(text.trim().toLowerCase()))); }} onKeyDown={onKeyDown} /> : <button
        ref={trigger} type="button" role="combobox" className="select-trigger" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        aria-label={rest["aria-label"]} aria-required={required || undefined}
        onClick={() => (open ? hide() : show())} onKeyDown={onKeyDown}
      >
        {icon && <span className="select-icon" aria-hidden="true">{icon}</span>}
        <span className={selected ? "select-value" : "select-value placeholder"}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>}
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
          {visible.map(({ option, index }, visibleIndex) => <div key={option.value}>
            {option.group && option.group !== visible[visibleIndex - 1]?.option.group && <div className="select-group">{option.group}</div>}

            <div
              key={option.value} id={`${id}-option-${index}`} role="option" className="select-option"
              aria-selected={index === selectedIndex} aria-disabled={option.disabled || undefined} data-active={index === active}
              onMouseMove={() => { if (index !== active && enabled(index)) setActive(index); }}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>{index === selectedIndex && <Check aria-hidden="true" />}
            </div>
          </div>)}
          {!visible.length && <div className="select-empty">{query ? "没有匹配项，请换个关键词" : "没有可选项"}</div>}
        </div>,
        document.body,
      )}
    </span>
  );
}
