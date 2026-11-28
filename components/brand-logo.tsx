'use client';

import * as React from 'react';
import {
  computeBustKinematics,
  generateOrbParticles,
  projectOrbParticles,
} from '@/lib/particle-orb';
import { cn } from '@/lib/utils';

type OrbVariant = 'header' | 'compact' | 'modal' | 'hero';

interface ParticleOrbCrestProps {
  variant?: OrbVariant;
  className?: string;
}

const ORB_CONFIG: Record<
  OrbVariant,
  {
    pxSize: number;
    particleCount: number;
    speed: number;
    frameClass: string;
  }
> = {
  compact: {
    pxSize: 36,
    particleCount: 28,
    speed: 1.05,
    frameClass: 'h-[2.25rem] w-[2.25rem] rounded-full',
  },
  header: {
    pxSize: 44,
    particleCount: 38,
    speed: 1.1,
    frameClass: 'h-[2.75rem] w-[2.75rem] rounded-full',
  },
  modal: {
    pxSize: 56,
    particleCount: 48,
    speed: 1.0,
    frameClass: 'h-[3.5rem] w-[3.5rem] rounded-full',
  },
  hero: {
    pxSize: 156,
    particleCount: 92,
    speed: 0.92,
    frameClass:
      'h-[clamp(7rem,11.5vw,9.75rem)] w-[clamp(7rem,11.5vw,9.75rem)] rounded-full',
  },
};

const COVERED_EMBLEM_ASSET_SRC =
  '/assets/aistudio/Screenshot_2026_1128_101518_253ade0e.png';

/**
 * Draws a tiny glowing vector heart accent on the 2D canvas for high-engagement
 * cabaret / boudoir glamour.
 */
function drawCanvasHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const topCurveHeight = size * 0.32;
  ctx.moveTo(0, topCurveHeight);
  ctx.bezierCurveTo(0, 0, -size * 0.55, 0, -size * 0.55, topCurveHeight);
  ctx.bezierCurveTo(
    -size * 0.55,
    (size + topCurveHeight) * 0.52,
    0,
    (size + topCurveHeight) * 0.78,
    0,
    size
  );
  ctx.bezierCurveTo(
    0,
    (size + topCurveHeight) * 0.78,
    size * 0.55,
    (size + topCurveHeight) * 0.52,
    size * 0.55,
    topCurveHeight
  );
  ctx.bezierCurveTo(size * 0.55, 0, 0, 0, 0, topCurveHeight);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Animated 3D High-Glamour Sweetheart Corset & Neon Cabaret Emblem Crest.
 * Combines the attached anime corset portrait with sculpted satin-corset
 * sweetheart contours, glossy specular highlights, spring-harmonic bounce
 * physics, orbiting neon heart sparks, and interactive hover/tap impulse.
 */
