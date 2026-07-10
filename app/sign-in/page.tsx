import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          LandLocked <span className="holo-text">Cards</span>
        </div>
        <div className="text-dim text-sm mt-1">Stream ops - sign in to continue</div>
      </div>
      <SignIn routing="hash" />
    </main>
  );
}
