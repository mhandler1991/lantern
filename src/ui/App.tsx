/**
 * The app: a dark room, and one sheet of paper on the table (DESIGN.md §6).
 *
 * Everything above the sheet is a report on the state of the save, and every one of them
 * degrades rather than blocks (PRD.md principle 4): a stored character that could not be
 * read is set aside and a new sheet opens, a browser that will not let us write says so
 * and the sheet still works, and a save that failed is shown rather than swallowed. None
 * of them can stop a player using the sheet, which is the whole point of the principle.
 *
 * The lobby and the content screen sit above the sheet rather than in front of it: a
 * room is optional and so are packs, and PRD.md principle 6 says the app has to work
 * alone with neither. There are no dice yet, and the sheet does not need them.
 *
 * Packs are the one thing above the sheet that can change what the sheet *means*, so
 * this is where the two meet: the orphan report is computed here and handed down, and
 * every edit passes through `updatePacksUsed` so the sheet's record of what it depends
 * on is written while the packs are still loaded to be seen. Turning a pack off warns
 * and marks; it never touches a row (PRD.md principle 4, DESIGN.md §5).
 *
 * The character file sits above the sheet for the opposite reason: it is not optional.
 * A character lives in this browser and nowhere else (DESIGN.md §8), so export is the
 * only mitigation there is against losing one, and a mitigation nobody can see is not
 * one.
 */

import type { ReactElement } from 'react';
import { useCallback, useMemo } from 'react';
import '../styles/app.css';
import { orphanReport, updatePacksUsed } from '../model/orphans';
import { itemLookup } from '../model/pack-resolver';
import { toPublicCharacter } from '../net/projection';
import { usePacks } from '../state/use-packs';
import { usePersistentCharacter } from '../state/use-persistent-character';
import { usePresence } from '../state/use-presence';
import { useRoom } from '../state/use-room';
import { ContentScreen } from './ContentScreen';
import { Lobby } from './Lobby';
import { Portability } from './Portability';
import { ProblemReport } from './ProblemReport';
import { CharacterSheet } from './sheet/CharacterSheet';
import type { SetCharacter } from './sheet/sheet-props';

/** Nothing missing. A floor, not a business rule. */
const NONE = 0;

export function App(): ReactElement {
  const { character, setCharacter: writeCharacter, load, lastSave } = usePersistentCharacter();
  const room = useRoom();
  const packs = usePacks();

  /**
   * Every edit, with the sheet's pack record brought up to date on the way through.
   *
   * A wrapper rather than an effect: `packsUsed` is stored state being kept honest, and
   * an effect that wrote it would be deriving state in one (CLAUDE.md §6). It costs
   * nothing when nothing moved — `updatePacksUsed` returns the same object.
   */
  const setCharacter = useCallback<SetCharacter>(
    (update) =>
      writeCharacter((previous) =>
        updatePacksUsed(typeof update === 'function' ? update(previous) : update, packs.stack),
      ),
    [writeCharacter, packs.stack],
  );

  /**
   * Which rows point at content no loaded pack answers for. Derived on read, never
   * stored: it is a fact about the packs that are on right now, and a stored one would
   * be wrong the moment a pack was turned back on.
   */
  const orphans = useMemo(() => orphanReport(character, packs.stack), [character, packs.stack]);

  /**
   * What peers may see, derived on read and never stored (DESIGN.md §2). Memoised
   * because it is the presence hook's input and a new object every render would rebuild
   * the roster every render — and it depends on the packs as well as the sheet, because
   * a reference resolves to an item's armour only while the pack defining it is on.
   */
  const items = useMemo(() => itemLookup(packs.stack), [packs.stack]);
  const projection = useMemo(() => toPublicCharacter(character, items), [character, items]);
  const presence = usePresence(projection);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Lantern</h1>
        <p className="app__tagline">
          A companion for playing Shadowdark RPG with friends who are not in the room.
        </p>
      </header>

      <div className="app__notices">
        {load.kind === 'rejected' && (
          <div className="notice notice--danger" role="alert">
            <p>
              The saved character could not be read, so this is a new one.
              {load.kept ? ' The old value has been kept aside, unchanged.' : ''}
            </p>
            <ProblemReport subject="the saved character" problems={load.problems} />
          </div>
        )}

        {load.kind === 'unavailable' && (
          <p className="notice notice--danger" role="alert">
            This browser is not letting Lantern save. The sheet works, but it will be gone
            when you close the tab. ({load.failure.detail})
          </p>
        )}

        {load.kind === 'loaded' && load.migratedFrom !== null && (
          <p className="notice" role="status">
            This character was saved by an older version of Lantern (format{' '}
            {load.migratedFrom}) and has been brought forward.
          </p>
        )}

        {lastSave !== null && !lastSave.ok && lastSave.reason === 'storage' && (
          <p className="notice notice--danger" role="alert">
            The last change could not be saved. ({lastSave.failure.detail})
          </p>
        )}

        {orphans.missingPacks.length > NONE && (
          <p className="notice" role="status">
            This character uses content from{' '}
            {orphans.missingPacks.join(', ')} — not loaded right now. Those rows are kept
            on the sheet, marked, and read-only until the pack is back.
          </p>
        )}

        {lastSave !== null && !lastSave.ok && lastSave.reason === 'invalid' && (
          <div className="notice notice--danger" role="alert">
            <p>The last change could not be saved, because the sheet did not validate:</p>
            <ProblemReport subject="the sheet" problems={lastSave.problems} />
          </div>
        )}
      </div>

      <main>
        <div className="lobby">
          <Lobby room={room} presence={presence} />
        </div>
        <div className="content">
          <ContentScreen packs={packs} />
        </div>
        <div className="portability">
          <Portability character={character} setCharacter={setCharacter} />
        </div>
        <CharacterSheet
          character={character}
          setCharacter={setCharacter}
          orphans={orphans}
          stack={packs.stack}
        />
      </main>
    </div>
  );
}
