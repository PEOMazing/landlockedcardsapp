// The "nothing here" row inside a table body.
//
// Eight screens wrote this themselves, each hardcoding how many columns its
// table has: colSpan={13}, colSpan={8}, colSpan={isAdmin ? 11 : 9}. Those
// numbers are a second copy of the table's shape, kept in sync by hand, and
// they go stale silently. Adding the two stock columns to the inventory table
// today meant editing 10 to 12 in one place and 11 to 13 in another, and the
// only symptom of getting it wrong is an empty-state message that stops short
// of the right edge, which nobody files a bug about.
//
// So the row does not take a column count. A colSpan larger than the table is
// clamped by the browser to the actual number of columns, which has been true
// in every engine for as long as tables have existed. The table can grow a
// column and this keeps spanning all of it.

const ALL_COLUMNS = 99;

export default function TableEmpty({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={ALL_COLUMNS} className="text-dim">
        {children}
      </td>
    </tr>
  );
}
