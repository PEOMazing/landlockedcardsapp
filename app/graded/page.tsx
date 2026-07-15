import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import SinglesClient from "../singles/SinglesClient";

export const dynamic = "force-dynamic";

// Graded inventory: the slabs, separated from raw singles. Same machinery -
// QR codes, locations, comps, labels - scoped to PSA, CGC, and BGS conditions.
export default async function GradedPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isTeam) redirect("/welcome");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || ""} />
      <SinglesClient isAdmin={me.isAdmin} isManager={me.isManager} mode="graded" />
    </>
  );
}
