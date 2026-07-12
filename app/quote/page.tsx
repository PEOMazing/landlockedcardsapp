import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import QuoteClient from "./QuoteClient";

export const dynamic = "force-dynamic";

export default async function QuotePage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isManager) redirect("/singles");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || ""} />
      <QuoteClient />
    </>
  );
}
