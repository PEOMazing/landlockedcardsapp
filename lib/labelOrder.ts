// The order stickers come off the printer.
//
// Cards get sleeved and filed by name, so the roll should come out in the same
// order the binder goes in. The table order a print used to inherit was
// newest-added, and a batch imported in one go shares a Date Added, which left
// its order to chance: five copies of the same Charmander came out scattered
// across a hundred-label run instead of in one stack.
//
// Name first, then set and card number so two different Raticates stay apart,
// then the sticker number so copies of one card print in the order their
// numbers run. The collator compares numbers as numbers ("Electrode (36)"
// before "Electrode (37)", "9/99" before "20/99") and ignores case.

export type LabelSortable = { name: string; setName: string; number: string; cardNo: string };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function alphaOrder<T extends LabelSortable>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      collator.compare(a.name || "", b.name || "") ||
      collator.compare(a.setName || "", b.setName || "") ||
      collator.compare(a.number || "", b.number || "") ||
      // a card with no sticker number yet goes after its numbered copies
      (a.cardNo ? 0 : 1) - (b.cardNo ? 0 : 1) ||
      collator.compare(a.cardNo || "", b.cardNo || "")
  );
}
