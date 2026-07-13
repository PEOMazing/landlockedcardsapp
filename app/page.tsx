import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  // dashboards first: each role lands on the view built for it
  if (me.isAdmin) redirect("/vendor");
  if (me.isTeam) redirect("/dashboard");
  // external signups (collectors and vendors) and brand new accounts
  redirect("/welcome");
}
