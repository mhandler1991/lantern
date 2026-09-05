/**
 * The character file: export, and import. DESIGN.md §8 — a character lives in one
 * browser and there is no account behind it, so this panel is the only thing standing
 * between a cleared browser and a lost sheet. That is why it sits above the sheet
 * rather than behind a menu.
 *
 * Import is two steps, and the second one is not a formality. Replacing the sheet on
 * screen is the one irreversible thing a player can do in this app, and a file picker
 * fires the moment a file is chosen — there is no other moment to ask. So a file is read
 * and validated first, and what it holds is named back before anything is replaced
 * (PRD.md principle 4: never destroy player data). A file that does not validate never
 * reaches that step at all; the sheet is untouched and the problems are printed with
 * their paths, ready to paste.
 *
 * Nothing here renders markup from a string. The name inside an imported file is a text
 * node like every other value on the sheet — CLAUDE.md §2.6, and this is the one place
 * in Phase 1 where a string arrives from outside the browser it is shown in.
 */

import type { ChangeEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import type { Character, CharacterProblem } from '../model/character';
import { CHARACTER_FILE_ACCEPT, readCharacterFile, toCharacterFile } from '../state/character-file';
import { saveTextFile } from './download';
import { Panel, Warning } from './fields';
import { ProblemReport } from './ProblemReport';
import type { PanelProps } from './sheet/sheet-props';

/** What the last export did. Cleared by the next one, never on a timer. */
type ExportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly name: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'invalid'; readonly problems: readonly CharacterProblem[] };

/**
 * Where an import has got to. `offered` is the whole point of the type: a character that
 * has been read and validated and has *not* replaced anything yet.
 */
type ImportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | {
      readonly kind: 'offered';
      readonly character: Character;
      readonly migratedFrom: number | null;
    }
  | {
      readonly kind: 'failed';
      /** The file that failed, so the report says which one the paths belong to. */
      readonly name: string;
      readonly problems: readonly CharacterProblem[];
    }
  | {
      readonly kind: 'replaced';
      readonly name: string;
      readonly migratedFrom: number | null;
    };

/** What a character with no name yet is called in a sentence about it. */
function describeName(name: string): string {
  return name.trim() === '' ? 'a character with no name yet' : name;
}

export function Portability({ character, setCharacter }: PanelProps): ReactElement {
  const fileId = useId();
  const [exported, setExported] = useState<ExportState>({ kind: 'idle' });
  const [imported, setImported] = useState<ImportState>({ kind: 'idle' });

  function exportCharacter(): void {
    setImported({ kind: 'idle' });

    const written = toCharacterFile(character);
    if (!written.ok) {
      setExported({ kind: 'invalid', problems: written.problems });
      return;
    }

    const saved = saveTextFile(written.file.name, written.file.text, written.file.type);
    setExported(
      saved.ok ? { kind: 'saved', name: written.file.name } : { kind: 'refused', message: saved.message },
    );
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;

    // Cleared so that picking the same file twice fires a second change — a player who
    // fixes a bad file by hand and picks it again is the likeliest second pick there is.
    event.target.value = '';
    if (file === null) return;

    setExported({ kind: 'idle' });
    setImported({ kind: 'reading' });

    const read = await readCharacterFile(file);
    setImported(
      read.ok
        ? { kind: 'offered', character: read.character, migratedFrom: read.migratedFrom }
        : { kind: 'failed', name: file.name, problems: read.problems },
    );
  }

  function replaceSheet(incoming: Character, migratedFrom: number | null): void {
    setCharacter(incoming);
    setImported({ kind: 'replaced', name: incoming.name, migratedFrom });
  }

  return (
    <Panel title="Character file">
      <p className="readout">
        This character is kept in this browser and nowhere else — there is no account and
        no server behind it. Exporting writes the whole sheet to a file you keep. It is
        the only copy that survives a cleared browser, a new machine, or this tab.
      </p>

      <div className="row-actions">
        <button type="button" className="button" onClick={exportCharacter}>
          Export character
        </button>
      </div>

      {exported.kind === 'saved' && (
        <p className="readout" role="status">
          Saved as {exported.name}. Keep it somewhere that is not this browser.
        </p>
      )}

      {exported.kind === 'refused' && (
        <Warning>
          This browser would not take the file ({exported.message}). Your sheet is
          untouched — try again, or export from another browser.
        </Warning>
      )}

      {exported.kind === 'invalid' && (
        <>
          <Warning>
            The sheet did not validate, so nothing was written. This is a bug in Lantern,
            not something you did — the paths below say where, and the button copies
            them for an issue:
          </Warning>
          <ProblemReport subject={describeName(character.name)} problems={exported.problems} />
        </>
      )}

      <p className="subhead">Import</p>

      <div className="field field--wide">
        <label className="field__label" htmlFor={fileId}>
          Character file
        </label>
        <input
          id={fileId}
          className="field__input field__input--file"
          type="file"
          accept={CHARACTER_FILE_ACCEPT}
          onChange={(event) => void pickFile(event)}
        />
      </div>

      {imported.kind === 'reading' && (
        <p className="readout" role="status">
          Reading the file…
        </p>
      )}

      {imported.kind === 'offered' && (
        <>
          <p className="readout" role="status">
            That file holds {describeName(imported.character.name)}
            {imported.migratedFrom === null
              ? ''
              : `, saved by an older version of Lantern (format ${imported.migratedFrom}) and brought forward`}
            . Opening it replaces the sheet on screen, which cannot be undone — export
            this one first if you want to keep it.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button"
              onClick={() => replaceSheet(imported.character, imported.migratedFrom)}
            >
              Replace the sheet
            </button>
            <button type="button" className="button" onClick={() => setImported({ kind: 'idle' })}>
              Keep this one
            </button>
          </div>
        </>
      )}

      {imported.kind === 'replaced' && (
        <p className="readout" role="status">
          Opened {describeName(imported.name)}.
          {imported.migratedFrom === null
            ? ''
            : ` It was saved by an older version of Lantern (format ${imported.migratedFrom}) and has been brought forward.`}
        </p>
      )}

      {imported.kind === 'failed' && (
        <>
          <Warning>
            That file could not be read as a character, so nothing has changed. The sheet
            on screen is exactly as it was. Every problem is listed below — copy them and
            paste them back into whatever wrote the file:
          </Warning>
          <ProblemReport subject={imported.name} problems={imported.problems} />
        </>
      )}
    </Panel>
  );
}
