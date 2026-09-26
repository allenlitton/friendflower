import { Flower, PrimaryButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <Flower size={56} stroke="#fff" strokeWidth={2.4} />
      <h1 className="font-display text-[30px]">Nothing here</h1>
      <p className="text-[13.5px] text-muted">This profile or page isn&apos;t available — it may be private, or no longer exist.</p>
      <PrimaryButton href="/nearby" className="max-w-[260px]">back to nearby</PrimaryButton>
    </main>
  );
}
