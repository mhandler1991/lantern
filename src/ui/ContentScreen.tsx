/**
 * The content screen: what is loaded, in what order, and what it resolved to.
 *
 * PRD.md §5 Phase 2. A DM picks a JSON file and the app's content changes — so this
 * panel has to answer three questions a list of file names cannot: *what did that pack
 * bring*, *what does the table have now*, and *which pack put this here*. The resolution
 * stack below the list is the third one, and it is the reason the panel exists rather
 * than a checkbox in a menu.
 *
 * Five things it deliberately does.
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
 * **It offers to keep a pack, and never assumes.** DESIGN.md §7 — packs are room-scoped
 * by default with an explicit opt-in, so Keep is an unticked box beside each pack rather
 * than the default, and what it means is written above the list rather than found out
 * after a reload. Core is not offered it: it is fetched on boot and there is no file to
 * remember.
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
import { MAX_KEPT_PACKS, MAX_KEPT_PACKS_BYTES } from '../constants';
import type { PackId } from '../model/pack';
import type { PackSummary } from '../model/pack-resolver';
import type { LoadedPack, PackSource, Packs } from '../state/use-packs';
import { PACK_FILE_ACCEPT } from '../state/pack-file';
import { describeContents, resolutionStack, stackLineText } from './content';
import { EmptyNote, Panel, Warning } from './fields';
import { ProblemReport } from './ProblemReport';
import { RecoverPacks } from './RecoverPacks';

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
  onToggleKept,
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
  readonly onToggleKept: (id: PackId) => void;
}): ReactElement {
  const toggleId = useId();
  const keepId = useId();
  const { pack, source, isEnabled, isKept } = held;

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
          {/* The word shows and the pack's name does not: the row above already names
              it, and the control still announces which pack it belongs to. Labelled
              rather than bare because there are two checkboxes on this row now. */}
          <label className="field__label" htmlFor={toggleId}>
            {'Use'}
            <span className="visually-hidden">{` ${pack.name}`}</span>
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
          <>
            <div className="field field--check">
              <input
                id={keepId}
                className="field__check"
                type="checkbox"
                checked={isKept}
                onChange={() => onToggleKept(pack.id)}
              />
              <label className="field__label" htmlFor={keepId}>
                {'Keep'}
                <span className="visually-hidden">{` ${pack.name}`}</span>
              </label>
            </div>

            <button
              type="button"
              className="button button--remove"
              title={`Remove ${pack.name}`}
              onClick={() => onRemove(pack.id)}
            >
              <span aria-hidden="true">{'×'}</span>
              <span className="visually-hidden">{`Remove ${pack.name}`}</span>
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function ContentScreen({ packs }: { readonly packs: Packs }): ReactElement {
  const fileId = useId();
  const { loaded, stack, core, pick, restore, store, keep } = packs;

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
        loaded. Nothing is uploaded anywhere, and what you load lasts as long as this tab
        unless you tick Keep beside it — up to {MAX_KEPT_PACKS} packs come back next time,
        in this order and turned on or off as you left them.
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

      {restore.problems.length > FIRST && (
        <>
          <Warning>
            {restore.entries.length === FIRST
              ? 'What this browser had stored could not be read, so no kept pack came back. '
              : `${restore.entries.length} kept pack(s) came back; the rest of what was stored could not be read. `}
            {restore.quarantined
              ? 'The stored value has been set aside rather than dropped — nothing was deleted — and every problem with it is listed below:'
              : 'This browser would not let Lantern set the stored value aside, so it is still where it was. Every problem with it is listed below:'}
          </Warning>
          <ProblemReport subject="the stored packs" problems={restore.problems} />
          {restore.quarantined && <RecoverPacks />}
        </>
      )}

      {restore.failure !== null && (
        <Warning>
          This browser will not let Lantern read its storage, so no kept pack could be
          restored and none can be kept. ({restore.failure.detail}) Everything else works
          — a pack you pick now lasts as long as this tab.
        </Warning>
      )}

      {keep.kind === 'refused' && (
        <Warning>
          {keep.name} is not being kept:{' '}
          {keep.reason === 'count'
            ? `${MAX_KEPT_PACKS} packs are already kept, which is as many as Lantern stores.`
            : `the kept packs would come to more than the ${MAX_KEPT_PACKS_BYTES} characters Lantern stores.`}{' '}
          It is loaded and working — it just will not come back after a reload. Un-keep
          another pack and tick it again.
        </Warning>
      )}

      {store !== null && !store.ok && (
        <Warning>
          {store.reason === 'storage'
            ? `This browser would not store the packs (${store.failure.detail}).`
            : 'The packs could not be stored.'}{' '}
          They are loaded and working — they just will not come back after a reload.
        </Warning>
      )}

      {store !== null && !store.ok && store.reason === 'invalid' && (
        <ProblemReport subject="the packs being kept" problems={store.problems} />
      )}

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
                onToggleKept={packs.toggleKept}
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
