/**
 * The pieces every panel is built from: a panel, a labelled field, a row list.
 *
 * Two decisions are worth knowing before editing anything here.
 *
 * **A number field holds a draft.** An `<input>` can be empty or halfway through `-1`,
 * and a character cannot: the schema wants a whole number inside its bounds on every
 * save. So the input keeps what was typed as local state and only commits a value the
 * moment it parses, clamped. Backspacing the last digit leaves the box empty and the
 * character on its last good value, rather than snapping the box to zero under the
 * caret. The draft is dropped on blur, which is also how a clamped value reappears.
 *
 * **Every input is labelled.** `useId` ties the label to the control, so a per-row field
 * whose column header already says what it is can hide its label visually and still
 * announce it. Nothing here renders markup from a string — text nodes only, which is
 * what React gives by default and what CLAUDE.md §2.6 requires.
 */

import type { ReactElement, ReactNode } from 'react';
import { useId, useState } from 'react';
import { clampInt } from '../state/character-edits';

/** A section of the sheet: a black banner and the paper below it. DESIGN.md §6. */
export function Panel({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** A number the banner carries on its right — a slot count, a spell DC. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="panel">
      <h2 className="panel__banner">
        <span className="panel__title">{title}</span>
        {aside === undefined ? null : <span className="panel__aside">{aside}</span>}
      </h2>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Shown where a list is empty, so a panel never reads as broken. */
export function EmptyNote({ children }: { readonly children: ReactNode }): ReactElement {
  return <p className="empty-note">{children}</p>;
}

/** A warning that degrades rather than blocks. PRD.md principle 4. */
export function Warning({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <p className="warning" role="status">
      {children}
    </p>
  );
}

/**
 * `maxLength` is optional for one reason only: a field whose `onChange` normalises what
 * was typed is already bounded, and a raw cap on top of it truncates the wrong thing —
 * a room code pasted as `ABC-DEF` loses its last character to a `maxLength` of six
 * before normalising ever sees the hyphen. Everywhere else, pass the bound.
 *
 * `readOnly` is for a value the app produced and the player only needs to copy.
 */
export function TextField({
  label,
  value,
  maxLength,
  onChange,
  placeholder,
  hideLabel = false,
  readOnly = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly hideLabel?: boolean;
  readonly readOnly?: boolean;
}): ReactElement {
  const id = useId();

  return (
    <div className="field">
      <label className={hideLabel ? 'field__label visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  maxLength,
  rows,
  onChange,
  placeholder,
  hideLabel = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly maxLength: number;
  readonly rows: number;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly hideLabel?: boolean;
}): ReactElement {
  const id = useId();

  return (
    <div className="field field--wide">
      <label className={hideLabel ? 'field__label visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="field__input field__input--area"
        value={value}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hideLabel = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly hideLabel?: boolean;
}): ReactElement {
  const id = useId();

  /** What is in the box while it is being typed in. Null means "show the real value". */
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="field field--number">
      <label className={hideLabel ? 'field__label visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input field__input--number"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft(typed);

          // An empty box, a lone minus sign, a trailing `e` — all of them are on the way
          // to a number and none of them is one. The character keeps its last good value.
          const parsed = Number(typed);
          if (typed.trim() === '' || Number.isNaN(parsed)) return;

          onChange(clampInt(parsed, min, max));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hideLabel = false,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hideLabel?: boolean;
}): ReactElement {
  const id = useId();

  return (
    <div className="field field--check">
      <input
        id={id}
        className="field__check"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className={hideLabel ? 'field__label visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

/** Adds a row. Disabled at the list's cap, with the reason said out loud beside it. */
export function AddRowButton({
  label,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="button button--add" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

/** Removes one row. Labelled with what it removes, because the glyph alone is not. */
export function RemoveRowButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="button button--remove" title={label} onClick={onClick}>
      <span aria-hidden="true">{'×'}</span>
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
