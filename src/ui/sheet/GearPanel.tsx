/**
 * What is carried, what it costs to carry, and the coin.
 *
 * Slots are the mechanic this panel exists for, and they are computed on read: a row
 * costs what a loaded pack says one of it costs, or what the player typed when no pack
 * answers. That fallback is why a sheet built with no packs still counts its gear
 * instead of reading zero forever.
 *
 * A row whose `ref` no loaded pack defines is *reported*, never dropped and never
 * guessed at — turning a pack off leaves the gear on the sheet (PRD.md principle 4).
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
import { appendRow, isAtLimit, newItem, removeRow, updateRow } from '../../state/character-edits';
import {
  AddRowButton,
  CheckField,
  EmptyNote,
  NumberField,
  Panel,
  RemoveRowButton,
  TextField,
  Warning,
} from '../fields';
import type { PanelProps } from './sheet-props';

/** Nothing carried, nothing owed. A floor, not a business rule. */
const NONE = 0;

export function GearPanel({
  character,
  setCharacter,
  carry,
}: PanelProps & { readonly carry: Carry }): ReactElement {
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
          {character.items.map((item) => (
            <li key={item.id} className="row row--item">
              <TextField
                label="Item"
                hideLabel
                placeholder="Item"
                value={item.name}
                maxLength={MAX_NAME_LENGTH}
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
                label={`Remove ${item.name === '' ? 'this item' : item.name}`}
                onClick={() =>
                  setCharacter((previous) => ({
                    ...previous,
                    items: removeRow(previous.items, item.id),
                  }))
                }
              />
            </li>
          ))}
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
