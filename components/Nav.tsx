"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SignOutButton, UserButton } from "@clerk/nextjs";

const I = {
  vendor: <path d="M3 13h4v8H3zM10 9h4v12h-4zM17 3h4v18h-4z" />,
  collection: <path d="M4 5a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zM14 3v6h6" />,
  streams: <path d="M5 4l14 8-14 8V4z" />,
  singles: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6" />,
  inventory: <path d="M4 7l8-4 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10" />,
  sets: <path d="M4 6h16M4 12h16M4 18h10" />,
  pay: <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  insights: <path d="M12 2a7 7 0 0 1 4 12.7V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.3A7 7 0 0 1 12 2zM9 21h6" />,
  settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

type Item = { href: string; label: string; icon: React.ReactNode; admin?: boolean; manager?: boolean; nonAdmin?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Dashboards",
    items: [
      { href: "/vendor", label: "Vendor", icon: I.vendor, admin: true },
      { href: "/collection", label: "Collection", icon: I.collection },
      { href: "/dashboard", label: "My Streams", icon: I.streams, nonAdmin: true },
    ],
  },
  {
    title: "Sell",
    items: [
      { href: "/singles", label: "Singles", icon: I.singles },
      { href: "/graded", label: "Graded", icon: I.singles },
      { href: "/quote", label: "Quote", icon: I.pay, manager: true },
      { href: "/admin/streams", label: "All Streams", icon: I.streams, admin: true },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/admin/inventory", label: "Inventory", icon: I.inventory, manager: true },
      { href: "/sets", label: "Set Lists", icon: I.sets },
    ],
  },
  {
    title: "Business",
    items: [
      { href: "/admin", label: "Pay", icon: I.pay, admin: true },
      { href: "/admin/payroll", label: "Payroll", icon: I.pay, admin: true },
      { href: "/admin/analytics", label: "Analytics", icon: I.analytics, admin: true },
      { href: "/admin/insights", label: "Insights", icon: I.insights, admin: true },
    ],
  },
];

function NavLinks({ isAdmin, isManager, isCollector = false, pathname, onNavigate }: { isAdmin: boolean; isManager: boolean; isCollector?: boolean; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => {
          if (isCollector) return i.href === "/collection" || i.href === "/sets";
          if ((i as any).nonAdmin && isAdmin) return false; // admins do not stream
          return i.admin ? isAdmin : i.manager ? isManager || isAdmin : true;
        });
        if (items.length === 0) return null;
        return (
          <div key={g.title}>
            <div className="label px-2 mb-1.5">{g.title}</div>
            <div className="space-y-0.5">
              {items.map((i) => {
                const active = pathname === i.href || (i.href !== "/" && pathname.startsWith(i.href + "/"));
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      active ? "bg-edge/70 text-body font-semibold" : "text-dim hover:text-body hover:bg-edge/40"
                    }`}
                  >
                    <span className={active ? "text-foil" : ""}>{i.icon}</span>
                    {i.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Nav({ isAdmin, isManager = false, isCollector = false, name }: { isAdmin: boolean; isManager?: boolean; isCollector?: boolean; name?: string }) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  const brand = (
    <Link href="/" className="font-bold text-[15px] px-2" style={{ fontFamily: "var(--font-display, sans-serif)" }}>
      LandLocked <span className="holo-text">Cards</span>
    </Link>
  );

  const footer = (
    <div className="border-t border-edge px-4 py-3 flex items-center gap-3">
      <UserButton afterSignOutUrl="/sign-in" />
      <span className="min-w-0">
        {name && <span className="block text-sm text-dim truncate">{name}</span>}
        <SignOutButton redirectUrl="/sign-in">
          <button className="text-xs text-dim hover:text-bad">Sign out</button>
        </SignOutButton>
      </span>
      {isAdmin && (
        <Link href="/admin/settings" title="Settings" className={`ml-auto ${pathname.startsWith("/admin/settings") ? "text-foil" : "text-dim hover:text-body"}`}>
          <Icon d={I.settings} />
        </Link>
      )}
    </div>
  );

  return (
    <>
      <nav className="sidebar hidden md:flex fixed inset-y-0 left-0 w-56 flex-col border-r border-edge bg-panel/70 backdrop-blur z-30">
        <div className="h-14 flex items-center px-3 border-b border-edge">{brand}</div>
        <NavLinks isAdmin={isAdmin} isManager={isManager} isCollector={isCollector} pathname={pathname} />
        {footer}
      </nav>

      <header className="sidebar md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-edge bg-panel/80 backdrop-blur">
        <button aria-label="Menu" onClick={() => setOpen(true)} className="text-body">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        {brand}
        <div className="ml-auto"><UserButton afterSignOutUrl="/sign-in" /></div>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <nav className="absolute inset-y-0 left-0 w-64 flex flex-col bg-panel border-r border-edge" onClick={(e) => e.stopPropagation()}>
            <div className="h-14 flex items-center justify-between px-3 border-b border-edge">
              {brand}
              <button aria-label="Close" onClick={() => setOpen(false)} className="text-dim px-2">{"\u2715"}</button>
            </div>
            <NavLinks isAdmin={isAdmin} isManager={isManager} isCollector={isCollector} pathname={pathname} onNavigate={() => setOpen(false)} />
            {footer}
          </nav>
        </div>
      )}
    </>
  );
}
