// The top of a screen: what this page is, and what you can do from it.
//
// Written by hand on 21 screens, and no two of them agreed. Some aligned the
// row on the baseline and some on the centre, the gap was 2, 3 or 4 depending
// on the day, and the heading carried its own font-family inline because the
// scale did not exist yet. None of that was decided; it is what happens when
// the twenty-first page is built by copying the twentieth.
//
// Nothing here is new. It is the shape those 21 already had, with the parts
// they disagreed about settled once:
//
//   baseline alignment, because a 24px title and a 13px subtitle look wrong
//   centred against each other and right sitting on the same line
//
//   wrapping, because every one of these rows has an actions cluster on the
//   right that does not fit a phone, and the ones that forgot flex-wrap pushed
//   the page sideways

export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  /** A node, not a string: several of these colour one word of the title. */
  title: React.ReactNode;
  /** The quiet line that says what the page is for. */
  subtitle?: React.ReactNode;
  /** Buttons, tabs, totals. Pushed to the right, wrapping under on a phone. */
  actions?: React.ReactNode;
  /** For the per-page escapes that genuinely exist, like print:hidden. */
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between flex-wrap gap-s3 ${className}`}>
      <h1 className="t-page">{title}</h1>
      {subtitle && <span className="t-secondary text-dim">{subtitle}</span>}
      {actions && <div className="flex items-center gap-s3 flex-wrap ml-auto">{actions}</div>}
    </div>
  );
}
