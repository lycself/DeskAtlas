"use client";

import { CircleAlert, RefreshCw, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useModalLayer } from "@/app/hooks/useModalLayer";
import { fold, fuzzyMatch } from "@/app/lib/search";

export type CommandEntry = { key: string; icon: LucideIcon; title: ReactNode; meta?: ReactNode; badge?: ReactNode; run: () => void };
export type CommandGroup = { label: string; entries: CommandEntry[] };

/** Marks the part of `text` that `term` matched; `fuzzy` also marks characters matched in order with gaps. */
export function Highlight({ text, term, fuzzy = false }: { text: string; term: string; fuzzy?: boolean }) {
  const match = fuzzy ? fuzzyMatch(text, term) : (() => {
    const index = term ? fold(text).indexOf(fold(term)) : -1;
    return index < 0 ? null : { ranges: [[index, index + term.length]] };
  })();
  if (!match?.ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of match.ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * The ⌘K / Ctrl K palette shared by the admin and student pages. The caller turns the committed query
 * into groups of entries; the palette owns the input, keyboard selection and the modal layer.
 * `pending` says the groups do not yet answer the latest query: Enter then waits for them.
 */
export function CommandPalette({ label, placeholder, groups, onQuery, pending = false, error = "", idle, empty, tip, onClose }: {
  label: string;
  placeholder: string;
  groups: CommandGroup[];
  onQuery: (query: string) => void;
  pending?: boolean;
  error?: string;
  idle?: ReactNode;
  empty?: (query: string) => ReactNode;
  tip?: ReactNode;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  // Pinyin composition fires input events for every keystroke; search only once the characters are committed.
  const [term, setTerm] = useState("");
  const composing = useRef(false);
  const [active, setActive] = useState(0);
  // Enter pressed before the latest keystroke's results arrived opens the first fresh result instead of a stale one.
  const enterWhenReady = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useModalLayer(panel, onClose, { focusPanel: false });

  const query = term.trim();
  const shown = useMemo(() => {
    let index = 0;
    return groups.filter((group) => group.entries.length).map((group) => ({ ...group, entries: group.entries.map((entry) => ({ entry, index: index++ })) }));
  }, [groups]);
  const entries = useMemo(() => shown.flatMap((group) => group.entries.map(({ entry }) => entry)), [shown]);
  useEffect(() => {
    setActive(0);
    if (enterWhenReady.current && !pending) { enterWhenReady.current = false; entries[0]?.run(); }
  }, [entries, pending]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, entries]);

  const settle = (value: string) => {
    setText(value);
    if (composing.current) return;
    setTerm(value);
    onQuery(value.trim());
    enterWhenReady.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!entries.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!pending || error) entries[active]?.run();
      else enterWhenReady.current = true;
    } else if (event.key === "Tab") {
      // The input is the only focus stop; options are reached with the arrow keys.
      event.preventDefault();
    }
  };

  const waiting = !!query && pending && !error;
  const nothing = !!query && !waiting && !error && entries.length === 0;

  return (
    <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={label} ref={panel}>
        <label className="command-input">
          {waiting ? <RefreshCw className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          <input
            autoFocus role="combobox" aria-expanded="true" aria-controls="command-results" aria-autocomplete="list"
            aria-activedescendant={entries[active] ? `command-option-${active}` : undefined}
            aria-label={placeholder} placeholder={placeholder} maxLength={80}
            value={text} onChange={(event) => settle(event.target.value)} onKeyDown={onKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => { composing.current = false; settle(event.currentTarget.value); }}
          />
          <button type="button" className="icon-button command-close" aria-label={`关闭${label}`} onClick={onClose}><X size={18} /></button>
        </label>
        <div className="command-results" id="command-results" role="listbox" aria-label="搜索结果" ref={list}>
          {error && <p className="command-note error"><CircleAlert size={16} />{error}</p>}
          {!query && !entries.length && idle && <p className="command-note">{idle}</p>}
          {nothing && <p className="command-note">{empty ? empty(query) : `没有找到与“${query}”相关的结果。`}</p>}
          {shown.map((group) => <div key={group.label} role="group" aria-label={group.label}>
            <div className="command-group-label" aria-hidden="true">{group.label}</div>
            {group.entries.map(({ entry, index }) => {
              const Icon = entry.icon;
              return <div
                key={entry.key} id={`command-option-${index}`} role="option" aria-selected={index === active} data-active={index === active}
                className="command-option" onMouseMove={() => { if (active !== index) setActive(index); }}
                onMouseDown={(event) => event.preventDefault()} onClick={entry.run}
              >
                <Icon aria-hidden="true" />
                <span className="command-option-text"><strong>{entry.title}</strong>{entry.meta && <small>{entry.meta}</small>}</span>
                {entry.badge && <span className="command-option-badge">{entry.badge}</span>}
              </div>;
            })}
          </div>)}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>打开</span>
          {tip && <span className="command-footer-tip">{tip}</span>}
        </footer>
      </div>
    </div>
  );
}
