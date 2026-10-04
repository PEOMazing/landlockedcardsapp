import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import QuickSetClient from "./QuickSetClient";

export const dynamic = "force-dynamic";

// Nothing is read here. The shelf is fetched by /api/quick-set from the
// client, because this page re-rolls: doing the read server side would mean a
// full page navigation for every roll and no way to keep the one you liked on
// screen while you looked at the next.
export default async function QuickSetPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isManager && !me.isAdmin) redirect("/dashboard");

  return (
    <>
      <Nav isAdmin={!!me.isAdmin} isManager={!!me.isManager} name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-5xl mx-auto p-6">
        <QuickSetClient />
      </main>
    </>
  );
}
