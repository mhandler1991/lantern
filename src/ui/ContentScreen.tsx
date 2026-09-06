/**
 * The content screen: what is loaded, in what order, and what it resolved to.
 *
 * PRD.md §5 Phase 2. A DM picks a JSON file and the app's content changes — so this
 * panel has to answer three questions a list of file names cannot: *what did that pack
 * bring*, *what does the table have now*, and *which pack put this here*. The resolution
 * stack below the list is the third one, and it is the reason the panel exists rather
 * than a checkbox in a menu.
 *
 * Four things it deliberately does.
 *
 * **It says who is responsible.** DESIGN.md §7 — one line in the upload dialog: you are
 * responsible for having the rights to what you load. It sits beside the picker rather
 * than behind a confirmation, because a licensing position nobody reads is not one.
 *
 * **It reorders with buttons, not with a drag.** Load order decides which override wins
 * (DATA-MODEL.md §9), so it must be changeable — but a drag is a mouse-only gesture that
 * needs a library, and CLAUDE.md §12 forbids installing one without asking. Two buttons
 * are keyboard-reachable, announce what they move, and are the same operation.
 *
 * **It never removes core.** Every other pack came from a file that can be picked again;
 * core is fetched once on boot, and a Remove button beside it would be a one-way door
 * out of every reference on the sheet. Turning it off is offered instead, because that
 * is reversible and PRD.md principle 6 says content is optional.
 *
 * **It warns and keeps going.** A pack that would not parse leaves everything else
 * loaded, a pack whose extension points at nothing still loads, and the core pack
 * failing to arrive is a notice above a working sheet (PRD.md principle 4). Every one of
 * those prints its problems with paths, ready to paste back (DATA-MODEL.md §10).
 *
 * Nothing here renders markup from a string. A pack name, a file name and a table name
 * are all text somebody else wrote, and they are text nodes like every value on the
 * sheet — CLAUDE.md §2.6, and this is the largest surface of foreign text in the app.
 */

import type { ChangeEvent, ReactElement } from 'react';
import { useId } from 'react';
import type { PackId } from '../model/pack';
import type { PackSummary } from '../model/pack-resolver';
import type { LoadedPack, PackSource, Packs } from '../state/use-packs';
import { PACK_FILE_ACCEPT } from '../state/pack-file';
import { describeContents, resolutionStack, stackLineText } from './content';
import { EmptyNote, Panel, Warning } from './fields';
import { ProblemReport } from './ProblemReport';

/** The first position in the list, and an empty one. Neither is a rule of the game. */
const FIRST = 0;

/** How far back the last entry sits from the length. */
const LAST_OFFSET = 1;

/** Where a pack came from, in the words a DM would use for it. */
function describeSource(source: PackSource): string {
  return source.kind === 'core' ? 'shipped with Lantern' : source.name;
}

/** One row of the load order: what it is, what it brought, and the four controls. */
function PackRow({
  held,
  summary,
  position,
  total,
  onToggle,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  readonly held: LoadedPack;
  /** The resolver's count of what it contributed, or null while it is turned off. */
  readonly summary: PackSummary | null;
  readonly position: number;
  readonly total: number;
  readonly onToggle: (id: PackId) => void;
  readonly onMoveUp: (id: PackId) => void;
  readonly onMoveDown: (id: PackId) => void;
  readonly onRemove: (id: PackId) => void;
}): ReactElement {
  const toggleId = useId();
  const { pack, source, isEnabled } = held;

  return (
    <li className={isEnabled ? 'pack' : 'pack pack--off'}>
      <div className="pack__identity">
        <span className="pack__name">{pack.name}</span>
        <span className="pack__version">{pack.version}</span>
        <span className="provenance">{describeSource(source)}</span>
      </div>

      <p className="pack__contents">
        {summary === null ? 'Turned off' : describeContents(summary.counts)}
        {(pack.author ?? '') === '' ? '' : ` · by ${pack.author}`}
      </p>

      <div className="pack__controls">
        <div className="field field--check">
          <input
            id={toggleId}
            className="field__check"
            type="checkbox"
            checked={isEnabled}
            onChange={() => onToggle(pack.id)}
          />
          <label className="field__label visually-hidden" htmlFor={toggleId}>
            {`Use ${pack.name}`}
          </label>
        </div>

        <button
          type="button"
          className="button button--move"
          disabled={position === FIRST}
          onClick={() => onMoveUp(pack.id)}
        >
          <span aria-hidden="true">{'↑'}</span>
          <span className="visually-hidden">{`Load ${pack.name} earlier`}</span>
        </button>

        <button
          type="button"
          className="button button--move"
          disabled={position >= total - LAST_OFFSET}
          onClick={() => onMoveDown(pack.id)}
        >
          <span aria-hidden="true">{'↓'}</span>
          <span className="visually-hidden">{`Load ${pack.name} later`}</span>
        </button>

        {source.kind === 'file' && (
          <button
            type="button"
            className="button button--remove"
            title={`Remove ${pack.name}`}
            onClick={() => onRemove(pack.id)}
          >
            <span aria-hidden="true">{'×'}</span>
            <span className="visually-hidden">{`Remove ${pack.name}`}</span>
          </button>
        )}
      </div>
    </li>
  );
}

