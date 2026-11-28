'use client';

import * as React from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  Crown,
  EyeOff,
  Flame,
  Gem,
  Heart,
  Lock,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  FLOATING_ADULT_STICKER_NODES,
  computeStickerParallaxOffset,
  normalizePointerCoordinates,
  type FloatingAdultStickerNode,
} from '@/lib/adult-sticker-parallax';
import { cn } from '@/lib/utils';

export type AdultStickerKind =
  | '18-plus'
  | 'xxx-uncensored'
  | 'hot-vip'
  | 'adults-only'
  | 'rta-verified'
  | 'private-4k';

export interface AdultStickerSpec {
  id: AdultStickerKind;
  code: string;
  label: string;
  sublabel: string;
  tiltDeg: number;
  tone: 'crimson' | 'amber' | 'rose-gold' | 'obsidian';
}

export const ADULT_STICKER_SPECS: Record<AdultStickerKind, AdultStickerSpec> = {
  '18-plus': {
    id: '18-plus',
    code: '18+',
    label: 'ADULTS ONLY',
    sublabel: 'Explicit Content',
    tiltDeg: -3,
    tone: 'crimson',
  },
  'xxx-uncensored': {
    id: 'xxx-uncensored',
    code: 'XXX',
    label: 'UNCENSORED',
    sublabel: 'Raw 4K Vault',
    tiltDeg: 2.5,
    tone: 'rose-gold',
  },
  'hot-vip': {
    id: 'hot-vip',
    code: 'HOT',
    label: 'VIP EXCLUSIVE',
    sublabel: 'After Dark',
    tiltDeg: -2,
    tone: 'amber',
  },
  'adults-only': {
    id: 'adults-only',
    code: 'NSFW',
    label: '18+ RESTRICTED',
    sublabel: 'Verified Mature',
    tiltDeg: 3,
    tone: 'crimson',
  },
  'rta-verified': {
    id: 'rta-verified',
    code: 'RTA',
    label: 'AGE VERIFIED',
    sublabel: 'Restricted To Adults',
    tiltDeg: -1.5,
    tone: 'obsidian',
  },
  'private-4k': {
    id: 'private-4k',
    code: '60FPS',
    label: 'ULTRA HD',
    sublabel: 'Discreet Stream',
    tiltDeg: 2,
    tone: 'amber',
  },
};

export function getAdultStickerSpec(kind: AdultStickerKind): AdultStickerSpec {
  return ADULT_STICKER_SPECS[kind];
}

function renderStickerIcon(kind: AdultStickerKind) {
  const iconClass = 'h-2.5 w-2.5 shrink-0';
  switch (kind) {
    case '18-plus':
      return <Flame className={iconClass} aria-hidden="true" />;
    case 'xxx-uncensored':
      return <Sparkles className={iconClass} aria-hidden="true" />;
    case 'hot-vip':
      return <Crown className={iconClass} aria-hidden="true" />;
    case 'adults-only':
      return <ShieldAlert className={iconClass} aria-hidden="true" />;
    case 'rta-verified':
      return <Lock className={iconClass} aria-hidden="true" />;
    case 'private-4k':
      return <Zap className={iconClass} aria-hidden="true" />;
  }
}

interface AdultStickerStampProps {
  kind: AdultStickerKind;
  size?: 'xs' | 'sm' | 'md';
  tilted?: boolean;
  interactive?: boolean;
  className?: string;
}

/**
 * High-fashion Neon / Die-Cut 18+ Stamp & Sticker badge with tactile Framer
 * Motion spring physics.
 */
