"use client";

// The price refresh, while it is happening.
//
// Repricing eight hundred cards is two upstream requests each, run in series
// so the sales feed does not get hammered, which means minutes rather than
// seconds. A toast that rewrites itself every batch is not enough: toasts time
// out, they stack, and on a phone the newest one covers the one you were
// reading. The honest version of "this is still working" is a bar that moves.
//
// Modal on purpose, and deliberately not dismissable. The refresh writes
// prices one card at a time; wandering off to another filter mid-run and
// seeing half the table repriced is how you end up not trusting any of it.

export type RefreshState = {
  total: number;
  done: number;
  linked: number;
  estimated: number;
  skipped: number;
  // Name of the card currently being priced, when the server tells us. Blank
  // between batches.
  current?: string;
};

const pct = (s: RefreshState) => (s.total > 0 ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0);

export default function RefreshProgress({ state }: { state: RefreshState | null }) {
  if (!state) return null;
  const p = pct(state);
  // Before the first batch comes back there is nothing to measure, so the bar
  // runs as an indeterminate sweep rather than sitting at a dead zero, which
  // reads as stuck.
  const started = state.done > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Refreshing prices">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative card p-6 w-full max-w-sm space-y-4">
        <div>
          <div className="label">Refreshing prices</div>
          <div className="num text-3xl font-bold mt-1">
            {state.done}
            <span className="text-dim text-lg"> / {state.total}</span>
          </div>
        </div>

        <div className="h-2.5 rounded-full bg-edge/60 overflow-hidden">
          {started ? (
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${p}%`, background: "linear-gradient(90deg,#58e6d9,#7aa2ff,#3ECF8E)" }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full llc-sweep" style={{ background: "linear-gradient(90deg,#58e6d9,#7aa2ff,#3ECF8E)" }} />
          )}
        </div>

        <div className="text-dim text-xs min-h-[1.25rem] truncate">
          {state.current
            ? state.current
            : started
              ? `${p}% done`
              : "Starting - each card is priced one at a time"}
        </div>

        {(state.linked > 0 || state.estimated > 0 || state.skipped > 0) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
            {state.linked > 0 && <span><span className="num text-body">{state.linked}</span> newly linked</span>}
            {state.estimated > 0 && <span><span className="num text-body">{state.estimated}</span> estimated</span>}
            {state.skipped > 0 && <span><span className="num text-body">{state.skipped}</span> skipped</span>}
          </div>
        )}

        <div className="text-dim text-[11px] leading-snug">
          Leave this open. Prices are written as each card finishes, so closing
          the tab stops the run partway rather than undoing it.
        </div>
      </div>

      <style>{`
        @keyframes llcSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .llc-sweep { animation: llcSweep 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
