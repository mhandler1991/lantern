// Resolution is where two packs meet, so these tests are about pairs and about order:
// what two packs defining the same name produce (two things), what an override produces
// (one thing, and a warning), and what happens when the list is rearranged.
//
// Every fixture is built through `parsePack`, not hand-typed as a `Pack`. A fixture that
// resolution accepts but the schema would refuse proves nothing about a real pack file.

import { describe, expect, it } from "vitest";
import { parsePack, reportProblems, type Pack } from "./pack";
import {
  lookup,
  normalizeRef,
  resolvePacks,
  spellsForClass,
  type ResolvedStack,
} from "./pack-resolver";

/** A parsed pack, or a failure with the report an author would have been shown. */
function loaded(fields: Record<string, unknown>): Pack {
  const result = parsePack({
    format: "lantern-pack",
    formatVersion: 1,
    version: "1.0.0",
    ...fields,
  });
  if (!result.ok)
    throw new Error(reportProblems(result.problems, String(fields["name"])));

  return result.pack;
}

const wizard = (name = "Wizard") => ({
  id: "wizard",
  name,
  hitDie: "d4",
  weapons: ["dagger"],
  armor: ["none"],
  talentTable: "wizard-talents",
});

const spell = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  tier: 1,
  classes: ["core:wizard"],
  range: "near",
  duration: "instant",
  ...extra,
});

const table = (id: string, rows: ReadonlyArray<Record<string, unknown>>) => ({
  id,
  name: "A table",
  die: "2d6",
  rows,
});

const CORE = loaded({
  id: "core",
  name: "Core",
  classes: [wizard()],
  items: [
    {
      id: "dagger",
      name: "Dagger",
      slots: 1,
      cost: { amount: 5, currency: "gp" },
    },
  ],
  spells: [
    spell("light", "Light"),
    spell("fireball", "Fireball"),
    spell("sleep", "Sleep"),
  ],
  tables: [table("loot-minor", [{ roll: [2, 18], text: "A copper ring" }])],
});

const refsOf = (stack: ResolvedStack): readonly string[] =>
  stack.spells.map((one) => one.ref);

describe("define", () => {
  it("namespaces every id by its pack, without the author writing it", () => {
    const stack = resolvePacks([CORE]);

    expect(stack.byRef.has("core:class:wizard")).toBe(true);
    expect(stack.byRef.has("core:item:dagger")).toBe(true);
    expect(stack.byRef.has("core:spell:fireball")).toBe(true);
    expect(stack.byRef.has("core:table:loot-minor")).toBe(true);
    expect(stack.warnings).toEqual([]);
  });

  it("lets two packs both define a Skald, and nothing collides", () => {
    const first = loaded({
      id: "north",
      name: "The North",
      classes: [{ ...wizard("Skald"), id: "skald" }],
    });
    const second = loaded({
      id: "south",
      name: "The South",
      classes: [{ ...wizard("Skald"), id: "skald" }],
    });

    const stack = resolvePacks([first, second]);

    expect(stack.classes.map((one) => one.ref)).toEqual([
      "north:class:skald",
      "south:class:skald",
    ]);
    expect(stack.classes.map((one) => one.packName)).toEqual([
      "The North",
      "The South",
    ]);
    expect(stack.warnings).toEqual([]);
  });

  it("warns when one pack defines an id twice, and keeps the later entry", () => {
    const pack = loaded({
      id: "core",
      name: "Core",
      spells: [spell("light", "Light"), spell("light", "Light, revised")],
    });

    const stack = resolvePacks([pack]);

    expect(stack.spells).toHaveLength(1);
    expect(stack.spells[0]?.entry.name).toBe("Light, revised");
    expect(stack.warnings).toHaveLength(1);
    expect(stack.warnings[0]?.path).toBe("core.spells[1].id");
  });

  it("warns when two loaded packs share an id, once rather than per entry", () => {
    const twin = loaded({
      id: "core",
      name: "Core, again",
      spells: [spell("light", "Light")],
    });

    const stack = resolvePacks([CORE, twin]);

    expect(
      stack.warnings.filter((one) => one.path === "packs[1].id"),
    ).toHaveLength(1);
  });

  it("resolves a pack with no content arrays at all", () => {
    const stack = resolvePacks([loaded({ id: "empty", name: "Empty" })]);

    expect(stack.byRef.size).toBe(0);
    expect(stack.warnings).toEqual([]);
    expect(stack.packs[0]?.counts.spells).toBe(0);
  });

  it("resolves nothing at all into an empty stack", () => {
    const stack = resolvePacks([]);

    expect(stack.packs).toEqual([]);
    expect(stack.classes).toEqual([]);
    expect(stack.warnings).toEqual([]);
  });
});

