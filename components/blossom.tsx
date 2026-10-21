import Link from "next/link";
import type { ReactNode } from "react";
import { Flower } from "@/components/ui";

/** A free-plan limit, with a way to Blossom. */
export function BlossomNote({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[18px] border-[1.5px] border-plum-line bg-plum px-[15px] py-3.5 ${className}`}>
      <div className="flex items-center gap-2">
        <Flower size={18} strokeWidth={4.4} />
        <span className="text-[13.2px] font-bold tracking-[.06em] text-pink uppercase">Blossom</span>
      </div>
      <div className="mt-1.5 text-[17.4px] font-semibold">{title}</div>
      <p className="mt-1 text-[15px] leading-snug text-plum-text">{children}</p>
      <Link href="/blossom" className="mt-3 inline-flex rounded-full bg-pink px-[15px] py-2 text-[15px] font-bold text-ink hover:bg-pink-deep">
        See Blossom
      </Link>
    </div>
  );
}
