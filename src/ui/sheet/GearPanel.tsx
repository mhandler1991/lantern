/**
 * What is carried, what it costs to carry, and the coin.
 *
 * Slots are the mechanic this panel exists for, and they are computed on read: a row
 * costs what a loaded pack says one of it costs, or what the player typed when no pack
 * answers. That fallback is why a sheet built with no packs still counts its gear
 * instead of reading zero forever.
 *
 * Gear arrives two ways. **Add item** opens a blank row the player names and prices
 * themselves; the picker beside it appends a row that is a reference and nothing else,
 * and the name and slot cost are read back out of the pack every render (DATA-MODEL.md
 * §11 — `name` is a fallback, never a cache).
 *
 * That is also why a row carrying a reference has its name and its slots read only,
 * whether or not the pack is on: both are fields a loaded pack answers for, and a typed
 * value would be discarded the moment it came back. What the player owns stays live —
 * how many are carried, whether it is worn, and the button that drops it.
 *
 * A row whose `ref` no loaded pack defines is *reported*, never dropped and never
 * guessed at — turning a pack off leaves the gear on the sheet (PRD.md principle 4).
 * A pack being off must not trap a row either.
 */

import type { ReactElement } from 'react';
import {
  MAX_COIN,
  MAX_ITEM_QUANTITY,
  MAX_ITEM_SLOTS,
  MAX_ITEMS,
  MAX_NAME_LENGTH,
} from '../../constants';
import type { Carry } from '../../model/derived';
import { packOfRef } from '../../model/orphans';
import { appendRow, isAtLimit, newItem, removeRow, updateRow } from '../../state/character-edits';
import { displayName } from '../choices';
import {
  AddFromPack,
  AddRowButton,
  CheckField,
  EmptyNote,
  NumberField,
  OrphanMark,
  Panel,
  RemoveRowButton,
  TextField,
  Warning,
} from '../fields';
import type { ContentProps, OrphanProps, PanelProps } from './sheet-props';

/** Nothing carried, nothing owed. A floor, not a business rule. */
const NONE = 0;

export function GearPanel({
  character,
  setCharacter,
  orphans,
  stack,
  choices,
  carry,
}: PanelProps & OrphanProps & ContentProps & { readonly carry: Carry }): ReactElement {
  const full = isAtLimit(character.items, MAX_ITEMS);

  return (
    <Panel title="Gear" aside={`${carry.used} / ${carry.capacity} slots`}>
      {carry.isEncumbered && (
        <Warning>Carrying more than {carry.capacity} slots.</Warning>
      )}

      {carry.unresolved.length > NONE && (
        <Warning>
          No loaded pack defines {carry.unresolved.join(', ')}. Those rows are kept and
          counted at the slots written on them.
        </Warning>
      )}

      {character.items.length === NONE ? (
        <EmptyNote>Nothing carried yet.</EmptyNote>
      ) : (
        <ul className="rows">
          {character.items.map((item) => {
            const isOrphaned = orphans.rows.has(item.id);
            const label = displayName(stack, item.ref, item.name);
            // A pack answers for a referenced row's name and slot cost, on or off.
            const isFromPack = item.ref !== null;

            return (
              <li
                key={item.id}
                className={isOrphaned ? 'row row--item row--orphaned' : 'row row--item'}
              >
                <TextField
                  label="Item"
                  hideLabel
                  placeholder="Item"
                  value={label}
                  maxLength={MAX_NAME_LENGTH}
                  readOnly={isFromPack}
                  onChange={(name) =>
                    setCharacter((previous) => ({
                      ...previous,
                      items: updateRow(previous.items, item.id, { name }),
                    }))
                  }
                />
                <NumberField
                  label="Quantity"
                  hideLabel
                  value={item.qty}
                  min={1}
                  max={MAX_ITEM_QUANTITY}
                  onChange={(qty) =>
                    setCharacter((previous) => ({
                      ...previous,
                      items: updateRow(previous.items, item.id, { qty }),
                    }))
                  }
                />
                <NumberField
                  label="Slots each"
                  hideLabel
                  value={item.slots}
                  min={NONE}
                  max={MAX_ITEM_SLOTS}
                  readOnly={isFromPack}
                  onChange={(slots) =>
                    setCharacter((previous) => ({
                      ...previous,
                      items: updateRow(previous.items, item.id, { slots }),
                    }))
                  }
                />
                <CheckField
                  label="Equipped"
                  hideLabel
                  checked={item.equipped}
                  onChange={(equipped) =>
                    setCharacter((previous) => ({
                      ...previous,
                      items: updateRow(previous.items, item.id, { equipped }),
                    }))
                  }
                />
                <RemoveRowButton
                  label={`Remove ${label === '' ? 'this item' : label}`}
                  onClick={() =>
                    setCharacter((previous) => ({
                      ...previous,
                      items: removeRow(previous.items, item.id),
                    }))
                  }
                />
                {isOrphaned && item.ref !== null && <OrphanMark pack={packOfRef(item.ref)} />}
              </li>
            );
          })}
        </ul>
      )}

      <div className="row-actions">
        <AddRowButton
          label="Add item"
          disabled={full}
          onClick={() =>
            setCharacter((previous) => ({
              ...previous,
              items: appendRow(previous.items, newItem(), MAX_ITEMS),
            }))
          }
        />
        {choices.items.length > NONE && (
          <AddFromPack
            label="Add gear from a pack"
            choices={choices.items}
            disabled={full}
            onAdd={(ref) =>
              setCharacter((previous) => ({
                ...previous,
                items: appendRow(previous.items, newItem(ref), MAX_ITEMS),
              }))
            }
          />
        )}
        {full && <span className="readout">{MAX_ITEMS} rows is the most a sheet holds.</span>}
      </div>

      <h3 className="subhead">Coin</h3>
      <div className="panel__grid">
        <NumberField
          label="Gold"
          value={character.gold.gp}
          min={NONE}
          max={MAX_COIN}
          onChange={(gp) =>
            setCharacter((previous) => ({ ...previous, gold: { ...previous.gold, gp } }))
          }
        />
        <NumberField
          label="Silver"
          value={character.gold.sp}
          min={NONE}
          max={MAX_COIN}
          onChange={(sp) =>
            setCharacter((previous) => ({ ...previous, gold: { ...previous.gold, sp } }))
          }
        />
        <NumberField
          label="Copper"
          value={character.gold.cp}
          min={NONE}
          max={MAX_COIN}
          onChange={(cp) =>
            setCharacter((previous) => ({ ...previous, gold: { ...previous.gold, cp } }))
          }
        />
      </div>
      <p className="readout">
        Coin fills {carry.coinSlots} of the {carry.used} slots in use; gear fills{' '}
        {carry.itemSlots}.
      </p>
    </Panel>
  );
}
