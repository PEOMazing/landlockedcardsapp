import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function Nav({ isAdmin, name }: { isAdmin: boolean; name?: string }) {
  return (
    <header className="border-b border-edge bg-panel/60 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-bold" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
          LandLocked <span className="holo-text">Cards</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-dim">
          <Link className="hover:text-body" href="/dashboard">My Streams</Link>
          <Link className="hover:text-body" href="/singles">Singles</Link>
          <Link className="hover:text-body" href="/sets">Set Lists</Link>
          {isAdmin && (
            <>
              <Link className="hover:text-body" href="/admin">Pay Dashboard</Link>
              <Link className="hover:text-body" href="/admin/streams">All Streams</Link>
              <Link className="hover:text-body" href="/admin/analytics">Analytics</Link>
              <Link className="hover:text-body" href="/admin/insights">Insights</Link>
              <Link className="hover:text-body" href="/admin/inventory">Inventory</Link>
              <Link className="hover:text-body" href="/admin/settings">Settings</Link>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {name && <span className="text-sm text-dim">{name}</span>}
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>
    </header>
  );
}
