import React, { useEffect, useRef } from 'react';
import { drawAnimatedRigScene } from '../lib/animatedRigRenderer';
import type { AnimatedRigSpec, VideoStylePresetId } from '../types/cineforge';

interface AnimatedRigCanvasProps {
  spec: AnimatedRigSpec;
  presetId?: VideoStylePresetId;
  className?: string;
  loopDurationMs?: number;
  paused?: boolean;
  width?: number;
  height?: number;
}

export const AnimatedRigCanvas: React.FC<AnimatedRigCanvasProps> = ({
  spec,
  presetId = 'historically',
  className = 'w-full h-full object-cover',
  loopDurationMs = 3600,
  paused = false,
  width = 640,
  height = 360,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleRef = useRef<boolean>(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          visibleRef.current = entries.some((e) => e.isIntersecting);
        },
        { threshold: 0.05 }
      );
      observer.observe(canvas);
    }

    let rafId = 0;
    let lastDraw = 0;
    const startTs = performance.now();
    const frameIntervalMs = 1000 / 30; // Smooth 30 FPS live preview

    const renderFrame = (now: number) => {
      if (paused || prefersReducedMotion) {
        drawAnimatedRigScene(ctx, spec, presetId, width, height, 0.55, 1800);
        return;
      }

      if (visibleRef.current && now - lastDraw >= frameIntervalMs) {
        lastDraw = now;
        const elapsed = now - startTs;
        const localProgress = (elapsed % loopDurationMs) / loopDurationMs;
        drawAnimatedRigScene(ctx, spec, presetId, width, height, localProgress, elapsed);
      }
      rafId = requestAnimationFrame(renderFrame);
    };

    // Immediate first frame draw
    drawAnimatedRigScene(ctx, spec, presetId, width, height, 0.35, 1200);
    if (!paused && !prefersReducedMotion) {
      rafId = requestAnimationFrame(renderFrame);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
    };
  }, [spec, presetId, loopDurationMs, paused, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      aria-label={spec.sceneTitle || 'Animated scene rig preview'}
    />
  );
};
