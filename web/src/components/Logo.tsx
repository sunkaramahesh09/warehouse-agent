import { useId } from 'react';

/**
 * Warehouse Ops mark (original): warehouse roof over palletised parcels on a teal tile.
 * The amber parcel is the "exception / needs attention" cue; the two white parcels are
 * planned work. Designed to stay legible down to 16 px (favicon).
 */
export function Logo({ size = 40, className = '', title = 'Warehouse Ops' }: { size?: number; className?: string; title?: string }) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0f5f5a" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#${g})`} />
      <path d="M8.5 22 24 11.5 39.5 22" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14.5" y="27.5" width="8.5" height="8.5" rx="1.5" fill="#fff" />
      <rect x="25" y="27.5" width="8.5" height="8.5" rx="1.5" fill="#fff" />
      <rect x="19.75" y="18.5" width="8.5" height="7.5" rx="1.5" fill="#fbbf24" />
      <path d="M14.5 38.5h19" stroke="#fff" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
