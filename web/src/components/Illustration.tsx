/**
 * Original, lightweight inline-SVG illustrations (warehouse racking, boxes, forklift,
 * clipboard, magnifier). Decorative only: aria-hidden, no external assets.
 */
export type IllustrationKind = 'warehouse' | 'forklift' | 'clipboard' | 'search' | 'empty' | 'conveyor' | 'shield' | 'people' | 'chart' | 'check';

const Box = ({ x, y, w = 22, h = 18, c = '#f5d7a8' }: { x: number; y: number; w?: number; h?: number; c?: string }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={2} fill={c} stroke="#e0b67a" strokeWidth={0.8} />
    <rect x={x + w / 2 - 2} y={y} width={4} height={h} fill="#e8c38d" opacity={0.7} />
  </g>
);

function Rack({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={0} y={0} width={4} height={96} rx={1} fill="#7aa0c8" />
      <rect x={116} y={0} width={4} height={96} rx={1} fill="#7aa0c8" />
      {[18, 50, 82].map((yy) => <rect key={yy} x={0} y={yy} width={120} height={4} rx={1} fill="#f0a44b" />)}
      <Box x={8} y={0} /><Box x={34} y={2} w={26} h={16} /><Box x={66} y={0} w={20} /><Box x={92} y={4} w={20} h={14} />
      <Box x={10} y={32} w={30} /><Box x={46} y={34} w={22} h={16} /><Box x={74} y={32} w={34} />
      <Box x={8} y={64} w={24} /><Box x={40} y={66} w={28} h={16} /><Box x={78} y={64} w={30} />
    </g>
  );
}

function Forklift({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={4} y={16} width={34} height={22} rx={4} fill="#fbbf24" />
      <path d="M12 16 V2 H30 L36 16" fill="none" stroke="#334155" strokeWidth={2.5} strokeLinejoin="round" />
      <rect x={38} y={0} width={3} height={40} fill="#475569" />
      <rect x={41} y={34} width={20} height={3} rx={1} fill="#475569" />
      <Box x={42} y={16} w={18} h={18} />
      <circle cx={13} cy={40} r={6} fill="#1e293b" /><circle cx={31} cy={40} r={6} fill="#1e293b" />
      <circle cx={13} cy={40} r={2.2} fill="#94a3b8" /><circle cx={31} cy={40} r={2.2} fill="#94a3b8" />
    </g>
  );
}

