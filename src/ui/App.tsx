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
 */

import type { ReactElement } from 'react';
import '../styles/app.css';
import { formatProblems } from '../model/character';
import { usePersistentCharacter } from '../state/use-persistent-character';
import { useRoom } from '../state/use-room';
import { Lobby } from './Lobby';
import { CharacterSheet } from './sheet/CharacterSheet';

export function App(): ReactElement {
  const { character, setCharacter, load, lastSave } = usePersistentCharacter();
  const room = useRoom();

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
          <p className="notice notice--danger" role="alert">
            The saved character could not be read, so this is a new one.
            {load.kept ? ' The old value has been kept aside, unchanged.' : ''}
            {'\n'}
            {formatProblems(load.problems)}
          </p>
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

        {lastSave !== null && !lastSave.ok && (
          <p className="notice notice--danger" role="alert">
            {lastSave.reason === 'storage'
              ? `The last change could not be saved. (${lastSave.failure.detail})`
              : `The last change could not be saved, because the sheet did not validate:\n${formatProblems(lastSave.problems)}`}
          </p>
        )}
      </div>

      <main>
        <div className="lobby">
          <Lobby room={room} />
        </div>
        <CharacterSheet character={character} setCharacter={setCharacter} />
      </main>
    </div>
  );
}
