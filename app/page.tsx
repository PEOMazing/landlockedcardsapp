import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  redirect(me.isAdmin ? "/admin" : "/dashboard");
}
