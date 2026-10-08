import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_PRIMARY } from '../../navigation/nav';
import { SearchIcon } from '../icons';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ⌘K command palette (Stage-5 topbar search): quick-jump over the canonical
 * navigation. Opens with Cmd/Ctrl+K globally, filters as you type, navigates
 * on Enter, arrow keys move the selection, Escape closes.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_PRIMARY;
    return NAV_PRIMARY.filter((item) =>
      item.label.toLowerCase().includes(q),
    );
  }, [query]);

  // Reset state and focus the field whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      // Defer so the input exists after the first paint.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep the selected row in view while arrowing through results.
  useEffect(() => {
    const rows = listRef.current?.querySelectorAll('[role="option"]');
    rows?.[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  function commit(index: number) {
    const item = results[index];
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  return (
    <div
      className="lf-cmdk"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lf-cmdk__panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="lf-cmdk__field">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            className="lf-cmdk__input"
            type="text"
            placeholder="Search LockFlow…"
            value={query}
            aria-label="Search navigation"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((value) => Math.min(value + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                commit(selected);
              }
            }}
          />
          <span className="lf-cmdk__esc">Esc</span>
        </div>
        <div className="lf-cmdk__list" ref={listRef} role="listbox" aria-label="Navigation results">
          {results.length === 0 ? (
            <div className="lf-cmdk__empty">No matches for “{query}”</div>
          ) : (
            results.map((item, index) => (
              <button
                key={`${item.to}::${item.label}`}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`lf-cmdk__item${index === selected ? ' lf-cmdk__item--selected' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => commit(index)}
              >
                <span className="lf-cmdk__itemicon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="lf-cmdk__itemlabel">{item.label}</span>
                <span className="lf-cmdk__itemto">{item.to}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
