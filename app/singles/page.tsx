import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import SinglesClient from "./SinglesClient";

export const dynamic = "force-dynamic";

export default async function SinglesPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  return (
    <>
      <Nav isAdmin={me.isAdmin} name={me.streamer?.fields?.["Name"] || ""} />
      <SinglesClient isAdmin={me.isAdmin} isManager={me.isManager} />
    </>
  );
}
