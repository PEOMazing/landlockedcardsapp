import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { alphaOrder } from "../labelOrder";

const L = (name: string, cardNo: string, setName = "Set", number = "1") => ({ name, setName, number, cardNo });
const names = (xs: { name: string; cardNo: string }[]) => xs.map((x) => `${x.name} ${x.cardNo}`);

describe("alphaOrder", () => {
  it("sorts by card name, ignoring case", () => {
    const out = alphaOrder([L("eevee", "0003"), L("Arceus", "0001"), L("Charmander", "0002")]);
    assert.deepEqual(out.map((x) => x.name), ["Arceus", "Charmander", "eevee"]);
  });

  it("keeps copies of one card together, in sticker number order", () => {
    const out = alphaOrder([
      L("Charmander", "0612"), L("Arceus", "0600"), L("Charmander", "0608"),
      L("Zebstrika", "0601"), L("Charmander", "0610"),
    ]);
    assert.deepEqual(names(out), ["Arceus 0600", "Charmander 0608", "Charmander 0610", "Charmander 0612", "Zebstrika 0601"]);
  });

  it("compares numbers inside names as numbers", () => {
    const out = alphaOrder([L("Electrode (37)", "0002"), L("Electrode (36)", "0001"), L("Electrode (100)", "0003")]);
    assert.deepEqual(out.map((x) => x.name), ["Electrode (36)", "Electrode (37)", "Electrode (100)"]);
  });

  it("separates same-name cards from different sets", () => {
    const out = alphaOrder([
      L("Raticate", "0002", "Secret Wonders", "61/132"),
      L("Raticate", "0001", "Boundaries Crossed", "105/149"),
      L("Raticate", "0003", "Secret Wonders", "61/132"),
    ]);
    assert.deepEqual(names(out), ["Raticate 0001", "Raticate 0002", "Raticate 0003"]);
    assert.equal(out[0].setName, "Boundaries Crossed");
  });

  it("orders card numbers numerically within a set", () => {
    const out = alphaOrder([L("Beautifly", "0002", "Platinum", "21/127"), L("Beautifly", "0001", "Platinum", "8/127")]);
    assert.deepEqual(out.map((x) => x.number), ["8/127", "21/127"]);
  });

  it("puts a card with no sticker number after its numbered copies", () => {
    const out = alphaOrder([L("Eevee", ""), L("Eevee", "0005")]);
    assert.deepEqual(out.map((x) => x.cardNo), ["0005", ""]);
  });

  it("does not reorder the list it was handed", () => {
    const input = [L("B", "0002"), L("A", "0001")];
    alphaOrder(input);
    assert.deepEqual(input.map((x) => x.name), ["B", "A"]);
  });
});
