import type { ReactElement } from 'react';
import { MAX_CHARACTER_NAME_LENGTH } from '../constants';
import { formatProblems } from '../model/character';
import { usePersistentCharacter } from '../state/use-persistent-character';

/**
 * A placeholder sheet — one field — standing in until issue #17 builds the real one.
 * It exists so the persistence loop in `state/` has a writer: type a name, reload the
 * tab, and the name is still there. Everything below the hook call is temporary; the
 * hook is not.
 */
export function App(): ReactElement {
  const { character, setCharacter, load } = usePersistentCharacter();

  return (
    <main>
      <h1>Lantern</h1>
      <p>A companion for playing Shadowdark RPG with friends who are not in the room.</p>

      <label htmlFor="character-name">Name</label>
      <input
        id="character-name"
        value={character.name}
        maxLength={MAX_CHARACTER_NAME_LENGTH}
        onChange={(event) => {
          const { value } = event.target;
          setCharacter((previous) => ({ ...previous, name: value }));
        }}
      />

      {/* Warn, do not block: the sheet is usable in every one of these cases. */}
      {load.kind === 'rejected' && (
        <p role="alert">
          The saved character could not be read, so this is a new one.
          {load.kept ? ' The old value has been kept aside, unchanged.' : ''}
          {'\n'}
          {formatProblems(load.problems)}
        </p>
      )}
      {load.kind === 'unavailable' && (
        <p role="alert">
          This browser is not letting Lantern save. The sheet works, but it will be gone
          when you close the tab. ({load.failure.detail})
        </p>
      )}
    </main>
  );
}
