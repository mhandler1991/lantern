/**
 * The app: a dark room, and one sheet of paper on the table (DESIGN.md §6).
 *
 * Everything above the sheet is a report on the state of the save, and every one of them
 * degrades rather than blocks (PRD.md principle 4): a stored character that could not be
 * read is set aside and a new sheet opens, a browser that will not let us write says so
 * and the sheet still works, and a save that failed is shown rather than swallowed. None
 * of them can stop a player using the sheet, which is the whole point of the principle.
 *
 * The lobby sits above the sheet rather than in front of it: a room is optional, and
 * PRD.md principle 6 says the app has to work alone with no room and no packs at all.
 * There are no packs and no dice yet, and the sheet does not need either.
 *
 * The character file sits above the sheet for the opposite reason: it is not optional.
 * A character lives in this browser and nowhere else (DESIGN.md §8), so export is the
 * only mitigation there is against losing one, and a mitigation nobody can see is not
 * one.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import '../styles/app.css';
import type { ItemLookup } from '../model/derived';
import { toPublicCharacter } from '../net/projection';
import { usePersistentCharacter } from '../state/use-persistent-character';
import { usePresence } from '../state/use-presence';
import { useRoom } from '../state/use-room';
import { Lobby } from './Lobby';
import { Portability } from './Portability';
import { ProblemReport } from './ProblemReport';
import { CharacterSheet } from './sheet/CharacterSheet';

/** No pack is loaded until Phase 2, so no reference resolves — the same state as the sheet. */
const NO_PACKS: ItemLookup = () => null;

export function App(): ReactElement {
  const { character, setCharacter, load, lastSave } = usePersistentCharacter();
  const room = useRoom();

  /**
   * What peers may see, derived on read and never stored (DESIGN.md §2). Memoised
   * because it is the presence hook's input and a new object every render would rebuild
   * the roster every render.
   */
  const projection = useMemo(() => toPublicCharacter(character, NO_PACKS), [character]);
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
        <div className="portability">
          <Portability character={character} setCharacter={setCharacter} />
        </div>
        <CharacterSheet character={character} setCharacter={setCharacter} />
      </main>
    </div>
  );
}
