/**
 * Original page-header artwork: small isometric warehouse scenes drawn in the brand palette
 * (teal / navy / cardboard) with floating "UI chips". Pure inline SVG — no photos, no external
 * assets, decorative only (aria-hidden). One scene per page.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  Activity, BadgeCheck, BarChart3, BookOpen, Boxes, CalendarClock, CheckCircle2, ClipboardCheck, FlaskConical, Package, ScrollText, ShieldCheck, TriangleAlert, Truck, Users, Zap, type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type HeroScene = 'dashboard' | 'orders' | 'inventory' | 'pickers' | 'exceptions' | 'queue' | 'planner' | 'events' | 'audit' | 'metrics' | 'scenarios' | 'policies';

// ------------------------------------------------------------------ isometric projection
const OX = 340, OY = 80, S = 0.8;
const C30 = 0.866;
const pt = (x: number, y: number, z: number): [number, number] => [OX + (x - y) * C30 * S, OY + (x + y) * 0.5 * S - z * S];
const poly = (...p: [number, number, number][]) => p.map((q) => pt(...q).map((n) => n.toFixed(1)).join(',')).join(' ');

/** top, left (+y), right (+x) face colours */
type Faces = readonly [string, string, string];
const PAL = {
  floor: ['#ffffff', '#e4ebf3', '#d2dce8'],
  teal: ['#ccf3ec', '#7fd3c4', '#3ba494'],
  tealDeep: ['#5fd9c6', '#14a394', '#0b6f66'],
  navy: ['#5b6b84', '#334155', '#1e293b'],
  box: ['#fde8c6', '#f1c88d', '#d9a561'],
  boxAlt: ['#f8dcb0', '#e8b878', '#c98f4a'],
  amber: ['#fde68a', '#fbbf24', '#d68a06'],
  rose: ['#fecdd3', '#fb7185', '#d9304f'],
  violet: ['#e4dcff', '#a78bfa', '#7650e0'],
  sky: ['#dff2fe', '#7dd3fc', '#2ea3dc'],
  paper: ['#ffffff', '#eef2f7', '#dbe3ee'],
  pallet: ['#e6c79a', '#c99d63', '#a97c45'],
} satisfies Record<string, Faces>;

function IsoBox({ x, y, z = 8, w, d, h, c = PAL.box, tape = false, opacity }: { x: number; y: number; z?: number; w: number; d: number; h: number; c?: Faces; tape?: boolean; opacity?: number }) {
  const t = z + h;
  return (
    <g opacity={opacity} strokeLinejoin="round">
      <polygon points={poly([x, y + d, z], [x + w, y + d, z], [x + w, y + d, t], [x, y + d, t])} fill={c[1]} />
      <polygon points={poly([x + w, y, z], [x + w, y + d, z], [x + w, y + d, t], [x + w, y, t])} fill={c[2]} />
      <polygon points={poly([x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t])} fill={c[0]} />
      {tape && (
        <>
          <polygon points={poly([x, y + d / 2 - 1.6, t], [x + w, y + d / 2 - 1.6, t], [x + w, y + d / 2 + 1.6, t], [x, y + d / 2 + 1.6, t])} fill="#000" opacity={0.08} />
          <polygon points={poly([x + w, y + d / 2 - 1.6, t], [x + w, y + d / 2 + 1.6, t], [x + w, y + d / 2 + 1.6, t - h * 0.45], [x + w, y + d / 2 - 1.6, t - h * 0.45])} fill="#000" opacity={0.08} />
        </>
      )}
    </g>
  );
}

function IsoCyl({ x, y, z = 8, r, h, c = PAL.tealDeep }: { x: number; y: number; z?: number; r: number; h: number; c?: Faces }) {
  const [cx, yb] = pt(x, y, z);
  const yt = yb - h * S;
  const rx = r * S * 1.2247, ry = r * S * 0.7071;
  return (
    <g>
      <path d={`M${cx - rx} ${yt} L${cx - rx} ${yb} A${rx} ${ry} 0 0 0 ${cx + rx} ${yb} L${cx + rx} ${yt} Z`} fill={c[1]} />
      <path d={`M${cx} ${yt + ry} L${cx} ${yb + ry} A${rx} ${ry} 0 0 0 ${cx + rx} ${yb} L${cx + rx} ${yt} A${rx} ${ry} 0 0 1 ${cx} ${yt + ry} Z`} fill={c[2]} />
      <ellipse cx={cx} cy={yt} rx={rx} ry={ry} fill={c[0]} />
    </g>
  );
}

/** Flat floor marking (route, lane, footprint) */
function FloorPoly({ pts, fill, opacity = 1 }: { pts: [number, number][]; fill: string; opacity?: number }) {
  return <polygon points={poly(...pts.map(([a, b]) => [a, b, 8] as [number, number, number]))} fill={fill} opacity={opacity} />;
}