export function ParticleOrbCrest({
  variant = 'header',
  className,
}: ParticleOrbCrestProps) {
  const cfg = ORB_CONFIG[variant];
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const hoveredRef = React.useRef(false);
  const impulseRef = React.useRef(0);
  const wakeLoopRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = cfg.pxSize;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const particles = generateOrbParticles(cfg.particleCount);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let artworkImg: HTMLImageElement | null = null;
    let artworkLoaded = false;
    let rafId = 0;
    let isRunning = false;
    let activeUntil = performance.now() + 2600;
    let angleY = 0.65;
    let elapsed = 0;
    let lastTimestamp = performance.now();

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = COVERED_EMBLEM_ASSET_SRC;
    img.onload = () => {
      artworkImg = img;
      artworkLoaded = true;
      drawFrame();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const boost = hoveredRef.current ? 1.85 : 1.18;
      const impulse = impulseRef.current;

      // 1. Rich velvet cabaret neon aura (hot magenta, crimson, and royal violet)
      const bgGlow = ctx.createRadialGradient(
        cx,
        cy * 0.92,
        size * 0.04,
        cx,
        cy,
        size * 0.56
      );
      bgGlow.addColorStop(0, 'rgba(244, 63, 94, 0.52)');
      bgGlow.addColorStop(0.42, 'rgba(192, 38, 211, 0.36)');
      bgGlow.addColorStop(0.78, 'rgba(20, 8, 26, 0.95)');
      bgGlow.addColorStop(1, 'rgba(9, 5, 14, 1)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, size, size);

      // 2. Live Spring-Harmonic Bounce Kinematics
      const kin = computeBustKinematics({
        time: elapsed,
        boost,
        impulse,
      });

      const baseR = size * 0.225;
      const leftCx =
        cx - size * 0.168 + kin.leftOffsetX * size * 0.42;
      const leftCy =
        cy + size * 0.055 + kin.leftOffsetY * size * 0.48;
      const rightCx =
        cx + size * 0.168 + kin.rightOffsetX * size * 0.42;
      const rightCy =
        cy + size * 0.055 + kin.rightOffsetY * size * 0.48;

      const leftRx = baseR * kin.leftScaleX;
      const leftRy = baseR * 1.08 * kin.leftScaleY;
      const rightRx = baseR * kin.rightScaleX;
      const rightRy = baseR * 1.08 * kin.rightScaleY;

      // 2a. Render animated high-clarity crop of the attached corset artwork
      if (artworkLoaded && artworkImg && artworkImg.naturalWidth > 0) {
        ctx.save();
        const avgBounceY = (kin.leftOffsetY + kin.rightOffsetY) * 0.5;
        const avgSwayX = (kin.leftOffsetX - kin.rightOffsetX) * 0.38;
        const dynamicScaleX =
          1.12 + (kin.leftScaleX + kin.rightScaleX - 2) * 0.35;
        const dynamicScaleY =
          1.12 + (kin.leftScaleY + kin.rightScaleY - 2) * 0.35;

        ctx.translate(cx + avgSwayX * size * 0.32, cy + avgBounceY * size * 0.42);
        ctx.rotate(kin.tiltAngle * 0.65);
        ctx.scale(dynamicScaleX, dynamicScaleY);

        const sw = artworkImg.naturalWidth;
        const sh = artworkImg.naturalHeight;
        const cropSize = Math.min(sw, sh) * 0.84;
        const sx = sw * 0.535 - cropSize * 0.5;
        const sy = sh * 0.53 - cropSize * 0.5;

        ctx.globalAlpha = 0.88;
        ctx.drawImage(
          artworkImg,
          Math.max(0, sx),
          Math.max(0, sy),
          cropSize,
          cropSize,
          -size * 0.5,
          -size * 0.5,
          size,
          size
        );
        ctx.restore();
      }

      // 2b. Sculpted 3D Satin-Corset Sweetheart Curves & Glossy Specular Highlights
      const drawGlamourCorsetCup = (
        lobeX: number,
        lobeY: number,
        rx: number,
        ry: number,
        isLeft: boolean
      ) => {
        ctx.save();
        ctx.translate(lobeX, lobeY);
        ctx.rotate(kin.tiltAngle * (isLeft ? 1 : -1));

        // Warm Silky Upper Glow above the sweetheart neckline
        const upperGrad = ctx.createRadialGradient(
          isLeft ? -rx * 0.2 : rx * 0.2,
          -ry * 0.26,
          rx * 0.05,
          0,
          0,
          Math.max(rx, ry) * 1.06
        );
        upperGrad.addColorStop(0, 'rgba(255, 241, 242, 0.72)');
        upperGrad.addColorStop(0.38, 'rgba(251, 113, 133, 0.56)');
        upperGrad.addColorStop(0.75, 'rgba(217, 70, 239, 0.38)');
        upperGrad.addColorStop(1, 'rgba(88, 28, 135, 0.12)');

        ctx.fillStyle = upperGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        // Glossy Specular Highlight Crescent on upper swell
        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.beginPath();
        ctx.ellipse(
          isLeft ? -rx * 0.22 : rx * 0.22,
          -ry * 0.28,
          rx * 0.34,
          ry * 0.16,
          isLeft ? -0.35 : 0.35,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Fitted Sweetheart Mini-Corset Cup Overlay (lower curve)
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
        ctx.clip();

        const corsetGrad = ctx.createLinearGradient(0, -ry * 0.1, 0, ry * 1.05);
        corsetGrad.addColorStop(0, 'rgba(255, 241, 242, 0.86)');
        corsetGrad.addColorStop(0.35, 'rgba(244, 114, 182, 0.82)');
        corsetGrad.addColorStop(0.72, 'rgba(168, 85, 247, 0.88)');
        corsetGrad.addColorStop(1, 'rgba(88, 28, 135, 0.94)');

        ctx.fillStyle = corsetGrad;
        ctx.beginPath();
        ctx.moveTo(-rx * 1.15, -ry * 0.04);
        ctx.quadraticCurveTo(
          isLeft ? rx * 0.16 : -rx * 0.16,
          ry * 0.26,
          rx * 1.15,
          -ry * 0.04
        );
        ctx.lineTo(rx * 1.15, ry * 1.2);
        ctx.lineTo(-rx * 1.15, ry * 1.2);
        ctx.closePath();
        ctx.fill();

        // Neon Rose-Gold Lace Trim along the sweetheart corset plunge
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.96)';
        ctx.lineWidth = Math.max(1.25, size * 0.036);
        ctx.beginPath();
        ctx.moveTo(-rx * 1.05, -ry * 0.02);
        ctx.quadraticCurveTo(
          isLeft ? rx * 0.14 : -rx * 0.14,
          ry * 0.24,
          rx * 1.05,
          -ry * 0.02
        );
        ctx.stroke();
        ctx.restore();

        // Luminous Under-Cup Gold & Hot-Rose Push-Up Contour Arc
        ctx.strokeStyle = 'rgba(251, 113, 133, 0.9)';
        ctx.lineWidth = Math.max(1.2, size * 0.034);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          rx * 0.99,
          ry * 0.99,
          0,
          0.08 * Math.PI,
          0.92 * Math.PI
        );
        ctx.stroke();

        // Sapphire-Rose & Gold Corset Ribbon Pin on right strap
        if (!isLeft) {
          const roseX = rx * 0.56;
          const roseY = -ry * 0.04;
          const roseR = Math.max(1.9, size * 0.056);
          const roseGrad = ctx.createRadialGradient(
            roseX,
            roseY,
            0,
            roseX,
            roseY,
            roseR * 1.65
          );
          roseGrad.addColorStop(0, 'rgba(191, 219, 254, 1)');
          roseGrad.addColorStop(0.55, 'rgba(59, 130, 246, 0.96)');
          roseGrad.addColorStop(1, 'rgba(30, 58, 138, 0.92)');
          ctx.fillStyle = roseGrad;
          ctx.beginPath();
          ctx.arc(roseX, roseY, roseR * 1.35, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      };

      drawGlamourCorsetCup(leftCx, leftCy, leftRx, leftRy, true);
      drawGlamourCorsetCup(rightCx, rightCy, rightRx, rightRy, false);

      // 3. Central Sweetheart Plunge Shadow & Neon Golden-Rose Shimmer Line
      const cleavageTopY = Math.min(leftCy, rightCy) - baseR * 0.62;
      const cleavageBottomY = Math.max(leftCy, rightCy) + baseR * 0.78;
      const cleavageMidX = (leftCx + rightCx) * 0.5;

      const cleavageGrad = ctx.createLinearGradient(
        cleavageMidX,
        cleavageTopY,
        cleavageMidX,
        cleavageBottomY
      );
      cleavageGrad.addColorStop(0, 'rgba(244, 63, 94, 0.15)');
      cleavageGrad.addColorStop(
        0.48,
        `rgba(254, 240, 138, ${(0.72 + kin.cleavageGlow * 0.28).toFixed(2)})`
      );
      cleavageGrad.addColorStop(1, 'rgba(244, 63, 94, 0.35)');

      ctx.strokeStyle = cleavageGrad;
      ctx.lineWidth = Math.max(1.25, size * 0.034);
      ctx.beginPath();
      ctx.moveTo(cleavageMidX, cleavageTopY);
      ctx.quadraticCurveTo(
        cleavageMidX + Math.sin(elapsed * 5.6) * size * 0.018,
        (cleavageTopY + cleavageBottomY) * 0.5,
        cleavageMidX,
        cleavageBottomY
      );
      ctx.stroke();

      // 4. Floating Neon Heart Sparks that rise & pulse with the rhythm
      const heartSize = Math.max(3.2, size * 0.095);
      const heart1Y =
        cy - size * 0.24 + Math.sin(elapsed * 4.2) * size * 0.045;
      const heart2Y =
        cy - size * 0.2 + Math.cos(elapsed * 4.8 + 1.1) * size * 0.045;
      drawCanvasHeart(
        ctx,
        cx - size * 0.26,
        heart1Y,
        heartSize,
        '#FB7185',
        0.65 + 0.3 * Math.sin(elapsed * 4.2)
      );
      drawCanvasHeart(
        ctx,
        cx + size * 0.26,
        heart2Y,
        heartSize * 0.88,
        '#FDE047',
        0.6 + 0.3 * Math.cos(elapsed * 4.8)
      );

      // 5. Overlay 3D Projected Shimmering Constellation Particles
      const projected = projectOrbParticles(particles, {
        size,
        angleY,
        time: elapsed,
        boost,
        impulse,
      });

      for (let i = 0; i < projected.length; i += 1) {
        const pt = projected[i];
        ctx.globalAlpha = pt.alpha * 0.82;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.px, pt.py, pt.radius, 0, Math.PI * 2);
        ctx.fill();

        if (pt.glow && size >= 40) {
          ctx.globalAlpha = pt.alpha * 0.24;
          ctx.beginPath();
          ctx.arc(pt.px, pt.py, pt.radius * 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 6. Outer Neon Cabaret Rim Ring
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = hoveredRef.current
        ? 'rgba(253, 224, 71, 0.92)'
        : 'rgba(244, 63, 94, 0.68)';
      ctx.lineWidth = Math.max(1, size * 0.026);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.485, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
    };

    drawFrame();
    if (reducedMotion) {
      return;
    }

    let isVisible = true;
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          isVisible = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0.05 }
      );
      observer.observe(canvas);
    }

    const step = (now: number) => {
      if (!document.hidden && isVisible) {
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTimestamp) / 1000));
        const boost = hoveredRef.current ? 1.85 : 1.18;
        angleY += dt * cfg.speed * boost;
        elapsed += dt;
        if (impulseRef.current > 0.005) {
          impulseRef.current = Math.max(0, impulseRef.current * Math.exp(-dt * 3.5));
        } else {
          impulseRef.current = 0;
        }
        drawFrame();
      }
      lastTimestamp = now;

      const shouldContinue =
        hoveredRef.current ||
        impulseRef.current > 0.005 ||
        now < activeUntil;

      if (shouldContinue && isVisible && !document.hidden) {
        rafId = window.requestAnimationFrame(step);
      } else {
        isRunning = false;
      }
    };

    const wakeLoop = () => {
      if (reducedMotion) return;
      activeUntil = performance.now() + 2400;
      if (!isRunning) {
        isRunning = true;
        lastTimestamp = performance.now();
        rafId = window.requestAnimationFrame(step);
      }
    };

    wakeLoopRef.current = wakeLoop;
    isRunning = true;
    rafId = window.requestAnimationFrame(step);

    return () => {
      isRunning = false;
      wakeLoopRef.current = null;
      window.cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [cfg.particleCount, cfg.pxSize, cfg.speed]);

  const triggerJiggleImpulse = () => {
    impulseRef.current = 1.65;
    wakeLoopRef.current?.();
  };

  return (
    <span
      data-testid={`brand-orb-${variant}`}
      data-logo-style="twin-bust-twerk"
      onMouseEnter={() => {
        hoveredRef.current = true;
        triggerJiggleImpulse();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
      }}
      onPointerDown={triggerJiggleImpulse}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[#0D0612] border border-rose-500/75 shadow-[0_0_1.4rem_rgba(244,63,94,0.48),0_0_0.55rem_rgba(217,70,239,0.38),inset_0_0_0.75rem_rgba(251,191,36,0.28)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.1] group-hover:border-amber-300/95',
        cfg.frameClass,
        className
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="h-full w-full block"
      />
    </span>
  );
}

