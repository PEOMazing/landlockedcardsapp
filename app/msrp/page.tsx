import { MSRP_TABLE } from "@/lib/msrp";

export const metadata = { title: "Pokemon TCG MSRP reference" };

// Public MSRP reference so anyone at a table can settle "what does this
// actually retail for" in one glance.
export default function MsrpPage() {
  const $ = (n: number) => `$${n.toFixed(2)}`;
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Pokemon TCG MSRP reference</h1>
        <p className="text-dim text-sm mt-1 max-w-2xl leading-relaxed">
          Standard retail prices by product category, verified May 2026 against Pokemon Center, Best Buy, and GameStop.
          Pokemon Center exclusive versions of standard products typically run $10 higher and include a PC-stamped promo.
          Anything priced well above these numbers is market premium or scalper markup - which can be fine, as long as everyone knows it.
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-dim">
              <th className="p-3">Product</th>
              <th className="p-3 text-right">MSRP</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {MSRP_TABLE.map((e) => (
              <tr key={e.label} className="border-t border-edge">
                <td className="p-3 font-medium">{e.label}</td>
                <td className="p-3 text-right font-mono">
                  {e.msrp !== null ? $(e.msrp) : e.range ? `${$(e.range[0])} - ${$(e.range[1])}` : "-"}
                </td>
                <td className="p-3 text-dim text-xs">{e.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-dim text-xs">
        MSRPs change when The Pokemon Company adjusts pricing - the booster bundle split reflects the late-2025 increase on
        Mega Evolution era sets. Market prices above MSRP reflect demand, not error; below MSRP usually means a genuine deal.
      </p>
    </main>
  );
}