describe("override", () => {
  const frostfire = loaded({
    id: "frostbound",
    name: "Frostbound",
    spells: [
      spell("frostfire", "Frostfire", { overrides: "core:spell:fireball" }),
    ],
  });

  it("replaces by id and warns, because somebody typed the word", () => {
    const stack = resolvePacks([CORE, frostfire]);

    expect(stack.byRef.get("core:spell:fireball")?.entry.name).toBe(
      "Frostfire",
    );
    expect(stack.byRef.has("frostbound:spell:frostfire")).toBe(false);
    expect(stack.warnings).toHaveLength(1);
    expect(stack.warnings[0]?.path).toBe("frostbound.spells[0].overrides");
    expect(stack.warnings[0]?.message).toContain("core:spell:fireball");
  });

  it("keeps the position of what it replaced, so no list reshuffles", () => {
    expect(refsOf(resolvePacks([CORE, frostfire]))).toEqual([
      "core:spell:light",
      "core:spell:fireball",
      "core:spell:sleep",
    ]);
  });

  it("records both packs against the entry, in load order", () => {
    const sources = resolvePacks([CORE, frostfire]).byRef.get(
      "core:spell:fireball",
    )?.sources;

    expect(sources?.map((one) => [one.packId, one.operation])).toEqual([
      ["core", "define"],
      ["frostbound", "override"],
    ]);
  });

  it("gives the last loaded pack the win, and reordering flips it", () => {
    const cursed = loaded({
      id: "cursed-scroll",
      name: "Cursed Scroll 1",
      spells: [spell("grease", "Grease", { overrides: "core:spell:fireball" })],
    });

    expect(
      resolvePacks([CORE, frostfire, cursed]).byRef.get("core:spell:fireball")
        ?.packId,
    ).toBe("cursed-scroll");
    expect(
      resolvePacks([CORE, cursed, frostfire]).byRef.get("core:spell:fireball")
        ?.packId,
    ).toBe("frostbound");
  });

  it("keeps an entry whose target no loaded pack defines, and warns", () => {
    const stack = resolvePacks([frostfire]);

    expect(stack.byRef.get("core:spell:fireball")?.entry.name).toBe(
      "Frostfire",
    );
    expect(stack.warnings[0]?.message).toContain("no loaded pack defines");
  });

  it("refuses to let one kind override another, and keeps the entry as its own", () => {
    const confused = loaded({
      id: "confused",
      name: "Confused",
      spells: [
        spell("dagger-spell", "Dagger, the spell", {
          overrides: "core:item:dagger",
        }),
      ],
    });

    const stack = resolvePacks([CORE, confused]);

    expect(stack.byRef.get("core:item:dagger")?.entry.name).toBe("Dagger");
    expect(stack.byRef.has("confused:spell:dagger-spell")).toBe(true);
    expect(stack.warnings[0]?.message).toContain("may only override");
  });
});

describe("extend", () => {
  const rimeblade = { roll: [19, 20], text: "A rimeblade" };
  const frostTalent = { roll: 2, text: "Frost affinity" };

  const frost = loaded({
    id: "frostbound",
    name: "Frostbound",
    extends: [
      { target: "core:table:loot-minor", rows: [rimeblade] },
      { target: "core:class:wizard", talents: ["frost-affinity"] },
    ],
  });

  it("adds rows to a table another pack defined, after its own", () => {
    const stack = resolvePacks([CORE, frost]);

    expect(stack.tables[0]?.rows).toEqual([
      { roll: [2, 18], text: "A copper ring" },
      rimeblade,
    ]);
    expect(stack.warnings).toEqual([]);
  });

  it("leaves the defining pack’s own entry untouched", () => {
    const stack = resolvePacks([CORE, frost]);

    expect(stack.tables[0]?.entry.rows).toHaveLength(1);
  });

  it("namespaces a talent reference from the extending pack", () => {
    const stack = resolvePacks([CORE, frost]);

    expect(stack.classes[0]?.talents).toEqual([
      "frostbound:talent:frost-affinity",
    ]);
  });

  it("applies extensions in load order, and reordering the list reorders them", () => {
    const cursed = loaded({
      id: "cursed-scroll",
      name: "Cursed Scroll 1",
      extends: [{ target: "core:table:loot-minor", rows: [frostTalent] }],
    });

    const forwards = resolvePacks([CORE, frost, cursed]).tables[0]?.rows.map(
      (row) => row.text,
    );
    const backwards = resolvePacks([CORE, cursed, frost]).tables[0]?.rows.map(
      (row) => row.text,
    );

    expect(forwards).toEqual([
      "A copper ring",
      "A rimeblade",
      "Frost affinity",
    ]);
    expect(backwards).toEqual([
      "A copper ring",
      "Frost affinity",
      "A rimeblade",
    ]);
  });

  it("applies an extension written before the pack it targets", () => {
    const stack = resolvePacks([frost, CORE]);

    expect(stack.tables[0]?.rows).toHaveLength(2);
    expect(stack.warnings).toEqual([]);
  });

  it("warns and skips a target no pack defines, without failing the pack", () => {
    const orphan = loaded({
      id: "orphan",
      name: "Orphan",
      spells: [spell("hoarfrost", "Hoarfrost")],
      extends: [
        { target: "nowhere:class:nobody", talents: ["frost-affinity"] },
        { target: "core:table:loot-minor", rows: [rimeblade] },
      ],
    });

    const stack = resolvePacks([CORE, orphan]);

    expect(stack.warnings).toHaveLength(1);
    expect(stack.warnings[0]?.path).toBe("orphan.extends[0].target");
    expect(stack.warnings[0]?.message).toContain("skipped");
    expect(stack.byRef.has("orphan:spell:hoarfrost")).toBe(true);
    expect(stack.tables[0]?.rows).toHaveLength(2);
  });

  it("warns and skips an addition the target has no room for", () => {
    const confused = loaded({
      id: "confused",
      name: "Confused",
      extends: [
        { target: "core:table:loot-minor", talents: ["frost-affinity"] },
        { target: "core:class:wizard", rows: [rimeblade] },
      ],
    });

    const stack = resolvePacks([CORE, confused]);

    expect(stack.warnings.map((one) => one.path)).toEqual([
      "confused.extends[0].talents",
      "confused.extends[1].rows",
    ]);
    expect(stack.tables[0]?.rows).toHaveLength(1);
    expect(stack.classes[0]?.talents).toEqual([]);
  });

  it("warns rather than offering a class the same talent twice", () => {
    const twice = loaded({
      id: "twice",
      name: "Twice",
      extends: [{ target: "core:class:wizard", talents: ["gift", "gift"] }],
    });

    const stack = resolvePacks([CORE, twice]);

    expect(stack.classes[0]?.talents).toEqual(["twice:talent:gift"]);
    expect(stack.warnings[0]?.path).toBe("twice.extends[0].talents[1]");
  });

  it("records what each pack contributed, which is what the UI line is made of", () => {
    const stack = resolvePacks([CORE, frost]);

    expect(stack.classes[0]?.sources).toEqual([
      {
        packId: "core",
        packName: "Core",
        operation: "define",
        talentsAdded: 0,
        rowsAdded: 0,
      },
      {
        packId: "frostbound",
        packName: "Frostbound",
        operation: "extend",
        talentsAdded: 1,
        rowsAdded: 0,
      },
    ]);
  });

  it("leaves out a pack whose additions were all skipped", () => {
    const nothing = loaded({
      id: "nothing",
      name: "Nothing",
      extends: [{ target: "core:class:wizard" }],
    });

    expect(resolvePacks([CORE, nothing]).classes[0]?.sources).toHaveLength(1);
  });
});