function Platform() {
  const lines: ReactNode[] = [];
  for (let x = 25; x < 200; x += 25) lines.push(<polyline key={`x${x}`} points={poly([x, 0, 8], [x, 150, 8])} />);
  for (let y = 25; y < 150; y += 25) lines.push(<polyline key={`y${y}`} points={poly([0, y, 8], [200, y, 8])} />);
  return (
    <g>
      <IsoBox x={0} y={0} z={0} w={200} h={8} d={150} c={PAL.floor} />
      <g stroke="#e3eaf3" strokeWidth={0.8} fill="none">{lines}</g>
    </g>
  );
}

/** Pallet-racking bay: back uprights, shelves with boxes, front uprights */
function Rack({ x, y, w = 70, d = 22, levels = [0, 30, 60], fill = [] as ([number, number, Faces?] | null)[][] }: { x: number; y: number; w?: number; d?: number; levels?: number[]; fill?: ([number, number, Faces?] | null)[][] }) {
  const H = levels[levels.length - 1] + 30;
  const post = (px: number, py: number) => <IsoBox x={px} y={py} w={2.4} d={2.4} h={H} c={PAL.navy} />;
  return (
    <g>
      {post(x, y)}{post(x + w - 2.4, y)}
      {levels.map((lv, i) => (
        <g key={lv}>
          <IsoBox x={x} y={y} z={8 + lv} w={w} d={d} h={2.4} c={PAL.amber} />
          {(fill[i] ?? []).map((b, j) => b && <IsoBox key={j} x={x + b[0]} y={y + 3} z={10.4 + lv} w={b[1]} d={d - 6} h={Math.min(22, 16 + (j % 2) * 5)} c={b[2] ?? (j % 2 ? PAL.boxAlt : PAL.box)} tape />)}
        </g>
      ))}
      {post(x, y + d - 2.4)}{post(x + w - 2.4, y + d - 2.4)}
    </g>
  );
}

function Pallet({ x, y, w = 34, d = 30, boxes = [] as [number, number, number, number, number, number, Faces?][] }: { x: number; y: number; w?: number; d?: number; boxes?: [number, number, number, number, number, number, Faces?][] }) {
  return (
    <g>
      <IsoBox x={x} y={y} w={w} d={d} h={4} c={PAL.pallet} />
      {boxes.map(([bx, by, bz, bw, bd, bh, c], i) => <IsoBox key={i} x={x + bx} y={y + by} z={12 + bz} w={bw} d={bd} h={bh} c={c ?? (i % 2 ? PAL.boxAlt : PAL.box)} tape />)}
    </g>
  );
}

// ------------------------------------------------------------------ floating 2-D "UI chips"
type LIcon = ComponentType<LucideProps>;
const TONE = {
  teal: ['#ccfbf1', '#0f766e'], amber: ['#fef3c7', '#b45309'], rose: ['#ffe4e6', '#be123c'], violet: ['#ede9fe', '#6d28d9'],
  sky: ['#e0f2fe', '#0369a1'], emerald: ['#d1fae5', '#047857'], navy: ['#e2e8f0', '#0f1b35'],
} as const;
type ToneKey = keyof typeof TONE;

function Chip({ x, y, w, h = 44, icon: I, tone = 'teal', filter, children }: { x: number; y: number; w: number; h?: number; icon?: LIcon; tone?: ToneKey; filter: string; children?: ReactNode }) {
  const [bg, fg] = TONE[tone];
  return (
    <g data-depth="fg"><g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={10} fill="#fff" filter={filter} />
      <rect width={w} height={h} rx={10} fill="none" stroke="#e3e8ef" />
      {I && (
        <>
          <rect x={9} y={h / 2 - 12} width={24} height={24} rx={7} fill={bg} />
          <I x={14} y={h / 2 - 7} width={14} height={14} color={fg} strokeWidth={2.2} />
        </>
      )}
      <g transform={`translate(${I ? 41 : 10} 0)`}>{children}</g>
    </g></g>
  );
}
/** two "text" lines */
const Lines = ({ h = 44, w1 = 46, w2 = 30, c = '#0f1b35' }: { h?: number; w1?: number; w2?: number; c?: string }) => (
  <>
    <rect y={h / 2 - 8} width={w1} height={6} rx={3} fill={c} opacity={0.85} />
    <rect y={h / 2 + 3} width={w2} height={5} rx={2.5} fill="#94a3b8" opacity={0.6} />
  </>
);
const Pill = ({ x, y, w = 26, tone = 'teal' }: { x: number; y: number; w?: number; tone?: ToneKey }) => (
  <rect x={x} y={y} width={w} height={9} rx={4.5} fill={TONE[tone][0]} stroke={TONE[tone][1]} strokeOpacity={0.25} />
);

