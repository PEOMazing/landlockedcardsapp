import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { redirect } from "next/navigation";
import StreamEditor from "./StreamEditor";

export const dynamic = "force-dynamic";

export default async function StreamPage({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"]} />
      <StreamEditor id={params.id} isAdmin={me.isAdmin} />
    </>
  );
}
