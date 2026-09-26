import { useId, useState, type ReactNode } from 'react';

export interface TabItem {
  /** Stable tab identity (also used as the DOM id suffix). */
  value: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled selected tab value. */
  value?: string;
  /** Uncontrolled initial tab. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  ariaLabel: string;
}

/**
 * Accessible tab strip (roving tabindex + arrow keys per WAI-ARIA).
 * Styling: `.lf-tabs__*` in src/styles/components.css.
 */
export function Tabs({ items, value, defaultValue, onChange, ariaLabel }: TabsProps) {
  const fallbackId = useId();
  const baseId = `lf-tabs-${fallbackId}`;
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.value);
  const selected = value ?? internal ?? '';

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === selected),
  );

  function select(index: number, focus = true) {
    const item = items[index];
    if (!item) return;
    if (value === undefined) setInternal(item.value);
    onChange?.(item.value);
    if (focus) {
      requestAnimationFrame(() => {
        document.getElementById(`${baseId}-tab-${item.value}`)?.focus();
      });
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const last = items.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = selectedIndex === last ? 0 : selectedIndex + 1;
        break;
      case 'ArrowLeft':
        next = selectedIndex === 0 ? last : selectedIndex - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
  }

  const activeItem = items[selectedIndex];

  return (
    <div>
      <div className="lf-tabs__list" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const isSelected = item.value === selected;
          return (
            <button
              key={item.value}
              type="button"
              id={`${baseId}-tab-${item.value}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={isSelected ? 0 : -1}
              className="lf-tabs__tab"
              onClick={() => select(items.indexOf(item), false)}
              onKeyDown={onKeyDown}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div
          key={activeItem.value}
          id={`${baseId}-panel-${activeItem.value}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeItem.value}`}
          tabIndex={0}
          className="lf-tabs__panel"
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