export function AdultStickerStamp({
  kind,
  size = 'sm',
  tilted = false,
  interactive = true,
  className,
}: AdultStickerStampProps) {
  const spec = getAdultStickerSpec(kind);

  const toneClasses =
    spec.tone === 'crimson'
      ? 'border-rose-500/60 bg-gradient-to-r from-rose-950/90 via-[#200912]/90 to-rose-900/80 text-rose-100 shadow-[0_0_1rem_rgba(225,29,72,0.3)]'
      : spec.tone === 'amber'
        ? 'border-amber-400/60 bg-gradient-to-r from-amber-950/90 via-[#1F1408]/90 to-amber-900/80 text-amber-100 shadow-[0_0_1rem_rgba(245,158,11,0.26)]'
        : spec.tone === 'rose-gold'
          ? 'border-rose-400/60 bg-gradient-to-r from-rose-950/90 via-amber-950/85 to-rose-900/85 text-amber-100 shadow-[0_0_1.1rem_rgba(244,63,94,0.32)]'
          : 'border-white/25 bg-zinc-950/90 text-zinc-100 shadow-[0_0_0.85rem_rgba(0,0,0,0.45)]';

  const codePillClasses =
    spec.tone === 'crimson'
      ? 'bg-rose-600 text-white'
      : spec.tone === 'amber'
        ? 'bg-amber-500 text-zinc-950'
        : spec.tone === 'rose-gold'
          ? 'bg-gradient-to-r from-rose-500 to-amber-500 text-white'
          : 'bg-white/15 text-amber-300';

  return (
    <motion.span
      data-testid={`adult-sticker-${kind}`}
      initial={false}
      animate={{ rotate: tilted ? spec.tiltDeg : 0 }}
      whileHover={
        interactive
          ? {
              scale: 1.07,
              rotate: tilted ? -spec.tiltDeg * 0.8 : -2,
              y: -1.5,
            }
          : undefined
      }
      whileTap={interactive ? { scale: 0.93 } : undefined}
      transition={{ type: 'spring', stiffness: 430, damping: 20 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border select-none backdrop-blur-md',
        size === 'xs' && 'px-1.5 py-0.5 text-[0.625rem]',
        size === 'sm' && 'px-2 py-1 text-[0.6875rem]',
        size === 'md' && 'px-2.5 py-1.5 text-xs',
        toneClasses,
        interactive && 'cursor-pointer',
        className
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded px-1.25 py-0.25 font-mono font-extrabold tracking-wider uppercase leading-none',
          size === 'xs' ? 'text-[0.5625rem]' : 'text-[0.625rem]',
          codePillClasses
        )}
      >
        {renderStickerIcon(kind)}
        <span>{spec.code}</span>
      </span>

      <span className="font-display font-bold tracking-wide uppercase leading-none whitespace-nowrap">
        {spec.label}
      </span>
    </motion.span>
  );
}

/**
 * Interactive 18+ Neon Sticker & Symbol Strip for the Homepage Hero, Sidebar,
 * and Age Verification Gate.
 */
export function AdultStickerCluster({
  variant = 'hero',
  className,
}: {
  variant?: 'hero' | 'compact' | 'gate';
  className?: string;
}) {
  const kinds: AdultStickerKind[] =
    variant === 'compact'
      ? ['18-plus', 'xxx-uncensored', 'hot-vip']
      : variant === 'gate'
        ? ['18-plus', 'xxx-uncensored', 'adults-only', 'rta-verified']
        : ['18-plus', 'xxx-uncensored', 'hot-vip', 'adults-only', 'private-4k'];

  return (
    <div
      data-testid={`adult-sticker-cluster-${variant}`}
      aria-label="18+ adult content symbols and stickers"
      className={cn(
        'flex flex-wrap items-center justify-center gap-2',
        className
      )}
    >
      {kinds.map((kind) => (
        <AdultStickerStamp
          key={kind}
          kind={kind}
          size={variant === 'compact' ? 'xs' : 'sm'}
          tilted={variant !== 'compact'}
        />
      ))}
    </div>
  );
}

/**
 * Floating 18+ Neon Watermark Seal for Hero Spotlights & Empty Vault Cards.
 */