export function ContentScreen({ packs }: { readonly packs: Packs }): ReactElement {
  const fileId = useId();
  const { loaded, stack, core, pick } = packs;

  /** Summaries by pack id. A pack that is turned off is not in the stack and has none. */
  const summaries = new Map(stack.packs.map((summary) => [summary.id, summary]));
  const lines = resolutionStack(stack);

  function pickFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[FIRST] ?? null;

    // Cleared so that picking the same file twice fires a second change — a DM who fixes
    // a pack their model wrote and picks it again is the likeliest second pick there is.
    event.target.value = '';
    if (file === null) return;

    void packs.addFile(file);
  }

  return (
    <Panel title="Content" aside={loaded.length === FIRST ? undefined : loaded.length}>
      <p className="readout">
        Packs carry names, mechanics and page references — the classes, ancestries, spells,
        items and tables the pickers offer. They are optional: the sheet works with none
        loaded. Nothing is uploaded anywhere, and what you load lasts as long as this tab.
      </p>

      <div className="field field--wide">
        <label className="field__label" htmlFor={fileId}>
          Pack file
        </label>
        <input
          id={fileId}
          className="field__input field__input--file"
          type="file"
          accept={PACK_FILE_ACCEPT}
          onChange={pickFile}
        />
      </div>

      <p className="readout">
        You are responsible for having the rights to whatever you load.
      </p>

      {core.kind === 'loading' && (
        <p className="readout" role="status">
          Loading the pack Lantern ships with…
        </p>
      )}

      {core.kind === 'failed' && (
        <>
          <Warning>
            The pack Lantern ships with could not be loaded, so the pickers will be empty
            until you load one yourself. Nothing on your sheet has changed.
          </Warning>
          <ProblemReport subject="the core pack" problems={core.problems} />
        </>
      )}

      {pick.kind === 'reading' && (
        <p className="readout" role="status">
          Reading {pick.name}…
        </p>
      )}

      {pick.kind === 'loaded' && (
        <p className="readout" role="status">
          Loaded {pick.packName} {pick.version}
          {pick.replaced === null ? '' : `, replacing the copy already loaded (${pick.replaced})`}.
        </p>
      )}

      {pick.kind === 'full' && (
        <Warning>
          {pick.name} was not loaded: {loaded.length} packs are already loaded, which is
          as many as Lantern holds at once. Remove one and pick it again.
        </Warning>
      )}

      {pick.kind === 'failed' && (
        <>
          <Warning>
            {pick.name} could not be read as a pack, so nothing has changed — every pack
            that was loaded still is. Every problem is listed below; copy them and paste
            them back into whatever wrote the file:
          </Warning>
          <ProblemReport subject={pick.name} problems={pick.problems} />
        </>
      )}

      <p className="subhead">Load order</p>

      {loaded.length === FIRST ? (
        <EmptyNote>
          No packs are loaded. Pick a file above, or use the sheet as it is — every field
          on it can be typed by hand.
        </EmptyNote>
      ) : (
        <>
          <p className="readout">
            Later packs win. A pack that overrides something another pack defined replaces
            it if it is loaded after it, so the order below is what decides.
          </p>
          <ul className="packs">
            {loaded.map((held, position) => (
              <PackRow
                key={held.pack.id}
                held={held}
                summary={summaries.get(held.pack.id) ?? null}
                position={position}
                total={loaded.length}
                onToggle={packs.toggle}
                onMoveUp={packs.moveUp}
                onMoveDown={packs.moveDown}
                onRemove={packs.remove}
              />
            ))}
          </ul>
        </>
      )}

      {stack.warnings.length > FIRST && (
        <>
          <Warning>
            The loaded packs resolved, with these to say for themselves. Every one of them
            loaded anyway — this is a report, not a refusal:
          </Warning>
          <ProblemReport subject="the loaded packs" problems={stack.warnings} />
        </>
      )}

      {lines.length > FIRST && (
        <>
          <p className="subhead">What resolved</p>
          <ul className="stack">
            {lines.map((line) => (
              <li key={line.ref} className="stack__line">
                {stackLineText(line)}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
