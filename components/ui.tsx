// Building blocks shared by every screen, matching the Claude Design prototype.
import Link from "next/link";
import type { ReactNode } from "react";
import { gradientFor, initials } from "@/lib/format";

const HEART_PETAL =
  "M32 32 C27.8 26.5 23.2 18.6 23.2 10.3 A5 4.8 0 0 1 32 5.5 A5 4.8 0 0 1 40.8 10.3 C40.8 18.6 36.2 26.5 32 32 Z";
const HALO_PETAL = "M32 15.5 C26.2 11.8 25.6 5.6 32 1.6 C38.4 5.6 37.8 11.8 32 15.5 Z";
const ANGLES = [0, 72, 144, 216, 288];

/** The five-heart flower logo. */
export function Flower({
  size = 21, stroke = "var(--color-pink)", strokeWidth = 3.8, center = "var(--color-pink)", className, style,
}: { size?: number; stroke?: string; strokeWidth?: number; center?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} style={{ flex: "none", ...style }} aria-hidden>
      <g stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {ANGLES.map((a) => <path key={a} transform={`rotate(${a} 32 32)`} d={HEART_PETAL} />)}
      </g>
      <circle cx="32" cy="32" r="4" fill={center} />
    </svg>
  );
}

/** Soft pink petals behind an avatar (profile, "how you know each other"). */
export function PetalHalo({ size, children }: { size: number; children: ReactNode }) {
  return (
    <div className="relative flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" className="pointer-events-none absolute inset-0" aria-hidden>
        {ANGLES.map((a) => <path key={a} transform={`rotate(${a} 32 32)`} d={HALO_PETAL} fill="rgba(230,168,189,.55)" />)}
      </svg>
      {children}
    </div>
  );
}

export function Avatar({
  id, name, src, size = 48, online, className = "", ring,
}: { id: string; name: string; src?: string | null; size?: number; online?: boolean; className?: string; ring?: string }) {
  return (
    <div
      className={`relative flex flex-none items-center justify-center rounded-full font-display text-white/90 ${className}`}
      style={{ width: size, height: size, background: gradientFor(id), fontSize: size * 0.4, border: ring }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
      {online && (
        <span className="absolute right-0 bottom-0 rounded-full border-2 border-well bg-online"
          style={{ width: Math.max(9, size * 0.2), height: Math.max(9, size * 0.2) }} />
      )}
    </div>
  );
}

export function ScreenTitle({ children, sub, right, flower }: { children: ReactNode; sub?: ReactNode; right?: ReactNode; flower?: boolean }) {
  return (
    <div className="flex flex-none items-center gap-3 px-5 pt-2.5 pb-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[31px] leading-[1.1]">{children}</h1>
          {flower && <Flower />}
        </div>
        {sub && <div className="text-[11.5px] text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function BackBar({ href, title, right }: { href: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line-soft px-4 py-2.5">
      <Link href={href} aria-label="Back"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-[17px] text-soft">‹</Link>
      <div className="min-w-0 flex-1 font-display text-[24px] leading-tight">{title}</div>
      {right}
    </div>
  );
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-2 text-[11.5px] font-bold tracking-[.06em] text-muted uppercase ${className}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[18px] border-[1.5px] border-line bg-card ${className}`}>{children}</div>;
}

type BtnProps = { children: ReactNode; className?: string; disabled?: boolean } & (
  | { href: string; onClick?: never; type?: never }
  | { href?: never; onClick?: () => void; type?: "button" | "submit" }
);

/** The big pink VT323 button used for primary actions. */
export function PrimaryButton({ children, className = "", disabled, ...rest }: BtnProps) {
  const cls = `flex h-[50px] w-full items-center justify-center rounded-[14px] bg-pink font-display text-[22px] text-ink transition-colors hover:bg-pink-deep disabled:opacity-45 ${disabled ? "pointer-events-none opacity-45" : ""} ${className}`;
  if ("href" in rest && rest.href) return <Link href={rest.href} className={cls}>{children}</Link>;
  return <button type={rest.type ?? "button"} onClick={rest.onClick} disabled={disabled} className={cls}>{children}</button>;
}

export function SecondaryButton({ children, className = "", disabled, ...rest }: BtnProps) {
  const cls = `flex h-[46px] w-full items-center justify-center rounded-[13px] border-[1.5px] border-line bg-card text-[14px] font-semibold text-soft hover:border-[#5a534b] ${disabled ? "pointer-events-none opacity-45" : ""} ${className}`;
  if ("href" in rest && rest.href) return <Link href={rest.href} className={cls}>{children}</Link>;
  return <button type={rest.type ?? "button"} onClick={rest.onClick} disabled={disabled} className={cls}>{children}</button>;
}

/** Rounded filter/choice chip. */
export function Pill({ on, children, onClick, className = "" }: { on?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border-[1.5px] px-[13px] py-[7px] text-[12.5px] font-semibold whitespace-nowrap ${
        on ? "border-pink bg-pink text-ink" : "border-line bg-card text-soft"} ${className}`}>
      {children}
    </button>
  );
}

export function Tag({ tone = "plum", children, className = "" }: { tone?: "plum" | "gold" | "leaf" | "grey"; children: ReactNode; className?: string }) {
  const tones = {
    plum: "bg-plum text-pink", gold: "bg-gold-bg text-gold", leaf: "bg-leaf-bg text-leaf", grey: "bg-raised text-soft",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-bold ${tones[tone]} ${className}`}>{children}</span>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="relative h-[26px] w-11 flex-none rounded-full transition-colors" style={{ background: on ? "var(--color-pink)" : "#3d3830" }}>
      <span className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: on ? 21 : 3 }} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl bg-[#211e1b] p-[3px]">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 rounded-[10px] py-2 text-[12px] font-bold ${value === o.value ? "bg-[#2e2a26] text-text shadow" : "text-muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A list row with an icon square, title, note and chevron. */
export function RowLink({ href, onClick, icon, title, note, tone = "plum" }: {
  href?: string; onClick?: () => void; icon: ReactNode; title: ReactNode; note?: ReactNode; tone?: "plum" | "gold";
}) {
  const inner = (
    <>
      <span className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] text-[16px] font-bold ${tone === "gold" ? "bg-gold-bg text-gold" : "bg-plum text-pink"}`}>{icon}</span>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[14.5px] font-semibold">{title}</div>
        {note && <div className="text-[11.5px] text-muted">{note}</div>}
      </div>
      <span className="text-[17px] text-pink">›</span>
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-[13px] hover:border-[#5a534b]";
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div role="alert" className="rounded-xl border-[1.5px] border-plum-line bg-plum px-3 py-2 text-[12.5px] text-plum-text">{children}</div>;
}

export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[18px] border-[1.5px] border-gold-line bg-[#241d14] px-[15px] py-[14px]">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e8b54b] text-[10px] text-ink">✦</span>
        <span className="flex-1 text-[11px] font-bold tracking-[.05em] text-gold uppercase">{title}</span>
        <Tag tone="gold">Coming soon</Tag>
      </div>
      <div className="mt-2 text-[13.5px] leading-normal text-body">{children}</div>
    </div>
  );
}
