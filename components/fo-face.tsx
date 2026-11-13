/** Fo's face: the avatar for every chat with Fo, dressed as a butler. */
export function FoFace({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Fo Concierge" className={`flex-none rounded-full ${className}`}>
      <rect width="64" height="64" fill="#2a1f27" />
      {/* neck and shoulders: black jacket, white shirt, bowtie */}
      <rect x="27.5" y="36" width="9" height="11" fill="#d796ab" />
      <path d="M2 64c1-11 10-17 22-19h16c12 2 21 8 22 19z" fill="#141116" />
      <path d="M24.5 45 32 64l7.5-19z" fill="#f7f3ef" />
      <path d="M24 45l-3 4.5 3.6 2.6-2.4 2.8L31 64h1z" fill="#2c2731" />
      <path d="M40 45l3 4.5-3.6 2.6 2.4 2.8L33 64h-1z" fill="#2c2731" />
      <path d="M27.4 44.2 32 48.6l-3.2 1.8zm9.2 0L32 48.6l3.2 1.8z" fill="#fff" />
      <circle cx="32" cy="56" r=".75" fill="#bdb5b0" />
      <circle cx="32" cy="60" r=".75" fill="#bdb5b0" />
      <path d="M32 49.2 25.8 45.9v6.6zm0 0 6.2-3.3v6.6z" fill="#0c0a0d" />
      <rect x="30.5" y="47.7" width="3" height="3" rx=".8" fill="#26212a" />
      {/* the head, scaled up off the collar */}
      <g transform="translate(32 27) scale(.74) translate(-32 -34)">
        <circle cx="32" cy="34" r="20" fill="#e6a8bd" />
        <path d="M13 30c1-11 9-18 19-18s18 7 19 18c-7-1-14-5-19-10-5 5-12 9-19 10z" fill="#c98298" />
        <ellipse cx="24.5" cy="35" rx="2.6" ry="3.4" fill="#241f1a" />
        <ellipse cx="39.5" cy="35" rx="2.6" ry="3.4" fill="#241f1a" />
        <circle cx="25.4" cy="33.8" r=".9" fill="#fff" />
        <circle cx="40.4" cy="33.8" r=".9" fill="#fff" />
        <circle cx="19" cy="43" r="3" fill="#f3b8c9" opacity=".7" />
        <circle cx="45" cy="43" r="3" fill="#f3b8c9" opacity=".7" />
        {/* curvy thin handlebar mustache */}
        <path
          d="M32 41c-2.6-2.2-6.4-2.4-9 .2-1.5 1.5-3.4 1.4-4-.2-.4-1 .3-1.9 1.2-1.6M32 41c2.6-2.2 6.4-2.4 9 .2 1.5 1.5 3.4 1.4 4-.2.4-1-.3-1.9-1.2-1.6"
          stroke="#241f1a"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path d="M26.5 45.5c3.2 3.2 7.8 3.2 11 0" stroke="#241f1a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
