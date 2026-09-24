import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import MoversClient from "./MoversClient";

export const dynamic = "force-dynamic";

export default async function MoversPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isTeam) redirect("/welcome");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || ""} />
      <MoversClient />
    </>
  );
}
