// App-drawn dropdown. Replaces the browser's native <select>, whose option list is drawn by the browser
// and can become unreadable inside the Cribl App frame. Keyboard: arrows, Home/End, Enter/Space, Escape,
// Tab, and typing a letter to jump. Exposed to assistive technology as a combobox with a listbox.

import { useEffect, useRef, useState } from 'react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

let seq = 0;

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name, normally the field's label. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [id] = useState(() => `lm-select-${++seq}`);
  const root = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    setActive(selected);
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: { key: string; preventDefault(): void }) => {
    const last = options.length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      setActive((a) => Math.min(last, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!open) return;
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) choose(active);
      else openList();
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const from = open ? active : selected;
      for (let k = 1; k <= options.length; k++) {
        const i = (from + k) % options.length;
        if (options[i].label.toLowerCase().startsWith(ch)) {
          if (open) setActive(i);
          else choose(i);
          break;
        }
      }
    }
  };

  return (
    <div className="lm-select" ref={root}>
      <button
        type="button"
        role="combobox"
        className="lm-select-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        data-value={String(value)}
        onClick={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKey}
      >
        <span className="lm-select-text">{options[selected]?.label ?? ''}</span>
        <span className="lm-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="lm-select-list" role="listbox" id={`${id}-list`} aria-label={label} ref={list}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              className={`lm-select-option${i === active ? ' lm-select-active' : ''}${o.value === value ? ' lm-select-selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => {
                // The field is a <label>: without this, the click would also re-activate the button.
                e.preventDefault();
                choose(i);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
