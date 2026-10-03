// A clickable table header that sorts its column.
//
// InventoryClient and SinglesClient each had their own Th(), identical apart
// from one accepting a `title` tooltip and one not. Worth pulling out less for
// the twenty saved lines than for the aria-sort: that attribute is the only
// thing telling a screen reader which column is sorted and which way, it is
// easy to leave off when you hand-roll the third one, and nobody notices it is
// missing because nothing looks wrong.
//
// Generic over the key so each screen keeps its own SortKey union and a typo in
// a column name is still a compile error, not a dead header.

function Caret({ dir }: { dir: "asc" | "desc" }) {
  // Drawn rather than typed. Both screens used the ▲ and ▼ glyphs, which sit
  // on a different baseline in every font on every platform, so the arrow was
  // a pixel or two off centre depending on the machine. Drawing it also gets
  // this off the off-scale type list: the glyphs needed an 8 pixel font size,
  // below the smallest step of the type scale and so impossible to justify,
  // while w-2 h-2 is simply 8px on the spacing scale.
  return (
    <svg viewBox="0 0 8 8" className="w-2 h-2 shrink-0" fill="currentColor" aria-hidden="true">
      {dir === "asc" ? <path d="M4 2l3 4H1z" /> : <path d="M4 6L1 2h6z" />}
    </svg>
  );
}

export default function SortableTh<K extends string>({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  title,
}: {
  label: string;
  /** The key this column sorts by. */
  k: K;
  /** The key the table is currently sorted by. */
  sortKey: K;
  sortDir: "asc" | "desc";
  onSort: (k: K) => void;
  title?: string;
}) {
  const active = sortKey === k;
  return (
    // th already carries the uppercase dim label styling from globals.css, so
    // the button only has to add the active tint.
    <th aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        title={title}
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-body ${
          active ? "text-foil" : ""
        }`}
      >
        {label}
        {active ? (
          <Caret dir={sortDir} />
        ) : (
          // Both carets, faint: the column is sortable but is not the sort.
          <span className="flex flex-col -space-y-1 opacity-30">
            <Caret dir="asc" />
            <Caret dir="desc" />
          </span>
        )}
      </button>
    </th>
  );
}
