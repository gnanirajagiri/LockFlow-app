/**
 * Natural-language intent bar — captures creative direction text into a draft
 * field. It does NOT invoke AI and must say so; used only in editable
 * creation areas (Brief, Storyboard).
 */
import { useState } from 'react';
import { SparkIcon } from '../../components/icons';
import { Button } from '../../components/ui/Button';

export interface ContentIntentBarProps {
  label: string;
  placeholder: string;
  buttonLabel: string;
  savedNote: string;
  onApply: (text: string, mode: 'replace' | 'append') => void;
  /** Optional existing text so the bar can offer append vs replace. */
  hasExistingText?: boolean;
}

export function ContentIntentBar({
  label,
  placeholder,
  buttonLabel,
  savedNote,
  onApply,
  hasExistingText = false,
}: ContentIntentBarProps) {
  const [text, setText] = useState('');

  function apply(mode: 'replace' | 'append') {
    const value = text.trim();
    if (value === '') return;
    onApply(value, mode);
    setText('');
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-2)' }}>
      <label className="lf-field" htmlFor={`intent-${label.replace(/\s+/g, '-').toLowerCase()}`}>
        <span className="lf-field__label">{label}</span>
        <textarea
          id={`intent-${label.replace(/\s+/g, '-').toLowerCase()}`}
          className="lf-input lf-envform__textarea"
          rows={2}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<SparkIcon size={14} />}
          disabled={text.trim() === ''}
          onClick={() => apply('append')}
        >
          {buttonLabel}
        </Button>
        {hasExistingText ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={text.trim() === ''}
            onClick={() => apply('replace')}
          >
            Replace existing
          </Button>
        ) : null}
      </div>
      <p className="lf-tile__description">{savedNote}</p>
    </div>
  );
}
