import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (me.isTeam) redirect("/");

  const wordmark = (
    <div className="text-center">
      <div className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
        LandLocked <span className="holo-text">Cards</span>
      </div>
    </div>
  );

  // no profile yet: collect it
  if (!me.streamer) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
        {wordmark}
        <OnboardingForm />
      </main>
    );
  }

  // external profile exists: show where they stand
  const isVendor = me.role === "vendor";
  const pending = me.signupStatus === "pending";
  const name = me.streamer.fields["First Name"] || me.streamer.fields["Name"] || "";
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      {wordmark}
      <div className="card p-8 max-w-md text-center space-y-3">
        <div className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {pending ? "Application received" : `Welcome, ${name}`}
        </div>
        {isVendor && pending && (
          <p className="text-dim text-sm">
            Thanks for applying as a vendor{me.streamer.fields["Company"] ? ` with ${me.streamer.fields["Company"]}` : ""}.
            We review every vendor personally - expect access within 1 to 2 days. We will reach out by email.
          </p>
        )}
        {isVendor && !pending && (
          <p className="text-dim text-sm">
            Your vendor account is approved. Your workspace is being finished - we will email you the moment it opens.
          </p>
        )}
        {!isVendor && (
          <p className="text-dim text-sm">
            Your collector account is approved. Your collection workspace is being finished - we will email you the moment it opens.
          </p>
        )}
        <p className="text-dim text-xs border-t border-edge pt-3 mt-1">
          Trying to reach a business you work with? Membership is invite-only - ask the business owner to add your email to their team, and this account will unlock their workspace automatically.
        </p>
        <a href="/sign-in" className="text-dim text-xs hover:text-body block">sign out and back in anytime - your spot is saved</a>
      </div>
    </main>
  );
}