export function Illustration({ kind, className = '' }: { kind: IllustrationKind; className?: string }) {
  const common = { className, 'aria-hidden': true, focusable: false } as const;
  switch (kind) {
    case 'warehouse':
      return (
        <svg viewBox="0 0 340 150" {...common}>
          <defs>
            <linearGradient id="wh-floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#e7eef7" stopOpacity="0" /><stop offset="1" stopColor="#dbe6f3" /></linearGradient>
            <linearGradient id="wh-fade" x1="0" x2="1"><stop offset="0" stopColor="#f3f6fa" /><stop offset="0.35" stopColor="#f3f6fa" stopOpacity="0" /></linearGradient>
          </defs>
          <rect x="0" y="90" width="340" height="60" fill="url(#wh-floor)" />
          <g opacity="0.55"><Rack x={40} y={18} s={0.85} /></g>
          <Rack x={170} y={10} s={1.1} />
          <g transform="translate(120 100)"><rect x={0} y={24} width={52} height={5} rx={1} fill="#c9a16b" /><Box x={2} y={4} w={24} h={20} /><Box x={26} y={4} w={24} h={20} /><Box x={12} y={-14} w={26} h={18} /></g>
          <Forklift x={262} y={96} s={1.05} />
          <rect x="0" y="0" width="340" height="150" fill="url(#wh-fade)" />
        </svg>
      );
    case 'forklift':
      return <svg viewBox="0 0 80 60" {...common}><ellipse cx="38" cy="54" rx="34" ry="4" fill="#e2e8f0" /><Forklift x={8} y={8} /></svg>;
    case 'conveyor':
      return (
        <svg viewBox="0 0 140 90" {...common}>
          <ellipse cx="70" cy="82" rx="62" ry="5" fill="#e2e8f0" />
          <rect x="10" y="52" width="120" height="10" rx="5" fill="#94a3b8" />
          {[18, 38, 58, 78, 98, 118].map((cx) => <circle key={cx} cx={cx} cy={57} r={3.5} fill="#e2e8f0" />)}
          <rect x="20" y="62" width="4" height="16" fill="#94a3b8" /><rect x="116" y="62" width="4" height="16" fill="#94a3b8" />
          <Box x={22} y={30} /><Box x={56} y={26} w={26} h={22} /><Box x={94} y={32} w={20} h={16} />
        </svg>
      );
    case 'clipboard':
    case 'check':
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="84" rx="48" ry="4" fill="#e2e8f0" />
          <rect x="34" y="10" width="48" height="66" rx="6" fill="#dbeafe" stroke="#93c5fd" />
          <rect x="48" y="5" width="20" height="10" rx="3" fill="#93c5fd" />
          {[26, 40, 54].map((y) => <g key={y}><circle cx="44" cy={y} r="3" fill={kind === 'check' ? '#10b981' : '#60a5fa'} /><rect x="51" y={y - 2} width="24" height="4" rx="2" fill="#bfdbfe" /></g>)}
          <Box x={80} y={58} w={20} h={18} /><Box x={16} y={60} w={18} h={16} />
          {kind === 'check' && <g><circle cx="80" cy="30" r="11" fill="#10b981" /><path d="M75 30 l4 4 l7 -8" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>}
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="84" rx="44" ry="4" fill="#e2e8f0" />
          <rect x="28" y="12" width="52" height="64" rx="6" fill="#eef2ff" stroke="#c7d2fe" />
          {[26, 36, 46].map((y) => <rect key={y} x="36" y={y} width="34" height="4" rx="2" fill="#c7d2fe" />)}
          <circle cx="76" cy="52" r="15" fill="white" fillOpacity="0.7" stroke="#3b82f6" strokeWidth="4" />
          <path d="M87 63 l12 12" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="84" rx="44" ry="4" fill="#e2e8f0" />
          <path d="M60 8 L88 18 V42 C88 60 76 72 60 78 C44 72 32 60 32 42 V18 Z" fill="#ccfbf1" stroke="#5eead4" strokeWidth="2" />
          <path d="M49 43 l8 8 l15 -16" stroke="#0f766e" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'people':
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="84" rx="44" ry="4" fill="#e2e8f0" />
          <rect x="30" y="14" width="60" height="62" rx="10" fill="#e0f2fe" stroke="#bae6fd" />
          <circle cx="60" cy="36" r="9" fill="#38bdf8" /><path d="M42 64 c2 -12 34 -12 36 0" fill="#38bdf8" />
          <circle cx="86" cy="62" r="10" fill="#f97316" /><rect x="85" y="55" width="2.5" height="9" rx="1" fill="white" /><circle cx="86.2" cy="67" r="1.4" fill="white" />
        </svg>
      );
    case 'chart':
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="84" rx="44" ry="4" fill="#e2e8f0" />
          <rect x="24" y="14" width="72" height="62" rx="8" fill="#f0fdfa" stroke="#99f6e4" />
          {[[36, 50], [50, 38], [64, 44], [78, 28]].map(([x, y]) => <rect key={x} x={x} y={y} width="8" height={68 - y} rx="2" fill="#2dd4bf" />)}
        </svg>
      );
    case 'empty':
    default:
      return (
        <svg viewBox="0 0 120 90" {...common}>
          <ellipse cx="60" cy="82" rx="44" ry="5" fill="#e2e8f0" />
          <path d="M30 40 L60 28 L90 40 L60 52 Z" fill="#fde8c8" stroke="#e0b67a" />
          <path d="M30 40 V66 L60 78 V52 Z" fill="#f5d7a8" stroke="#e0b67a" />
          <path d="M90 40 V66 L60 78 V52 Z" fill="#eec48a" stroke="#e0b67a" />
          <path d="M84 16 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill="#93c5fd" />
          <path d="M28 18 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 Z" fill="#a5b4fc" />
        </svg>
      );
  }
}
