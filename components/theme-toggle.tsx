'use client';

import * as React from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

const PRISM_FACETS = [
  { id: 'f1', top: '22%', left: '18%', delay: 0 },
  { id: 'f2', top: '68%', left: '30%', delay: 0.35 },
  { id: 'f3', top: '28%', left: '44%', delay: 0.7 },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, mounted, toggleTheme } = useTheme();
  const isDark = mounted && theme === 'dark';
  const [eclipsePulse, setEclipsePulse] = React.useState(0);

  // Subtle magnetic 3D jewel tilt on pointer hover
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 340, damping: 22 });
  const springY = useSpring(pointerY, { stiffness: 340, damping: 22 });
  const rotateX = useTransform(springY, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-10, 10]);

  const cachedRectRef = React.useRef<DOMRect | null>(null);

  const handlePointerEnter = (e: React.PointerEvent<HTMLButtonElement>) => {
    cachedRectRef.current = e.currentTarget.getBoundingClientRect();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect =
      cachedRectRef.current ?? e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    pointerX.set(nx);
    pointerY.set(ny);
  };

  const handlePointerLeave = () => {
    cachedRectRef.current = null;
    pointerX.set(0);
    pointerY.set(0);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setEclipsePulse((c) => c + 1);
    toggleTheme({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  };

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      data-testid="theme-toggle"
      data-theme-state={isDark ? 'dark' : 'light'}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      whileHover={{ scale: 1.035 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 460, damping: 24 }}
      style={{
        rotateX,
        rotateY,
        transformPerspective: 680,
      }}
      className={cn(
        'group relative inline-flex h-9 sm:h-10 w-[5.75rem] sm:w-[6.5rem] shrink-0 items-center rounded-xl border p-1 overflow-hidden select-none cursor-pointer transition-[border-color,box-shadow] duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B0B0F]',
        isDark
          ? 'justify-end border-rose-500/60 bg-gradient-to-r from-[#09060D] via-[#170914] to-[#2A0A18] shadow-[0_0_1.35rem_rgba(225,29,72,0.34),inset_0_1px_2px_rgba(255,255,255,0.14)] hover:border-rose-400/90'
          : 'justify-start border-amber-300/90 bg-gradient-to-r from-amber-50 via-rose-50/90 to-amber-100/95 shadow-[0_0_1.05rem_rgba(245,158,11,0.25),inset_0_1px_2px_rgba(255,255,255,0.92)] hover:border-amber-400',
        className
      )}
    >
      {/* Diagonal Prismatic Silk Foil Sweep on Hover */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-full rotate-45 opacity-0 group-hover:opacity-100 transition-transform duration-700 group-hover:translate-x-5',
          isDark
            ? 'bg-[linear-gradient(90deg,transparent_35%,rgba(244,63,94,0.26)_50%,transparent_65%)]'
            : 'bg-[linear-gradient(90deg,transparent_35%,rgba(251,191,36,0.36)_50%,transparent_65%)]'
        )}
      />

      {/* Diamond Starlight Facets (Dark Velvet Mode - zero JS loop overhead) */}
      {isDark && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          {PRISM_FACETS.map((facet) => (
            <span
              key={facet.id}
              style={{
                top: facet.top,
                left: facet.left,
              }}
              className="absolute h-1 w-1 rotate-45 bg-amber-300 opacity-75 group-hover:opacity-100 group-hover:scale-125 transition-all duration-300 shadow-[0_0_0.4rem_rgba(251,191,36,0.95)]"
            />
          ))}
        </span>
      )}

      {/* Editorial Mode Readout opposite the Faceted Eclipse Jewel */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 flex items-center px-2 text-[0.55rem] font-mono font-extrabold uppercase tracking-widest whitespace-nowrap shrink-0 transition-all duration-300',
          isDark ? 'left-1 text-rose-200/95' : 'right-1 text-amber-950/85'
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="mode-velvet"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span className="inline-block h-1.5 w-1.5 rotate-45 bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.9)]" />
              <span>NIGHT</span>
            </motion.span>
          ) : (
            <motion.span
              key="mode-solar"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center gap-0.5 whitespace-nowrap shrink-0"
            >
              <span>LIGHT</span>
              <Sparkles className="h-2.5 w-2.5 text-amber-600 shrink-0" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Faceted Diamond-Iris Eclipse Jewel Thumb */}
      <motion.span
        layout
        aria-hidden="true"
        transition={{
          type: 'spring',
          stiffness: 420,
          damping: 26,
          mass: 0.72,
        }}
        className={cn(
          'relative z-10 flex h-7 w-7 sm:h-7.5 sm:w-7.5 items-center justify-center rounded-lg transition-colors duration-300',
          isDark
            ? 'bg-gradient-to-br from-[#2B0918] via-[#12060D] to-rose-900/90 text-amber-200 shadow-[0_0_1rem_rgba(225,29,72,0.72)] ring-1 ring-rose-400/60'
            : 'bg-gradient-to-br from-white via-amber-50 to-amber-200/90 text-amber-600 shadow-[0_2px_0.75rem_rgba(245,158,11,0.5)] ring-1 ring-amber-400/90'
        )}
      >
        {/* Rotating Geometric Diamond Bezel Inside Thumb */}
        <motion.span
          animate={{ rotate: isDark ? 135 : 45 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className={cn(
            'pointer-events-none absolute inset-1 rounded-[3px] border',
            isDark
              ? 'border-rose-400/50 shadow-[inset_0_0_6px_rgba(244,63,94,0.45)]'
              : 'border-amber-500/45 shadow-[inset_0_0_6px_rgba(245,158,11,0.35)]'
          )}
        />

        {/* Click Diamond Prism Shockwave */}
        <AnimatePresence>
          {eclipsePulse > 0 && (
            <motion.span
              key={eclipsePulse}
              initial={{ scale: 0.65, rotate: 0, opacity: 0.95 }}
              animate={{ scale: 2.1, rotate: 90, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'pointer-events-none absolute inset-0.5 rotate-45 rounded-[3px] border-2',
                isDark ? 'border-rose-400' : 'border-amber-400'
              )}
            />
          )}
        </AnimatePresence>

        {/* Celestial Total Eclipse vs Diamond Sunburst Core */}
        <div className="relative flex h-4 w-4 items-center justify-center">
          {/* Golden Corona / Solar Core */}
          <motion.span
            animate={{
              scale: isDark ? 0.92 : 1,
              rotate: isDark ? 180 : 0,
            }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className={cn(
              'h-3 w-3 rounded-full transition-shadow duration-300',
              isDark
                ? 'bg-gradient-to-tr from-rose-500 via-amber-300 to-rose-300 shadow-[0_0_10px_rgba(251,191,36,0.95)]'
                : 'bg-gradient-to-tr from-amber-500 via-amber-400 to-yellow-200 shadow-[0_0_10px_rgba(245,158,11,0.85)]'
            )}
          />

          {/* Sliding Velvet Lunar Occultation Disc (Creates Real Solar Eclipse Corona Ring in Dark Mode) */}
          <motion.span
            initial={false}
            animate={{
              x: isDark ? 1.5 : 11,
              y: isDark ? -1.5 : -11,
              scale: isDark ? 1 : 0.25,
              opacity: isDark ? 1 : 0,
            }}
            transition={{
              type: 'spring',
              stiffness: 340,
              damping: 24,
            }}
            className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-[#12060D] shadow-[inset_0_0_3px_rgba(244,63,94,0.6)]"
          />
        </div>
      </motion.span>
    </motion.button>
  );
}