export function AdultNeonWatermarkSeal({
  className,
}: {
  className?: string;
}) {
  return (
    <motion.div
      data-testid="adult-neon-watermark-seal"
      initial={false}
      animate={{ rotate: -6, scale: 1 }}
      whileHover={{ scale: 1.08, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
      className={cn(
        'inline-flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-rose-500/60 bg-gradient-to-br from-rose-950/95 via-[#150810]/95 to-amber-950/90 px-3.5 py-2 text-center shadow-[0_0_1.5rem_rgba(225,29,72,0.34)] select-none',
        className
      )}
    >
      <div className="flex items-center gap-1 text-[0.625rem] font-mono font-bold uppercase tracking-[0.18em] text-amber-300">
        <Heart className="h-2.5 w-2.5 fill-rose-500 text-rose-500" aria-hidden="true" />
        <span>UNCENSORED</span>
        <Gem className="h-2.5 w-2.5 text-amber-300" aria-hidden="true" />
      </div>
      <div className="mt-0.5 font-display text-lg sm:text-xl font-black tracking-tight text-white leading-none">
        18<span className="text-rose-500">+</span> XXX
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[0.5625rem] font-semibold uppercase tracking-widest text-rose-300/90">
        <EyeOff className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
        <span>Adults Only</span>
      </div>
    </motion.div>
  );
}

function FloatingStickerOrbNode({
  node,
  springX,
  springY,
}: {
  node: FloatingAdultStickerNode;
  springX: MotionValue<number>;
  springY: MotionValue<number>;
}) {
  const [boosted, setBoosted] = React.useState(false);
  const spec = getAdultStickerSpec(node.kind);

  const x = useTransform([springX, springY], (values: number[]) => {
    const [nx = 0, ny = 0] = values;
    return computeStickerParallaxOffset(node, nx, ny).xPx;
  });

  const y = useTransform([springX, springY], (values: number[]) => {
    const [nx = 0, ny = 0] = values;
    return computeStickerParallaxOffset(node, nx, ny).yPx;
  });

  const rotate = useTransform([springX, springY], (values: number[]) => {
    const [nx = 0, ny = 0] = values;
    return computeStickerParallaxOffset(node, nx, ny).rotateDeg;
  });

  const tierVisibilityClass =
    node.tier === 'desktop-only'
      ? 'hidden xl:inline-flex'
      : node.tier === 'tablet-up'
        ? 'hidden md:inline-flex'
        : 'inline-flex';

  const toneBorderClass =
    spec.tone === 'crimson'
      ? 'border-rose-500/45 bg-gradient-to-br from-rose-950/92 via-[#180710]/95 to-rose-900/90 text-rose-100 shadow-[0_0_1.15rem_rgba(225,29,72,0.22)]'
      : spec.tone === 'amber'
        ? 'border-amber-400/45 bg-gradient-to-br from-amber-950/92 via-[#1B1208]/95 to-amber-900/90 text-amber-100 shadow-[0_0_1.15rem_rgba(245,158,11,0.2)]'
        : spec.tone === 'rose-gold'
          ? 'border-rose-400/50 bg-gradient-to-br from-rose-950/92 via-amber-950/92 to-rose-900/90 text-amber-100 shadow-[0_0_1.2rem_rgba(244,63,94,0.24)]'
          : 'border-white/20 bg-zinc-950/92 text-zinc-100 shadow-[0_0_1rem_rgba(0,0,0,0.35)]';

  return (
    <motion.div
      data-testid={`floating-adult-sticker-${node.id}`}
      data-sticker-kind={node.kind}
      style={{
        top: `${node.topPct}%`,
        left: `${node.leftPct}%`,
        x,
        y,
        rotate,
      }}
      className={cn(
        'fixed -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-20 select-none will-change-transform',
        tierVisibilityClass
      )}
    >
      <motion.button
        type="button"
        aria-label={`${node.symbol} ${node.caption} interactive adult sticker`}
        onClick={() => setBoosted((prev) => !prev)}
        animate={{
          scale: boosted ? 1.12 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 420,
          damping: 20,
        }}
        whileHover={{
          scale: 1.16,
          rotate: 0,
        }}
        whileTap={{
          scale: 0.9,
        }}
        className={cn(
          'group relative inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 text-[0.625rem] opacity-65 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 cursor-pointer',
          toneBorderClass,
          boosted &&
            'opacity-100 ring-2 ring-rose-500/70 shadow-[0_0_1.5rem_rgba(225,29,72,0.45)]'
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded-md px-1.25 py-0.25 font-mono text-[0.5625rem] font-black uppercase tracking-wider leading-none',
            spec.tone === 'amber'
              ? 'bg-amber-400 text-zinc-950'
              : 'bg-rose-600 text-white'
          )}
        >
          {renderStickerIcon(node.kind)}
          <span>{node.symbol}</span>
        </span>
        <span className="font-display text-[0.625rem] font-bold uppercase tracking-wider whitespace-nowrap">
          {node.caption}
        </span>
      </motion.button>
    </motion.div>
  );
}

/**
 * Site-wide floating layer of adult-themed interactive stickers and symbols
 * that respond to mouse movement with spring-damped parallax using Framer Motion.
 */
export function AdultFloatingStickersLayer({
  hidden = false,
  className,
}: {
  hidden?: boolean;
  className?: string;
}) {
  const rawPointerX = useMotionValue(0);
  const rawPointerY = useMotionValue(0);

  const springX = useSpring(rawPointerX, {
    stiffness: 115,
    damping: 24,
    mass: 0.65,
  });
  const springY = useSpring(rawPointerY, {
    stiffness: 115,
    damping: 24,
    mass: 0.65,
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const handlePointerMove = (e: PointerEvent | MouseEvent) => {
      const { nx, ny } = normalizePointerCoordinates(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight
      );
      rawPointerX.set(nx);
      rawPointerY.set(ny);
    };

    const handlePointerLeave = () => {
      rawPointerX.set(0);
      rawPointerY.set(0);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('mouseleave', handlePointerLeave, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mouseleave', handlePointerLeave);
    };
  }, [hidden, rawPointerX, rawPointerY]);

  if (hidden) return null;

  return (
    <div
      data-testid="adult-floating-stickers-layer"
      aria-label="Interactive 18+ floating stickers layer"
      className={cn(
        'fixed inset-0 pointer-events-none z-20 overflow-hidden select-none',
        className
      )}
    >
      {FLOATING_ADULT_STICKER_NODES.map((node) => (
        <FloatingStickerOrbNode
          key={node.id}
          node={node}
          springX={springX}
          springY={springY}
        />
      ))}
    </div>
  );
}