describe("references", () => {
  it("fills in the segments a pack left implied, from the field they sat in", () => {
    expect(normalizeRef("dagger", "item", "core")).toBe("core:item:dagger");
    expect(normalizeRef("frostbound:rimewalker", "class", "core")).toBe(
      "frostbound:class:rimewalker",
    );
    expect(normalizeRef("core:item:dagger", "spell", "frostbound")).toBe(
      "core:item:dagger",
    );
  });

  it("resolves all three forms against the stack", () => {
    const stack = resolvePacks([CORE]);

    expect(lookup(stack, "dagger", "item", "core")?.ref).toBe(
      "core:item:dagger",
    );
    expect(lookup(stack, "core:dagger", "item", "frostbound")?.ref).toBe(
      "core:item:dagger",
    );
    expect(lookup(stack, "core:item:dagger", "item", "frostbound")?.ref).toBe(
      "core:item:dagger",
    );
  });

  it("answers undefined for content no loaded pack defines, and never throws", () => {
    expect(
      lookup(resolvePacks([CORE]), "core:item:lantern", "item", "core"),
    ).toBeUndefined();
  });

  it("finds a class’s spells from the spells, because that is where the list lives", () => {
    const frost = loaded({
      id: "frostbound",
      name: "Frostbound",
      spells: [spell("hoarfrost", "Hoarfrost", { classes: ["core:wizard"] })],
    });

    const stack = resolvePacks([CORE, frost]);

    expect(
      spellsForClass(stack, "core:class:wizard").map((one) => one.entry.name),
    ).toEqual(["Light", "Fireball", "Sleep", "Hoarfrost"]);
  });
});

describe("the stack the UI reads", () => {
  it("summarises every loaded pack, in load order", () => {
    const stack = resolvePacks([CORE, loaded({ id: "empty", name: "Empty" })]);

    expect(stack.packs.map((one) => one.id)).toEqual(["core", "empty"]);
    expect(stack.packs[0]?.counts).toEqual({
      classes: 1,
      ancestries: 0,
      spells: 3,
      items: 1,
      talents: 0,
      tables: 1,
      extensions: 0,
    });
  });

  it("reports its warnings in the format a pack’s own problems use", () => {
    const orphan = loaded({
      id: "orphan",
      name: "Orphan",
      extends: [{ target: "nowhere:class:nobody" }],
    });

    const report = reportProblems(
      resolvePacks([orphan]).warnings,
      "the loaded packs",
    );

    expect(report).toContain('1 problem in "the loaded packs":');
    expect(report).toContain(
      "orphan.extends[0].target — no loaded pack defines",
    );
  });
});
