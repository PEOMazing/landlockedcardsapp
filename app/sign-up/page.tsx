import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          LandLocked <span className="holo-text">Cards</span>
        </div>
        <div className="text-dim text-sm mt-1">Create your account - you will pick collector or vendor next</div>
      </div>
      <SignUp routing="hash" signInUrl="/sign-in" forceRedirectUrl="/welcome" />
      <div className="text-dim text-sm">
        Already have an account? <a className="text-foil hover:underline" href="/sign-in">Sign in</a>
      </div>
    </main>
  );
}
