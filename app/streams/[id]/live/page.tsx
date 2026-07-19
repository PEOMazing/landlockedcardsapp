import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import LiveClient from "./LiveClient";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isTeam) redirect("/welcome");
  return <LiveClient id={params.id} />;
}
