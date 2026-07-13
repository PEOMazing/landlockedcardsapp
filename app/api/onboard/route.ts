import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { atCreate, atList, T } from "@/lib/airtable";

// One-time profile creation after Clerk sign-up. Collectors activate
// immediately; vendors enter the approval queue.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase() || "";
  if (!email) return NextResponse.json({ error: "no email on account" }, { status: 400 });

  const existing = await atList(T.streamers, { filterByFormula: `LOWER({Email}) = '${email}'` });
  if (existing.length > 0) return NextResponse.json({ error: "already registered" }, { status: 409 });

  const b = await req.json();
  const firstName = String(b.firstName || "").trim();
  const lastName = String(b.lastName || "").trim();
  const phone = String(b.phone || "").trim();
  const role = b.role === "vendor" ? "vendor" : "collector";
  if (!firstName || !lastName) return NextResponse.json({ error: "first and last name required" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "phone number required" }, { status: 400 });

  const fields: Record<string, any> = {
    "Name": `${firstName} ${lastName}`,
    "First Name": firstName,
    "Last Name": lastName,
    "Email": email,
    "Phone": phone,
    "Clerk User ID": user.id,
    "Role": role,
    "Active": false,
    "Signed Up": new Date().toISOString().slice(0, 10),
    "Signup Status": role === "vendor" ? "pending" : "approved",
  };
  if (role === "vendor") {
    const company = String(b.company || "").trim();
    if (!company) return NextResponse.json({ error: "company name required for vendors" }, { status: 400 });
    fields["Company"] = company;
    if (b.experience) fields["Vending Experience"] = String(b.experience).trim();
    if (b.socials) fields["Socials"] = String(b.socials).trim();
  }
  await atCreate(T.streamers, fields);
  return NextResponse.json({ ok: true, role, status: fields["Signup Status"] });
}
