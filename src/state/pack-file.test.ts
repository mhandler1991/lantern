// A pack off a disk is hostile input (DATA-MODEL.md §10), so these tests are about the
// four ways a file is wrong and the one way it is right — and about the order they are
// checked in, because each step is only safe once the one before it has passed.
//
// Nothing here touches the DOM or a real `File`. `PickedPackFile` is structural for
// exactly this reason: a file that throws on read is an object, not a fixture.

import { describe, expect, it } from 'vitest';
import { MAX_PACK_BYTES, PACK_FORMAT, PACK_FORMAT_VERSION } from '../constants';
import type { PickedPackFile } from './pack-file';
import { PACK_FILE_ACCEPT, fromPackFileText, readPackFile } from './pack-file';

const frostbound = {
  format: PACK_FORMAT,
  formatVersion: PACK_FORMAT_VERSION,
  id: 'frostbound',
  name: 'Frostbound',
  version: '1.2.0',
  spells: [
    {
      id: 'hoarfrost',
      name: 'Hoarfrost',
      tier: 1,
      duration: 'instant',
      range: 'near',
      classes: ['core:wizard'],
      text: null,
      page: null,
    },
  ],
};

/** A file the picker could have handed over. `text` is what the browser would read. */
function file(text: string, name = 'frostbound.json'): PickedPackFile {
  return { name, size: text.length, text: () => Promise.resolve(text) };
}

describe('reading a pack file', () => {
  it('offers JSON to the picker under both spellings browsers use', () => {
    expect(PACK_FILE_ACCEPT).toContain('application/json');
    expect(PACK_FILE_ACCEPT).toContain('.json');
  });

  it('returns the pack when the file is one', async () => {
    const read = await readPackFile(file(JSON.stringify(frostbound)));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.pack.id).toBe('frostbound');
    expect(read.pack.spells?.[0]?.name).toBe('Hoarfrost');
  });

  it('refuses an oversize file on its reported size, before a byte is decoded', async () => {
    let wasRead = false;
    const enormous: PickedPackFile = {
      name: 'huge.json',
      size: MAX_PACK_BYTES + 1,
      text: () => {
        wasRead = true;
        return Promise.resolve('{}');
      },
    };

    const read = await readPackFile(enormous);

    expect(read.ok).toBe(false);
    expect(wasRead, 'an oversize file was decoded to be refused').toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.message).toContain(`expected at most ${MAX_PACK_BYTES} bytes`);
  });

  it('bounds the decoded text as well, because a reported size is only a claim', () => {
    const read = fromPackFileText('x'.repeat(MAX_PACK_BYTES + 1));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.message).toContain('characters');
  });

  it('reports a file that will not read as a problem rather than throwing', async () => {
    const unplugged: PickedPackFile = {
      name: 'gone.json',
      size: 10,
      text: () => Promise.reject(new Error('NotFoundError')),
    };

    const read = await readPackFile(unplugged);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.message).toContain('could not be read');
    expect(read.problems[0]?.message).toContain('NotFoundError');
  });

  it('reports text that is not JSON with what went wrong in it', async () => {
    const read = await readPackFile(file('{ "id": '));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.path).toBe('(root)');
    expect(read.problems[0]?.message).toContain('expected JSON');
  });

  it('hands JSON that is not a pack to the schema, which reports every field', async () => {
    const read = await readPackFile(file(JSON.stringify({ ...frostbound, id: 'Frostbound', version: 'v1' })));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    // Every problem, not the first: an author fixing one refusal at a time pastes six
    // times (DATA-MODEL.md §10).
    expect(read.problems.map((problem) => problem.path)).toEqual(['id', 'version']);
  });

  it('refuses a character file, which is the JSON most likely to be picked by mistake', async () => {
    const character = JSON.stringify({ format: 'lantern-character', formatVersion: 2, name: 'Vess' });
    const read = await readPackFile(file(character, 'vess.json'));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.path).toBe('format');
  });
});