// ------------------------------------------------------------------ scenes
function Scene({ kind, f }: { kind: HeroScene; f: string }) {
  switch (kind) {
    case 'dashboard':
      return (
        <>
          <Platform />
          <Rack x={14} y={6} w={78} levels={[0, 30, 60]} fill={[[[4, 20], [28, 22], [54, 20]], [[4, 26], [34, 18, PAL.teal], [56, 18]], [[6, 22], [32, 24], null]]} />
          <Rack x={104} y={6} w={78} levels={[0, 30, 60]} fill={[[[4, 22], [30, 20], [54, 20, PAL.sky]], [[6, 30], [40, 30]], [[4, 18], [26, 22, PAL.teal], [52, 22]]]} />
          {[[112, 74, 26], [134, 74, 44], [156, 74, 64], [178, 74, 86]].map(([x, y, h]) => <IsoBox key={x} x={x} y={y} w={14} d={14} h={h} c={x === 178 ? PAL.tealDeep : PAL.teal} />)}
          <Pallet x={28} y={92} boxes={[[2, 2, 0, 15, 12, 14], [17, 2, 0, 15, 12, 14], [2, 15, 0, 15, 13, 14], [17, 15, 0, 15, 13, 14], [6, 6, 14, 22, 18, 13]]} />
          <Chip x={150} y={20} w={128} icon={Activity} filter={f}>
            <polyline points="0,30 12,24 22,27 34,16 46,19 58,9 72,12" fill="none" stroke="#0d9488" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={72} cy={12} r={3} fill="#0d9488" />
          </Chip>
          <Chip x={420} y={180} w={118} icon={CheckCircle2} tone="emerald" filter={f}><Lines w1={44} w2={58} /></Chip>
          <Chip x={470} y={28} w={66} h={36} filter={f}>
            <circle cx={14} cy={18} r={10} fill="none" stroke="#e2e8f0" strokeWidth={4} />
            <circle cx={14} cy={18} r={10} fill="none" stroke="#0d9488" strokeWidth={4} strokeDasharray="50 63" strokeLinecap="round" transform="rotate(-90 14 18)" />
            <rect x={30} y={12} width={20} height={5} rx={2.5} fill="#0f1b35" opacity={0.8} />
            <rect x={30} y={21} width={14} height={4} rx={2} fill="#94a3b8" opacity={0.6} />
          </Chip>
        </>
      );
    case 'orders':
      return (
        <>
          <Platform />
          <FloorPoly pts={[[0, 64], [200, 64], [200, 86], [0, 86]]} fill="#fbbf24" opacity={0.18} />
          <Pallet x={18} y={14} w={40} d={34} boxes={[[2, 2, 0, 18, 15, 16], [20, 2, 0, 18, 15, 16], [2, 17, 0, 18, 15, 16], [20, 17, 0, 18, 15, 16], [4, 4, 16, 16, 14, 14], [21, 4, 16, 16, 14, 14], [8, 16, 16, 22, 15, 14, PAL.teal]]} />
          <Pallet x={80} y={16} w={40} d={32} boxes={[[3, 3, 0, 34, 26, 22], [8, 6, 22, 24, 20, 16, PAL.boxAlt]]} />
          <Pallet x={140} y={14} w={40} d={34} boxes={[[2, 2, 0, 18, 30, 26], [21, 2, 0, 17, 30, 18, PAL.boxAlt]]} />
          {[20, 62, 104, 146].map((x, i) => <IsoBox key={x} x={x} y={68} w={24} d={16} h={14} c={i === 2 ? PAL.teal : i % 2 ? PAL.boxAlt : PAL.box} tape />)}
          <Pallet x={40} y={104} w={34} d={30} boxes={[[2, 2, 0, 30, 26, 18]]} />
          <IsoBox x={120} y={108} w={40} d={30} h={4} c={PAL.pallet} />
          <Chip x={144} y={24} w={142} h={66} icon={Package} filter={f} >
            <rect y={14} width={52} height={6} rx={3} fill="#0f1b35" opacity={0.85} />
            <Pill x={58} y={12.5} w={30} tone="sky" />
            <rect y={30} width={86} height={4} rx={2} fill="#cbd5e1" />
            <rect y={40} width={68} height={4} rx={2} fill="#cbd5e1" />
            <rect y={50} width={40} height={4} rx={2} fill="#14b8a6" />
          </Chip>
          <Chip x={434} y={170} w={104} icon={Truck} tone="violet" filter={f}><Lines w1={36} w2={50} /></Chip>
        </>
      );
    case 'inventory':
      return (
        <>
          <Platform />
          <Rack x={10} y={4} w={84} levels={[0, 28, 56]} fill={[[[4, 24], [32, 22, PAL.teal], [58, 22]], [[4, 18], [26, 30], [60, 20]], [[4, 26], [34, 20], [58, 22, PAL.sky]]]} />
          <Rack x={10} y={40} w={84} levels={[0, 28, 56]} fill={[[[4, 30], [38, 20], [62, 18]], [[6, 22, PAL.boxAlt], [32, 24], null], [[4, 20], [28, 26, PAL.teal], [58, 22]]]} />
          {/* truck at the dock */}
          <IsoBox x={118} y={70} w={70} d={34} h={44} c={PAL.paper} />
          <IsoBox x={188} y={74} w={12} d={26} h={24} c={PAL.tealDeep} />
          <IsoBox x={190} y={77} w={8} d={20} h={10} z={30} c={['#bfe9f5', '#9fd8ea', '#7cc5dc']} />
          <IsoBox x={118} y={104} w={70} d={0.1} h={6} z={30} c={PAL.tealDeep} />
          <Pallet x={130} y={30} w={34} d={28} boxes={[[2, 2, 0, 30, 24, 16], [5, 5, 16, 22, 18, 12, PAL.boxAlt]]} />
          <Chip x={410} y={20} w={128} icon={Boxes} filter={f}>
            {[0, 12, 24, 36, 48, 60].map((x, i) => <rect key={x} x={x} y={30 - [12, 18, 9, 22, 15, 20][i]} width={8} height={[12, 18, 9, 22, 15, 20][i]} rx={2} fill={i === 3 ? '#0d9488' : '#99e2d6'} />)}
          </Chip>
          <Chip x={306} y={186} w={108} icon={Truck} tone="sky" filter={f}><Lines w1={38} w2={52} /></Chip>
        </>
      );
    case 'pickers':
      return (
        <>
          <Platform />
          {/* aisles + pick route */}
          <Rack x={8} y={8} w={58} d={20} levels={[0, 28]} fill={[[[4, 24], [32, 22, PAL.teal]], [[4, 20], [28, 26]]]} />
          <Rack x={8} y={60} w={58} d={20} levels={[0, 28]} fill={[[[4, 22], [30, 24]], [[4, 26, PAL.sky], [34, 20]]]} />
          <Rack x={110} y={8} w={80} d={20} levels={[0, 28]} fill={[[[4, 22], [30, 22], [56, 20, PAL.teal]], [[4, 30], [38, 18], [60, 16]]]} />
          <g fill="none" stroke="#0d9488" strokeWidth={2.4} strokeDasharray="5 5" strokeLinecap="round">
            <polyline points={poly([20, 44, 8], [92, 44, 8], [92, 108, 8], [176, 108, 8], [176, 44, 8])} />
          </g>
          {[[20, 44], [92, 108], [176, 44]].map(([x, y], i) => { const [sx, sy] = pt(x, y, 8); return <g key={i}><ellipse cx={sx} cy={sy} rx={6} ry={3.4} fill="#0d9488" opacity={0.25} /><path d={`M${sx} ${sy} l-6 -12 a7 7 0 1 1 12 0 z`} fill={i === 2 ? '#f59e0b' : '#0d9488'} /><circle cx={sx} cy={sy - 15} r={2.6} fill="#fff" /></g>; })}
          {/* picking cart */}
          <IsoBox x={120} y={56} w={30} d={18} h={3} z={14} c={PAL.navy} />
          <IsoCyl x={124} y={74} z={8} r={3} h={6} c={PAL.navy} /><IsoCyl x={148} y={74} z={8} r={3} h={6} c={PAL.navy} />
          <IsoBox x={122} y={58} w={13} d={14} h={12} z={17} c={PAL.box} tape />
          <IsoBox x={136} y={58} w={13} d={14} h={16} z={17} c={PAL.teal} tape />
          <IsoBox x={150} y={56} w={2} d={18} h={26} z={14} c={PAL.navy} />
          <Chip x={146} y={28} w={124} icon={Users} filter={f}>
            {[0, 1, 2, 3].map((i) => <circle key={i} cx={8 + i * 15} cy={22} r={7} fill={['#99e2d6', '#fde68a', '#c4b5fd', '#7dd3fc'][i]} stroke="#fff" strokeWidth={2} />)}
            <rect x={66} y={19} width={10} height={6} rx={3} fill="#94a3b8" opacity={0.6} />
          </Chip>
          <Chip x={430} y={176} w={108} icon={CheckCircle2} tone="emerald" filter={f}><Lines w1={40} w2={54} /></Chip>
        </>
      );
    case 'exceptions':
      return (
        <>
          <Platform />
          <Rack x={14} y={6} w={84} levels={[0, 30]} fill={[[[4, 24], [32, 22], [58, 22]], [[4, 22], [30, 26], [60, 20]]]} />
          <FloorPoly pts={[[110, 50], [180, 50], [180, 120], [110, 120]]} fill="#f43f5e" opacity={0.08} />
          <g fill="none" stroke="#f43f5e" strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="6 5"><polygon points={poly([110, 50, 8], [180, 50, 8], [180, 120, 8], [110, 120, 8])} /></g>
          <Pallet x={124} y={64} w={40} d={34} boxes={[[2, 2, 0, 18, 30, 18], [21, 2, 0, 17, 15, 18, PAL.rose], [21, 18, 0, 17, 14, 18], [4, 4, 18, 14, 12, 12]]} />
          <IsoBox x={30} y={84} w={20} d={16} h={14} c={PAL.box} tape />
          <IsoBox x={56} y={92} w={18} d={18} h={18} c={PAL.boxAlt} tape />
          {(() => { const [sx, sy] = pt(144, 80, 70); return (
            <g transform={`translate(${sx} ${sy})`}>
              <circle r={26} fill="#f43f5e" opacity={0.12} />
              <path d="M0 -17 L17 13 L-17 13 Z" fill="#fff" stroke="#e11d48" strokeWidth={3} strokeLinejoin="round" />
              <rect x={-1.6} y={-6} width={3.2} height={10} rx={1.6} fill="#e11d48" /><circle cy={8.5} r={1.9} fill="#e11d48" />
            </g>); })()}
          <Chip x={404} y={26} w={134} icon={TriangleAlert} tone="rose" filter={f}>
            <rect y={14} width={40} height={6} rx={3} fill="#0f1b35" opacity={0.85} /><Pill x={46} y={12.5} w={34} tone="rose" />
            <rect y={27} width={70} height={4} rx={2} fill="#cbd5e1" />
          </Chip>
          <Chip x={150} y={170} w={118} icon={ShieldCheck} tone="teal" filter={f}><Lines w1={48} w2={34} /></Chip>
        </>
      );
    case 'queue':
      return (
        <>
          <Platform />
          {/* tablet standing on the floor */}
          <g>
            <polygon points={poly([40, 60, 8], [150, 60, 8], [150, 60, 92], [40, 60, 92])} fill="#1e293b" />
            <polygon points={poly([40, 56, 8], [150, 56, 8], [150, 56, 92], [40, 56, 92])} fill="#334155" />
            <polygon points={poly([44, 55.9, 12], [146, 55.9, 12], [146, 55.9, 88], [44, 55.9, 88])} fill="#f8fafc" />
            {[0, 1, 2].map((i) => { const z = 74 - i * 22; return (
              <g key={i}>
                <polygon points={poly([52, 55.8, z], [64, 55.8, z], [64, 55.8, z + 12], [52, 55.8, z + 12])} fill={i === 2 ? '#fde68a' : '#99f6e4'} />
                <polygon points={poly([70, 55.8, z + 7], [128, 55.8, z + 7], [128, 55.8, z + 10], [70, 55.8, z + 10])} fill="#334155" opacity={0.75} />
                <polygon points={poly([70, 55.8, z + 1], [110, 55.8, z + 1], [110, 55.8, z + 4], [70, 55.8, z + 4])} fill="#94a3b8" opacity={0.6} />
              </g>); })}
          </g>
          <IsoBox x={36} y={56} w={118} d={8} h={4} c={PAL.navy} />
          <Pallet x={150} y={86} w={34} d={30} boxes={[[2, 2, 0, 30, 26, 16], [6, 6, 16, 20, 16, 12, PAL.teal]]} />
          <IsoBox x={24} y={104} w={20} d={20} h={16} c={PAL.box} tape />
          <Chip x={418} y={26} w={120} icon={ClipboardCheck} filter={f}><Lines w1={40} w2={56} /></Chip>
          <Chip x={420} y={170} w={118} icon={BadgeCheck} tone="emerald" filter={f}>
            <rect y={18} width={34} height={9} rx={4.5} fill="#10b981" /><rect x={40} y={18} width={30} height={9} rx={4.5} fill="#fff" stroke="#e2e8f0" />
          </Chip>
        </>
      );
    case 'planner':
      return (
        <>
          <Platform />
          {/* gantt lanes on the floor */}
          {[0, 1, 2, 3].map((i) => <FloorPoly key={i} pts={[[14, 18 + i * 30], [190, 18 + i * 30], [190, 38 + i * 30], [14, 38 + i * 30]]} fill={i % 2 ? '#e2f6f2' : '#f1f5f9'} />)}
          {([[20, 0, 60, PAL.teal], [86, 0, 46, PAL.tealDeep], [138, 0, 46, PAL.sky], [24, 1, 80, PAL.violet], [110, 1, 70, PAL.teal], [18, 2, 40, PAL.amber], [64, 2, 90, PAL.teal], [30, 3, 54, PAL.sky], [90, 3, 52, PAL.tealDeep]] as [number, number, number, Faces][]).map(([x, lane, w, c], i) => (
            <IsoBox key={i} x={x} y={21 + lane * 30} w={w} d={14} h={8 + (i % 3) * 3} c={c} />
          ))}
          {/* clock */}
          {(() => { const [sx, sy] = pt(176, 132, 26); return (
            <g transform={`translate(${sx} ${sy})`}>
              <ellipse cx={3} cy={18} rx={18} ry={5} fill="#0f1b35" opacity={0.08} />
              <circle r={21} fill="#fff" stroke="#0f766e" strokeWidth={4} />
              <path d="M0 -12 V0 L8 6" fill="none" stroke="#0f1b35" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <circle r={2.4} fill="#0f1b35" />
            </g>); })()}
          <Chip x={150} y={24} w={126} icon={CalendarClock} filter={f}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={i * 10} y={i === 3 ? 13 : 17} width={7} height={i === 3 ? 18 : 10} rx={2} fill={i === 3 ? '#0d9488' : '#cbd5e1'} />)}
          </Chip>
          <Chip x={432} y={170} w={106} icon={Users} tone="violet" filter={f}><Lines w1={34} w2={48} /></Chip>
        </>
      );
    case 'events':
      return (
        <>
          <Platform />
          {(() => {
            const nodes: [number, number, Faces][] = [[34, 30, PAL.teal], [100, 26, PAL.violet], [164, 36, PAL.teal], [60, 96, PAL.sky], [130, 104, PAL.tealDeep]];
            const edges = [[0, 1], [1, 2], [0, 3], [1, 4], [3, 4], [2, 4]];
            return (
              <>
                <g stroke="#0d9488" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" opacity={0.7}>
                  {edges.map(([a, b]) => { const [x1, y1] = pt(nodes[a][0], nodes[a][1], 8); const [x2, y2] = pt(nodes[b][0], nodes[b][1], 8); return <line key={`${a}${b}`} x1={x1} y1={y1} x2={x2} y2={y2} />; })}
                </g>
                {nodes.map(([x, y, c], i) => <IsoCyl key={i} x={x} y={y} r={11} h={i === 4 ? 26 : 14} c={c} />)}
              </>
            );
          })()}
          {(() => { const [sx, sy] = pt(130, 104, 60); return (
            <g transform={`translate(${sx} ${sy})`}>
              <circle r={22} fill="#f59e0b" opacity={0.15} />
              <path d="M3 -16 L-9 3 H0 L-3 16 L10 -3 H1 Z" fill="#f59e0b" stroke="#b45309" strokeWidth={1.4} strokeLinejoin="round" />
            </g>); })()}
          <Chip x={150} y={22} w={124} icon={Zap} tone="amber" filter={f}><Lines w1={46} w2={60} /></Chip>
          <Chip x={420} y={176} w={118} icon={Activity} filter={f}>
            <polyline points="0,26 10,26 16,14 24,32 32,20 40,24 70,24" fill="none" stroke="#0d9488" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Chip>
        </>
      );
    case 'audit':
      return (
        <>
          <Platform />
          {/* stacked log sheets */}
          {[0, 1, 2, 3, 4, 5].map((i) => <IsoBox key={i} x={40 + (i % 2) * 2} y={30 - (i % 2) * 2} z={8 + i * 5} w={64} d={48} h={3} c={PAL.paper} />)}
          {[0, 1, 2, 3].map((i) => <polygon key={i} points={poly([48, 36 + i * 9, 41], [96, 36 + i * 9, 41], [96, 39 + i * 9, 41], [48, 39 + i * 9, 41])} fill={i === 0 ? '#0d9488' : '#cbd5e1'} />)}
          <IsoBox x={130} y={30} w={44} d={34} h={20} c={PAL.navy} />
          <IsoBox x={134} y={34} w={36} d={26} h={3} z={28} c={PAL.tealDeep} />
          <Pallet x={120} y={90} w={34} d={30} boxes={[[2, 2, 0, 30, 26, 18]]} />
          {(() => { const [sx, sy] = pt(70, 110, 30); return (
            <g transform={`translate(${sx} ${sy})`}>
              <line x1={14} y1={14} x2={30} y2={30} stroke="#0f1b35" strokeWidth={7} strokeLinecap="round" />
              <circle r={20} fill="#ffffff" fillOpacity={0.7} stroke="#0f766e" strokeWidth={5} />
              <rect x={-9} y={-6} width={18} height={3.4} rx={1.7} fill="#0f766e" /><rect x={-9} y={2} width={12} height={3.4} rx={1.7} fill="#94a3b8" />
            </g>); })()}
          <Chip x={410} y={24} w={128} icon={ScrollText} filter={f}>
            <rect y={13} width={28} height={5} rx={2.5} fill="#94a3b8" opacity={0.7} /><Pill x={34} y={11} w={40} tone="teal" />
            <rect y={27} width={70} height={4} rx={2} fill="#cbd5e1" />
          </Chip>
          <Chip x={150} y={170} w={114} icon={CheckCircle2} tone="emerald" filter={f}><Lines w1={50} w2={36} /></Chip>
        </>
      );
    case 'metrics':
      return (
        <>
          <Platform />
          {[[24, 18, 34], [52, 18, 52], [80, 18, 42], [108, 18, 70], [136, 18, 60], [164, 18, 92]].map(([x, y, h], i) => <IsoBox key={x} x={x} y={y} w={18} d={18} h={h} c={i === 5 ? PAL.tealDeep : PAL.teal} />)}
          <g fill="none" stroke="#7650e0" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <polyline points={poly([33, 27, 54], [61, 27, 70], [89, 27, 66], [117, 27, 90], [145, 27, 84], [173, 27, 112])} />
          </g>
          {([[33, 27, 54], [61, 27, 70], [89, 27, 66], [117, 27, 90], [145, 27, 84], [173, 27, 112]] as [number, number, number][]).map((p, i) => { const [x, y] = pt(...p); return <circle key={i} cx={x} cy={y} r={3.2} fill="#fff" stroke="#7650e0" strokeWidth={2} />; })}
          <IsoCyl x={70} y={100} r={20} h={10} c={PAL.violet} />
          <IsoCyl x={70} y={100} z={18} r={14} h={6} c={PAL.teal} />
          <Pallet x={130} y={90} w={34} d={30} boxes={[[2, 2, 0, 30, 26, 16]]} />
          <Chip x={150} y={24} w={118} icon={BarChart3} tone="violet" filter={f}>
            <rect y={12} width={36} height={8} rx={4} fill="#0f1b35" opacity={0.85} /><rect x={42} y={13} width={26} height={7} rx={3.5} fill="#d1fae5" />
            <rect y={27} width={60} height={4} rx={2} fill="#cbd5e1" />
          </Chip>
          <Chip x={436} y={176} w={102} icon={CheckCircle2} tone="emerald" filter={f}><Lines w1={36} w2={48} /></Chip>
        </>
      );
    case 'scenarios':
      return (
        <>
          <Platform />
          {/* test rack: tubes on a tray */}
          <IsoBox x={28} y={30} w={96} d={30} h={10} c={PAL.navy} />
          {[0, 1, 2, 3, 4].map((i) => <IsoCyl key={i} x={40 + i * 18} y={45} z={18} r={6} h={[34, 26, 40, 30, 22][i]} c={i === 3 ? PAL.amber : i === 1 ? PAL.violet : PAL.teal} />)}
          <Pallet x={130} y={34} w={40} d={34} boxes={[[2, 2, 0, 18, 30, 16], [21, 2, 0, 17, 30, 22, PAL.boxAlt]]} />
          {[[50, 100], [90, 106], [130, 112]].map(([x, y], i) => { const [sx, sy] = pt(x, y, 8); return (
            <g key={i} transform={`translate(${sx} ${sy - 16})`}>
              <ellipse cy={16} rx={12} ry={4} fill="#0f1b35" opacity={0.07} />
              <circle r={12} fill={i === 2 ? '#f59e0b' : '#10b981'} />
              {i === 2 ? <rect x={-1.5} y={-6} width={3} height={12} rx={1.5} fill="#fff" /> : <path d="M-5 0 L-1.5 4 L5.5 -4" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />}
            </g>); })}
          <Chip x={410} y={24} w={128} icon={FlaskConical} filter={f}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={i * 9} y={15} width={7} height={14} rx={2} fill={i === 6 ? '#f59e0b' : '#10b981'} />)}
          </Chip>
          <Chip x={150} y={172} w={112} icon={BadgeCheck} tone="emerald" filter={f}><Lines w1={44} w2={30} /></Chip>
        </>
      );
    case 'policies':
      return (
        <>
          <Platform />
          {/* book stack */}
          <IsoBox x={34} y={30} w={60} d={44} h={10} c={PAL.tealDeep} />
          <IsoBox x={36} y={32} w={56} d={40} h={1.2} z={18} c={PAL.paper} />
          <IsoBox x={30} y={28} w={62} d={44} h={10} z={19.2} c={PAL.violet} />
          <IsoBox x={38} y={30} w={54} d={40} h={9} z={29.2} c={PAL.sky} />
          <IsoBox x={34} y={32} w={58} d={38} h={2} z={38.2} c={PAL.paper} />
          {/* shield */}
          {(() => { const [sx, sy] = pt(146, 70, 60); return (
            <g transform={`translate(${sx} ${sy})`}>
              <ellipse cy={44} rx={24} ry={7} fill="#0f1b35" opacity={0.08} />
              <path d="M0 -30 L26 -20 V4 C26 22 12 32 0 38 C-12 32 -26 22 -26 4 V-20 Z" fill="#0f766e" />
              <path d="M0 -30 L26 -20 V4 C26 22 12 32 0 38 Z" fill="#0b5f58" />
              <path d="M-10 4 L-2 12 L12 -6" fill="none" stroke="#fff" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
            </g>); })()}
          <IsoBox x={40} y={104} w={20} d={18} h={16} c={PAL.box} tape />
          <IsoBox x={64} y={110} w={16} d={14} h={12} c={PAL.boxAlt} tape />
          <Chip x={150} y={24} w={124} icon={BookOpen} filter={f}><Lines w1={52} w2={68} /></Chip>
          <Chip x={430} y={176} w={108} icon={ShieldCheck} tone="teal" filter={f}><Lines w1={40} w2={26} /></Chip>
        </>
      );
  }
}

