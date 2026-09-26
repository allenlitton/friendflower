import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";
import { Flower } from "@/components/ui";

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col px-[26px] pb-[22px]">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-7">
        <Flower size={83} stroke="#ffffff" strokeWidth={2.1} />
        <div className="text-center font-logo text-[38px] leading-[1.05] font-extrabold tracking-[.5px]">friend flower.</div>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="mx-auto mt-4 max-w-[268px] text-center font-logo text-[14.5px] leading-relaxed text-[#b9b2a7]">
        Keep track of where in the world your friends are, and meet friends of friends wherever you are.
      </p>
    </main>
  );
}
