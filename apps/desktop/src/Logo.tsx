/** The Vanepoint mark: a pointer with three "air" arcs on a violet tile (matches assets/logo.svg). */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Vanepoint">
      <defs>
        <linearGradient id="vp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8068E2" />
          <stop offset="1" stopColor="#5B43C4" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#vp-g)" />
      <g fill="none" stroke="#fff" strokeWidth="28" strokeLinecap="round">
        <path d="M187.9 156.2 A70 70 0 0 1 232.5 207.4" />
        <path d="M205.0 109.2 A120 120 0 0 1 281.4 197.1" strokeOpacity="0.78" />
        <path d="M222.1 62.3 A170 170 0 0 1 330.3 186.7" strokeOpacity="0.55" />
      </g>
      <polygon points="164,222 164,424.8 218.1,377 253.4,457 287.8,442.5 253.4,363.4 322.1,363.4" fill="#fff" />
    </svg>
  );
}