/**
 * Subtle pointer parallax: the scene tilts toward the cursor while it is over the art, floating chips
 * move a little more (foreground), the glow a little less (background). Fine pointers only, off for
 * prefers-reduced-motion. Transforms are written straight to the DOM from one rAF loop (no React state).
 */
function useTilt(ref: React.RefObject<SVGSVGElement | null>, enabled: boolean) {
  useEffect(() => {
    const svg = ref.current;
    if (!enabled || !svg) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fg = Array.from(svg.querySelectorAll<SVGGElement>('[data-depth="fg"]'));
    const bg = Array.from(svg.querySelectorAll<SVGGElement>('[data-depth="bg"]'));
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;

    const apply = () => {
      const moving = Math.abs(cx) > 0.001 || Math.abs(cy) > 0.001;
      svg.style.transform = moving ? `perspective(900px) rotateX(${(-cy * 5).toFixed(3)}deg) rotateY(${(cx * 5).toFixed(3)}deg) translate3d(${(cx * 4).toFixed(2)}px, ${(cy * 4).toFixed(2)}px, 0)` : '';
      svg.style.willChange = moving ? 'transform' : '';
      for (const g of fg) g.style.transform = moving ? `translate(${(cx * 5).toFixed(2)}px, ${(cy * 4).toFixed(2)}px)` : '';
      for (const g of bg) g.style.transform = moving ? `translate(${(-cx * 3).toFixed(2)}px, ${(-cy * 2).toFixed(2)}px)` : '';
    };
    const tick = () => {
      cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09; // eased follow, no jumps
      if (Math.abs(tx - cx) < 0.0005 && Math.abs(ty - cy) < 0.0005) { cx = tx; cy = ty; raf = 0; } else raf = requestAnimationFrame(tick);
      apply();
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || !fine.matches || reduced.matches) return;
      const r = svg.getBoundingClientRect();
      const inside = r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const nx = inside ? ((e.clientX - r.left) / r.width) * 2 - 1 : 0;
      const ny = inside ? ((e.clientY - r.top) / r.height) * 2 - 1 : 0;
      if (nx !== tx || ny !== ty) { tx = nx; ty = ny; kick(); }
    };
    const reset = () => { tx = 0; ty = 0; kick(); };
    const onMotionPref = () => { if (reduced.matches) { tx = ty = cx = cy = 0; cancelAnimationFrame(raf); raf = 0; apply(); } };
    // the art sits under the (pointer-transparent) header text layer, so hit-test against its own box
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    reduced.addEventListener('change', onMotionPref);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      reduced.removeEventListener('change', onMotionPref);
      cancelAnimationFrame(raf);
      tx = ty = cx = cy = 0; apply();
    };
  }, [ref, enabled]);
}

export function HeroArt({ scene, className = '', tilt = false }: { scene: HeroScene; className?: string; tilt?: boolean }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  useTilt(ref, tilt);
  return (
    <svg ref={ref} viewBox="128 0 432 236" className={className} aria-hidden focusable={false} preserveAspectRatio="xMaxYMid meet">
      <defs>
        <filter id={`${id}s`} x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#0f1b35" floodOpacity="0.10" />
        </filter>
        <filter id={`${id}b`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10" /></filter>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#5eead4" stopOpacity="0.35" /><stop offset="1" stopColor="#5eead4" stopOpacity="0" /></radialGradient>
      </defs>
      <g data-depth="bg"><ellipse cx={OX - 10} cy={120} rx={230} ry={115} fill={`url(#${id}r)`} /></g>
      <polygon points={poly([4, 10, -14], [204, 10, -14], [204, 160, -14], [4, 160, -14])} fill="#0f4a46" opacity={0.16} filter={`url(#${id}b)`} />
      <Scene kind={scene} f={`url(#${id}s)`} />
    </svg>
  );
}
