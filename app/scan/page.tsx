import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import ScanClient from "./ScanClient";

export const dynamic = "force-dynamic";

// Scan a pile into a priced list. Managers only, same as /quote: this is the
// page you stand at a table with.
export default async function ScanPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isManager) redirect("/singles");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || ""} />
      <ScanClient />
    </>
  );
}
