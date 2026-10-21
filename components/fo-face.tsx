/** Fo's face: the avatar for every chat with Fo. */
export function FoFace({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Fo Concierge" className={`flex-none rounded-full ${className}`}>
      <rect width="64" height="64" fill="#2a1f27" />
      <circle cx="32" cy="34" r="20" fill="#e6a8bd" />
      <path d="M13 30c1-11 9-18 19-18s18 7 19 18c-7-1-14-5-19-10-5 5-12 9-19 10z" fill="#c98298" />
      <ellipse cx="24.5" cy="35" rx="2.6" ry="3.4" fill="#241f1a" />
      <ellipse cx="39.5" cy="35" rx="2.6" ry="3.4" fill="#241f1a" />
      <circle cx="25.4" cy="33.8" r=".9" fill="#fff" />
      <circle cx="40.4" cy="33.8" r=".9" fill="#fff" />
      <path d="M25 43c3.5 4 10.5 4 14 0" stroke="#241f1a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="19" cy="42" r="3" fill="#f3b8c9" opacity=".7" />
      <circle cx="45" cy="42" r="3" fill="#f3b8c9" opacity=".7" />
    </svg>
  );
}