interface BrandLogoProps {
  variant?: 'header' | 'drawer' | 'footer' | 'studio' | 'studio-sidebar';
  showWordmarkOnMobile?: boolean;
  className?: string;
}

/**
 * Hey Lady Luxury Brand Lockup — animated 3D sweetheart-corset & neon cabaret
 * crest paired with crisp single-line luxury typography and live pulse accent.
 */
export function BrandLogo({
  variant = 'header',
  showWordmarkOnMobile = false,
  className,
}: BrandLogoProps) {
  const isStudio = variant === 'studio' || variant === 'studio-sidebar';
  const orbVariant: OrbVariant =
    variant === 'studio-sidebar' || variant === 'footer' ? 'compact' : 'header';

  return (
    <span
      data-testid={`brand-logo-${variant}`}
      className={cn(
        'inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none',
        className
      )}
    >
      <ParticleOrbCrest variant={orbVariant} />

      <span
        className={cn(
          'inline-flex items-baseline gap-1.5 leading-none',
          !showWordmarkOnMobile && variant === 'header' && 'hidden sm:inline-flex'
        )}
      >
        <span
          className={cn(
            'font-display font-bold tracking-[-0.02em] leading-none',
            variant === 'studio-sidebar'
              ? 'text-[0.9375rem] text-white'
              : variant === 'footer'
                ? 'text-base text-zinc-950 dark:text-white'
                : isStudio
                  ? 'text-[1.125rem] text-white'
                  : 'text-[1.25rem] text-zinc-950 dark:text-white'
          )}
        >
          Hey{' '}
          <span className="bg-gradient-to-r from-rose-500 via-fuchsia-400 to-amber-300 dark:from-rose-400 dark:via-fuchsia-300 dark:to-amber-200 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(244,63,94,0.35)]">
            Lady
          </span>
        </span>
      </span>
    </span>
  );
}
