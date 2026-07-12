import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import SetsClient from "./SetsClient";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || ""} />
      <SetsClient />
    </>
  );
}
