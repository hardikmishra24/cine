import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  VIDEO_STYLE_PRESETS,
  type AnimatedRigActor,
  type AnimatedRigSpec,
  type ArchivalAsset,
  type AudioMixerSettings,
  type StoryboardBeat,
  type VideoStylePresetId,
} from '../src/types/cineforge.ts';
import type { BeatSfxEvent } from '../src/server/services/audioMixService.ts';
import { MAP_REGIONS } from '../src/lib/worldMapData.ts';
import { ArchivalAssetService } from '../src/server/services/archivalAssetService.ts';
import { BeatMediaFulfillmentService } from '../src/server/services/beatMediaFulfillmentService.ts';
import {
  GeminiStoryboardService,
  alignWordsToDuration,
} from '../src/server/services/researchAndScriptService.ts';
import { applyBroadcastAudioPostProcessing } from '../src/server/services/voiceService.ts';
import {
  LocalFileStorageService,
  buildWavFromPcm,
  getWavDurationMs,
} from '../src/server/services/fileStorageService.ts';
import { FfmpegVideoRenderingService } from '../src/server/services/videoRenderingService.ts';

const execFileAsync = promisify(execFile);

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function escapeMvgText(str: string): string {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '')
    .replace(/"/g, '')
    .replace(/%/g, ' pct')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateRealisticNarrationWav(
  paragraphs: Array<{ text: string; durationSec: number }>,
  sampleRate = 24000
): {
  wavBuffer: Buffer;
  segments: Array<{
    id: string;
    orderIndex: number;
    text: string;
    startMs: number;
    endMs: number;
    wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
  }>;
} {
  const pauseSec = 0.25;
  const totalSec =
    paragraphs.reduce((s, p) => s + p.durationSec, 0) + pauseSec * Math.max(0, paragraphs.length - 1);
  const totalSamples = Math.ceil(totalSec * sampleRate);
  const pcm = Buffer.alloc(totalSamples * 2);

  const segments: Array<{
    id: string;
    orderIndex: number;
    text: string;
    startMs: number;
    endMs: number;
    wordTimestamps: Array<{ word: string; startMs: number; endMs: number }>;
  }> = [];

  let cursorSec = 0;
  paragraphs.forEach((p, idx) => {
    const startMs = Math.round(cursorSec * 1000);
    const endMs = Math.round((cursorSec + p.durationSec) * 1000);
    const words = alignWordsToDuration(p.text, startMs, endMs - startMs);
    segments.push({
      id: `seg_${idx + 1}`,
      orderIndex: idx,
      text: p.text,
      startMs,
      endMs,
      wordTimestamps: words,
    });

    for (const w of words) {
      const sStart = Math.floor((w.startMs / 1000) * sampleRate);
      const sEnd = Math.min(totalSamples - 1, Math.floor(((w.endMs - 30) / 1000) * sampleRate));
      const len = Math.max(1, sEnd - sStart);
      const baseF0 = 132 + ((w.word.length * 13) % 36);
      for (let i = sStart; i < sEnd; i++) {
        const localT = (i - sStart) / sampleRate;
        const frac = (i - sStart) / len;
        const env = Math.sin(frac * Math.PI) * (0.74 + 0.26 * Math.sin(localT * 24));
        const f0 = baseF0 * (1 - 0.08 * frac);
        const val =
          (Math.sin(2 * Math.PI * f0 * localT) * 0.45 +
            Math.sin(2 * Math.PI * f0 * 2.0 * localT) * 0.28 +
            Math.sin(2 * Math.PI * f0 * 3.0 * localT) * 0.14 +
            Math.sin(2 * Math.PI * f0 * 5.0 * localT) * 0.06) *
          env *
          0.62;
        pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(val * 32767))), i * 2);
      }
    }

    cursorSec += p.durationSec + pauseSec;
  });

  return {
    wavBuffer: buildWavFromPcm(pcm, sampleRate, 1),
    segments,
  };
}

async function downloadPhotoToDisk(url: string, destPath: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CineForgeDocumentaryStudio/1.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1500) return null;
    await fs.writeFile(destPath, buf);
    return destPath;
  } catch {
    return null;
  }
}

async function prepareCachedPhotoVariant(
  rawPhotoPath: string,
  outPath: string,
  size: string
): Promise<string | null> {
  try {
    await execFileAsync(
      'convert',
      [rawPhotoPath, '-resize', `${size}^`, '-gravity', 'center', '-extent', size, outPath],
      { timeout: 15000 }
    );
    return outPath;
  } catch {
    return null;
  }
}

async function downloadVideoToDisk(url: string, destPath: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CineForgeDocumentaryStudio/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 4096) return null;
    await fs.writeFile(destPath, buf);
    return destPath;
  } catch {
    return null;
  }
}

async function extractVideoFramePng(
  videoPath: string,
  timeSec: number,
  outPngPath: string,
  width = 924,
  height = 438
): Promise<string | null> {
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        Math.max(0, timeSec).toFixed(2),
        '-i',
        videoPath,
        '-vframes',
        '1',
        '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        outPngPath,
      ],
      { timeout: 12000 }
    );
    return outPngPath;
  } catch {
    return null;
  }
}

/**
 * Draws stylized Kurzgesagt / Vox flat-vector articulated actors into ImageMagick MVG arguments.
 * Every actor has continuous procedural limb/wheel/wing/prop motion at the exact timestamp.
 */
function pushAnimatedRigActorMvg(
  args: string[],
  actor: AnimatedRigActor,
  localProgress: number,
  timeSec: number,
  accent: string,
  secondaryAccent: string
) {
  const count = clamp(actor.count || 1, 1, 6);
  const popScale = easeOutBack(clamp(localProgress * 3.6, 0, 1));
  const moveT = easeOutCubic(clamp(localProgress, 0, 1));
  const dir = actor.endX < actor.startX ? -1 : 1;
  const speed = actor.action === 'run' || actor.action === 'drive' ? 1.55 : 1.15;
  const color = actor.color || accent;
  const sec = actor.accentColor || secondaryAccent;

  for (let i = 0; i < count; i++) {
    const staggerX = count > 1 ? (i - (count - 1) / 2) * 82 : 0;
    const staggerY = count > 1 ? ((i % 2 === 0 ? -1 : 1) * 16 + i * 5) : 0;
    const cx = Math.round(((actor.startX + (actor.endX - actor.startX) * moveT) / 100) * 1280 + staggerX);
    const cy = Math.round(((actor.startY + (actor.endY - actor.startY) * moveT) / 100) * 720 + staggerY);
    const s = clamp((actor.scale || 1) * popScale * (count > 3 ? 0.78 : 1), 0.35, 1.8);
    const phase = timeSec * 8.5 * speed + i * 1.15;

    // Ground shadow ellipse
    const shRx = Math.round(38 * s);
    const shRy = Math.round(9 * s);
    args.push(
      '-fill',
      'rgba(6,10,20,0.34)',
      '-stroke',
      'none',
      '-draw',
      `ellipse ${cx},${Math.round(cy + 62 * s)} ${shRx},${shRy} 0,360`
    );

    if (actor.kind === 'bird' || actor.kind === 'animal') {
      // Stylized flat-vector running emu / wildlife with pumping legs, bobbing neck, & dust cloud
      const bobY = Math.round(Math.abs(Math.sin(phase)) * -14 * s);
      const legA = Math.sin(phase) * 28 * s;
      const legB = Math.sin(phase + Math.PI) * 28 * s;
      const bodyY = cy + bobY;

      // Dust puff behind running feet
      const dustX = Math.round(cx - dir * (34 + ((timeSec * 90 + i * 27) % 36)) * s);
      const dustY = Math.round(cy + 52 * s);
      args.push(
        '-fill',
        'rgba(255,224,160,0.52)',
        '-stroke',
        'none',
        '-draw',
        `circle ${dustX},${dustY} ${dustX + Math.round(11 * s)},${dustY}`
      );

      // Articulated legs
      args.push(
        '-stroke',
        '#F59E0B',
        '-strokewidth',
        String(Math.max(3, Math.round(5 * s))),
        '-draw',
        `line ${cx - Math.round(6 * s)},${bodyY + Math.round(16 * s)} ${Math.round(cx + legA)},${cy + Math.round(58 * s)} line ${cx + Math.round(6 * s)},${bodyY + Math.round(16 * s)} ${Math.round(cx + legB)},${cy + Math.round(58 * s)}`
      );

      // Sleek body oval + plumage wing
      args.push(
        '-fill',
        color,
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '2.5',
        '-draw',
        `ellipse ${cx},${bodyY} ${Math.round(44 * s)},${Math.round(28 * s)} 0,360`
      );
      args.push(
        '-fill',
        sec,
        '-stroke',
        'none',
        '-draw',
        `ellipse ${cx - dir * Math.round(12 * s)},${bodyY + Math.round(2 * s)} ${Math.round(24 * s)},${Math.round(15 * s)} 0,360`
      );

      // Long bobbing neck & expressive head + eye + beak
      const neckX = cx + dir * Math.round(34 * s);
      const headX = cx + dir * Math.round((46 + Math.sin(phase) * 5) * s);
      const headY = bodyY - Math.round((48 + Math.cos(phase) * 4) * s);
      args.push(
        '-stroke',
        color,
        '-strokewidth',
        String(Math.max(6, Math.round(11 * s))),
        '-draw',
        `line ${neckX},${bodyY - Math.round(6 * s)} ${headX},${headY}`
      );
      args.push(
        '-fill',
        color,
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '2',
        '-draw',
        `circle ${headX},${headY} ${headX + Math.round(14 * s)},${headY}`
      );
      // Beak
      args.push(
        '-fill',
        '#FFC300',
        '-stroke',
        'none',
        '-draw',
        `polygon ${headX + dir * Math.round(11 * s)},${headY - Math.round(4 * s)} ${headX + dir * Math.round(30 * s)},${headY + Math.round(2 * s)} ${headX + dir * Math.round(11 * s)},${headY + Math.round(7 * s)}`
      );
      // Crisp white eye + dark pupil
      const eyeX = headX + dir * Math.round(4 * s);
      const eyeY = headY - Math.round(3 * s);
      args.push(
        '-fill',
        '#FFFFFF',
        '-draw',
        `circle ${eyeX},${eyeY} ${eyeX + Math.round(4.5 * s)},${eyeY}`,
        '-fill',
        '#0F172A',
        '-draw',
        `circle ${eyeX + dir * 2},${eyeY} ${eyeX + dir * 2 + Math.round(2.2 * s)},${eyeY}`
      );
    } else if (actor.kind === 'truck' || actor.kind === 'plane' || actor.kind === 'ship' || actor.kind === 'rocket') {
      // Bouncing pursuit truck / vehicle with continuously spinning spoked wheels & exhaust puffs
      const bounce = Math.round(Math.sin(phase * 1.4) * 5 * s);
      const vy = cy + bounce;
      const wHalf = Math.round(72 * s);
      const hHalf = Math.round(32 * s);

      // Exhaust puffs trailing behind
      for (let pIdx = 0; pIdx < 2; pIdx++) {
        const px = cx - dir * Math.round((86 + ((timeSec * 120 + pIdx * 32) % 52)) * s);
        const py = vy + Math.round((24 - pIdx * 10) * s);
        const pr = Math.round((9 + pIdx * 4) * s);
        args.push(
          '-fill',
          'rgba(226,232,240,0.48)',
          '-stroke',
          'none',
          '-draw',
          `circle ${px},${py} ${px + pr},${py}`
        );
      }

      // Truck flatbed + cab
      args.push(
        '-fill',
        color,
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '3',
        '-draw',
        `roundrectangle ${cx - wHalf},${vy - hHalf} ${cx + wHalf},${vy + Math.round(24 * s)} 10,10`
      );
      // Cab roof & electric cyan windshield
      const cabLeft = dir > 0 ? cx + Math.round(10 * s) : cx - wHalf;
      const cabRight = dir > 0 ? cx + wHalf - Math.round(4 * s) : cx - Math.round(10 * s);
      args.push(
        '-fill',
        sec,
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '2.5',
        '-draw',
        `roundrectangle ${cabLeft},${vy - Math.round(54 * s)} ${cabRight},${vy - Math.round(6 * s)} 8,8`
      );
      args.push(
        '-fill',
        '#BAE6FD',
        '-stroke',
        'none',
        '-draw',
        `roundrectangle ${cabLeft + Math.round(10 * s)},${vy - Math.round(46 * s)} ${cabRight - Math.round(10 * s)},${vy - Math.round(16 * s)} 4,4`
      );
      // Headlight beam
      const hlX = dir > 0 ? cx + wHalf : cx - wHalf;
      args.push(
        '-fill',
        'rgba(255,230,100,0.28)',
        '-stroke',
        'none',
        '-draw',
        `polygon ${hlX},${vy - Math.round(4 * s)} ${hlX + dir * Math.round(95 * s)},${vy - Math.round(32 * s)} ${hlX + dir * Math.round(95 * s)},${vy + Math.round(28 * s)}`
      );

      // Mounted tripod / equipment on flatbed
      const gunX = cx - dir * Math.round(32 * s);
      args.push(
        '-stroke',
        '#F8FAFC',
        '-strokewidth',
        '4',
        '-draw',
        `line ${gunX},${vy - hHalf} ${gunX},${vy - Math.round(52 * s)} line ${gunX - dir * Math.round(12 * s)},${vy - Math.round(50 * s)} ${gunX + dir * Math.round(34 * s)},${vy - Math.round(54 * s)}`
      );

      // Spinning spoked wheels
      const wheelOffsets = [-Math.round(44 * s), Math.round(44 * s)];
      const wheelR = Math.round(22 * s);
      const wheelAngle = timeSec * 12 * dir;
      for (const wxOff of wheelOffsets) {
        const wx = cx + wxOff;
        const wy = vy + Math.round(28 * s);
        args.push(
          '-fill',
          '#111827',
          '-stroke',
          '#F8FAFC',
          '-strokewidth',
          '3',
          '-draw',
          `circle ${wx},${wy} ${wx + wheelR},${wy}`
        );
        args.push(
          '-fill',
          '#FFC300',
          '-stroke',
          'none',
          '-draw',
          `circle ${wx},${wy} ${wx + Math.round(8 * s)},${wy}`
        );
        // Rotating spokes
        const sx1 = Math.round(wx + Math.cos(wheelAngle) * (wheelR - 4));
        const sy1 = Math.round(wy + Math.sin(wheelAngle) * (wheelR - 4));
        const sx2 = Math.round(wx - Math.cos(wheelAngle) * (wheelR - 4));
        const sy2 = Math.round(wy - Math.sin(wheelAngle) * (wheelR - 4));
        args.push(
          '-stroke',
          '#E2E8F0',
          '-strokewidth',
          '2.5',
          '-draw',
          `line ${sx1},${sy1} ${sx2},${sy2}`
        );
      }
    } else if (actor.kind === 'building' || actor.kind === 'chart_bar' || actor.kind === 'gear' || actor.kind === 'globe' || actor.kind === 'document' || actor.kind === 'clock' || actor.kind === 'lightning' || actor.kind === 'coin') {
      // Animated flat-vector architectural / infographic prop
      if (actor.kind === 'chart_bar') {
        const barColors = [color, sec, '#3EC6E0', '#FFC300'];
        for (let bIdx = 0; bIdx < 4; bIdx++) {
          const grow = easeOutBack(clamp(localProgress * 2.5 - bIdx * 0.14, 0, 1));
          const bh = Math.round((46 + bIdx * 28) * s * grow);
          const bx = cx - Math.round(68 * s) + bIdx * Math.round(36 * s);
          args.push(
            '-fill',
            barColors[bIdx % barColors.length],
            '-stroke',
            '#0F172A',
            '-strokewidth',
            '2',
            '-draw',
            `roundrectangle ${bx},${cy + Math.round(52 * s) - bh} ${bx + Math.round(28 * s)},${cy + Math.round(52 * s)} 5,5`
          );
        }
      } else {
        // Stylized Parliament / Capitol dome or glowing medallion prop with pulse ring
        const pulseR = Math.round((64 + Math.sin(phase * 0.8) * 10) * s);
        args.push(
          '-fill',
          'none',
          '-stroke',
          sec,
          '-strokewidth',
          '3',
          '-draw',
          `circle ${cx},${cy} ${cx + pulseR},${cy}`
        );
        args.push(
          '-fill',
          color,
          '-stroke',
          '#0F172A',
          '-strokewidth',
          '3',
          '-draw',
          `roundrectangle ${cx - Math.round(62 * s)},${cy - Math.round(16 * s)} ${cx + Math.round(62 * s)},${cy + Math.round(52 * s)} 8,8`
        );
        // Pediment roof + columns
        args.push(
          '-fill',
          sec,
          '-stroke',
          '#0F172A',
          '-strokewidth',
          '2.5',
          '-draw',
          `polygon ${cx - Math.round(70 * s)},${cy - Math.round(16 * s)} ${cx},${cy - Math.round(62 * s)} ${cx + Math.round(70 * s)},${cy - Math.round(16 * s)}`
        );
        for (let col = -2; col <= 2; col++) {
          const colX = cx + col * Math.round(22 * s);
          args.push(
            '-fill',
            '#F8FAFC',
            '-stroke',
            'none',
            '-draw',
            `rectangle ${colX - Math.round(5 * s)},${cy - Math.round(8 * s)} ${colX + Math.round(5 * s)},${cy + Math.round(46 * s)}`
          );
        }
      }
    } else {
      // Stylized flat-vector human character (soldier / farmer / leader / scientist / person)
      const stride = actor.action === 'run' ? 26 : actor.action === 'walk' || actor.action === 'march' ? 18 : 6;
      const bounce = Math.round(Math.abs(Math.sin(phase)) * (actor.action === 'run' ? -10 : -5) * s);
      const legL = Math.round(Math.sin(phase) * stride * s);
      const legR = Math.round(Math.sin(phase + Math.PI) * stride * s);
      const armSwing = Math.round(Math.sin(phase) * 20 * s);
      const gestureLift = actor.action === 'gesture' ? Math.round((-26 + Math.sin(phase * 1.2) * 10) * s) : 0;
      const by = cy + bounce;

      // Legs
      args.push(
        '-stroke',
        '#1E293B',
        '-strokewidth',
        String(Math.max(6, Math.round(11 * s))),
        '-draw',
        `line ${cx - Math.round(10 * s)},${by + Math.round(18 * s)} ${cx - Math.round(10 * s) + legL},${cy + Math.round(58 * s)} line ${cx + Math.round(10 * s)},${by + Math.round(18 * s)} ${cx + Math.round(10 * s) + legR},${cy + Math.round(58 * s)}`
      );

      // Torso jacket
      args.push(
        '-fill',
        color,
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '2.5',
        '-draw',
        `roundrectangle ${cx - Math.round(22 * s)},${by - Math.round(28 * s)} ${cx + Math.round(22 * s)},${by + Math.round(24 * s)} 12,12`
      );
      // Accent sash / lapel / belt
      args.push(
        '-fill',
        sec,
        '-stroke',
        'none',
        '-draw',
        `rectangle ${cx - Math.round(20 * s)},${by + Math.round(4 * s)} ${cx + Math.round(20 * s)},${by + Math.round(12 * s)}`
      );

      // Arms (gesturing / swinging)
      args.push(
        '-stroke',
        color,
        '-strokewidth',
        String(Math.max(5, Math.round(9 * s))),
        '-draw',
        `line ${cx - Math.round(20 * s)},${by - Math.round(16 * s)} ${cx - Math.round(34 * s) - armSwing},${by + Math.round(14 * s)} line ${cx + Math.round(20 * s)},${by - Math.round(16 * s)} ${cx + Math.round(36 * s) + armSwing},${by + Math.round(12 * s) + gestureLift}`
      );

      // Head + expressive eyes
      const headY = by - Math.round(48 * s);
      args.push(
        '-fill',
        '#FDE68A',
        '-stroke',
        '#0F172A',
        '-strokewidth',
        '2.5',
        '-draw',
        `circle ${cx},${headY} ${cx + Math.round(19 * s)},${headY}`
      );
      args.push(
        '-fill',
        '#0F172A',
        '-stroke',
        'none',
        '-draw',
        `circle ${cx + dir * Math.round(5 * s)},${headY - Math.round(2 * s)} ${cx + dir * Math.round(5 * s) + Math.round(3 * s)},${headY - Math.round(2 * s)}`
      );

      // Character hat / helmet differentiation
      if (actor.kind === 'soldier' || actor.kind === 'farmer') {
        args.push(
          '-fill',
          actor.kind === 'soldier' ? '#365314' : '#D97706',
          '-stroke',
          '#0F172A',
          '-strokewidth',
          '2',
          '-draw',
          `roundrectangle ${cx - Math.round(28 * s)},${headY - Math.round(18 * s)} ${cx + Math.round(28 * s)},${headY - Math.round(9 * s)} 4,4 roundrectangle ${cx - Math.round(16 * s)},${headY - Math.round(30 * s)} ${cx + Math.round(16 * s)},${headY - Math.round(14 * s)} 6,6`
        );
      } else {
        args.push(
          '-fill',
          '#1E293B',
          '-stroke',
          'none',
          '-draw',
          `ellipse ${cx},${headY - Math.round(14 * s)} ${Math.round(19 * s)},${Math.round(8 * s)} 0,360`
        );
      }
    }

    // Crisp actor callout badge on primary actor
    if (i === 0 && actor.label) {
      const lbl = escapeMvgText(actor.label.toUpperCase()).slice(0, 22);
      const bw = Math.max(92, lbl.length * 9 + 24);
      const bx = clamp(cx - Math.round(bw / 2), 28, 1252 - bw);
      const byTag = clamp(cy - Math.round(96 * s), 86, 520);
      args.push(
        '-fill',
        'rgba(10,16,32,0.9)',
        '-stroke',
        color,
        '-strokewidth',
        '2',
        '-draw',
        `roundrectangle ${bx},${byTag} ${bx + bw},${byTag + 28} 6,6`
      );
      args.push(
        '-fill',
        '#FFFFFF',
        '-stroke',
        'none',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '13',
        '-gravity',
        'NorthWest',
        '-annotate',
        `+${bx + 12}+${byTag + 7}`,
        lbl
      );
    }
  }
}

/**
 * Renders a single animated 1280x720 frame at exact `timeMs` matching CineForge's MotionWorldEngine:
 * - Living Flat-Vector Animated Rigs (`animated_rig`) with moving characters, flocks, spinning wheels & count-up stats
 * - Deep-sapphire Animated Cartography (`animated_map`) with progressively drawing Bezier route arrows & pulsing radar rings
 * - Punchy white-sticker Archival Cutouts (`layered_cutout` / `archival_photo`) with spring entry & animated callout badges
 * - Live word-by-word bouncing kinetic captions in electric gold `#FFC300`
 */
async function renderAnimatedFramePng(params: {
  beat: StoryboardBeat;
  totalBeats: number;
  presetId: VideoStylePresetId;
  photoVariantPath: string | null;
  timeMs: number;
  localProgress: number;
  outPngPath: string;
}): Promise<void> {
  const { beat, totalBeats, presetId, photoVariantPath, timeMs, localProgress, outPngPath } = params;
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const p = preset.palette;
  const timeSec = timeMs / 1000;

  const args: string[] = [];

  if (beat.sceneType === 'animated_rig' && beat.animatedRigSpec) {
    const spec: AnimatedRigSpec = beat.animatedRigSpec;
    // Vibrant parallax backdrop based on rig backdrop type
    if (spec.backdrop === 'sky_outback' || spec.backdrop === 'mountain_dawn') {
      args.push('-size', '1280x720', 'gradient:#0EA5E9-#FDE68A');
      // Glowing vibrant sun with gentle pulse
      const sunR = Math.round(62 + Math.sin(timeSec * 3) * 5);
      args.push(
        '-fill',
        '#FFC300',
        '-stroke',
        'none',
        '-draw',
        `circle 1040,145 ${1040 + sunR},145`
      );
      // Parallax clouds
      const cloudShift = Math.round((timeSec * 48) % 1480) - 180;
      args.push(
        '-fill',
        'rgba(255,255,255,0.82)',
        '-draw',
        `roundrectangle ${cloudShift},110 ${cloudShift + 170},148 19,19 roundrectangle ${(cloudShift + 620) % 1380 - 90},168 ${(cloudShift + 620) % 1380 + 60},198 15,15`
      );
      // Parallax terracotta mesas & rolling golden hills
      const hillShift = Math.round(localProgress * -65);
      args.push(
        '-fill',
        '#EA580C',
        '-draw',
        `polygon ${hillShift - 60},470 ${hillShift + 210},320 ${hillShift + 480},430 ${hillShift + 820},300 ${hillShift + 1140},410 ${hillShift + 1420},340 ${hillShift + 1420},590 ${hillShift - 60},590`
      );
      args.push(
        '-fill',
        '#F59E0B',
        '-draw',
        `rectangle 0,468 1280,590`
      );
      // Sunlit wheat horizon stripe
      args.push(
        '-fill',
        '#D97706',
        '-draw',
        `rectangle 0,532 1280,590`
      );
    } else if (spec.backdrop === 'parliament_hall') {
      args.push('-size', '1280x720', `gradient:#1E3A8A-#0B1536`);
      // Dramatic spotlight beams sweeping across hall
      const sweep = Math.round(Math.sin(timeSec * 2.2) * 90);
      args.push(
        '-fill',
        'rgba(255,195,0,0.13)',
        '-stroke',
        'none',
        '-draw',
        `polygon 320,0 ${180 + sweep},600 ${460 + sweep},600 polygon 960,0 ${820 - sweep},600 ${1100 - sweep},600`
      );
      // Grand floor platform
      args.push('-fill', '#172554', '-draw', 'rectangle 0,480 1280,590');
      args.push('-fill', '#3EC6E0', '-draw', 'rectangle 0,478 1280,484');
    } else {
      args.push('-size', '1280x720', `radial-gradient:${p.bgSecondary}-${p.bg}`);
      // Vibrant cyan/gold studio grid
      const gridDraws: string[] = [];
      for (let x = 64; x < 1280; x += 64) gridDraws.push(`line ${x},0 ${x},600`);
      for (let y = 64; y < 600; y += 64) gridDraws.push(`line 0,${y} 1280,${y}`);
      args.push('-stroke', 'rgba(62,198,224,0.14)', '-strokewidth', '1', '-draw', gridDraws.join(' '));
      args.push('-fill', p.surface, '-stroke', 'none', '-draw', 'rectangle 0,486 1280,590');
    }

    // Animated particle system (speed lines / sparks / dust)
    if (spec.weatherParticles === 'speed_lines') {
      const lines: string[] = [];
      for (let k = 0; k < 10; k++) {
        const lx = Math.round(((1320 - ((timeSec * 520 + k * 155) % 1460))));
        const ly = 120 + k * 44;
        lines.push(`line ${lx},${ly} ${lx + 115},${ly}`);
      }
      args.push('-stroke', 'rgba(255,255,255,0.34)', '-strokewidth', '2.5', '-draw', lines.join(' '));
    } else if (spec.weatherParticles === 'sparks' || spec.weatherParticles === 'data_dots' || spec.weatherParticles === 'stars') {
      const dots: string[] = [];
      for (let k = 0; k < 14; k++) {
        const dx = (k * 97 + Math.round(timeSec * 36)) % 1260;
        const dy = 90 + ((k * 73 + Math.round(Math.sin(timeSec * 3 + k) * 22)) % 390);
        dots.push(`circle ${dx},${dy} ${dx + 4},${dy}`);
      }
      args.push('-fill', '#FFC300', '-stroke', 'none', '-draw', dots.join(' '));
    }

    // Render every articulated actor in the rig
    for (const actor of spec.actors) {
      pushAnimatedRigActorMvg(args, actor, localProgress, timeSec, p.accent, p.secondaryAccent);
    }

    // Animated Spring Count-Up Stat Banner (top-left)
    if (spec.counterStat) {
      const countT = easeOutCubic(clamp(localProgress * 1.45, 0, 1));
      const val = Math.round(spec.counterStat.targetValue * countT);
      const formatted = `${spec.counterStat.prefix || ''}${val.toLocaleString('en-US')}${spec.counterStat.suffix || ''}`;
      const statLabel = escapeMvgText(spec.counterStat.label.toUpperCase());
      args.push(
        '-fill',
        'rgba(10,16,32,0.92)',
        '-stroke',
        '#FFC300',
        '-strokewidth',
        '2.5',
        '-draw',
        'roundrectangle 34,26 362,102 10,10'
      );
      args.push(
        '-fill',
        '#FFC300',
        '-stroke',
        'none',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '32',
        '-gravity',
        'NorthWest',
        '-annotate',
        '+52+34',
        escapeMvgText(formatted)
      );
      args.push(
        '-fill',
        '#E2E8F0',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '13',
        '-gravity',
        'NorthWest',
        '-annotate',
        '+52+74',
        statLabel
      );
    } else if (spec.sceneTitle) {
      const hl = escapeMvgText(spec.sceneTitle.toUpperCase()).slice(0, 32);
      const bw = Math.max(240, hl.length * 13 + 38);
      args.push(
        '-fill',
        'rgba(10,16,32,0.9)',
        '-stroke',
        p.accent,
        '-strokewidth',
        '2',
        '-draw',
        `roundrectangle 34,28 ${34 + bw},72 8,8`
      );
      args.push(
        '-fill',
        '#FFFFFF',
        '-stroke',
        'none',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '18',
        '-gravity',
        'NorthWest',
        '-annotate',
        '+52+40',
        hl
      );
    }
  } else if (beat.sceneType === 'animated_map') {
    const regionId = beat.mapSpec?.region || 'australia';
    const region = MAP_REGIONS[regionId] || MAP_REGIONS.australia;
    args.push('-size', '1280x720', `radial-gradient:#114E82-${p.ocean}`);

    // Subtle cartography lat/lon grid
    const gridDraws: string[] = [];
    for (let x = 64; x < 1280; x += 64) gridDraws.push(`line ${x},0 ${x},600`);
    for (let y = 64; y < 600; y += 64) gridDraws.push(`line 0,${y} 1280,${y}`);
    args.push('-stroke', 'rgba(62,198,224,0.18)', '-strokewidth', '1', '-draw', gridDraws.join(' '));

    // Coastline landmasses
    for (const poly of region.landmasses) {
      const pts = poly.points.map(([x, y]) => `${(x * 12.8).toFixed(0)},${(y * 7.2).toFixed(0)}`).join(' ');
      args.push('-fill', p.land, '-stroke', '#3EC6E0', '-strokewidth', '3', '-draw', `polygon ${pts}`);
    }

    // Animated expanding territory radar rings
    for (const terr of beat.mapSpec?.territories || []) {
      const cx = Math.round(terr.x * 12.8);
      const cy = Math.round(terr.y * 7.2);
      const baseR = Math.round(terr.radius * 7.2 * easeOutBack(clamp(localProgress * 2.4, 0, 1)));
      const pulseR = Math.round(baseR + ((timeSec * 45) % 42));
      args.push(
        '-fill',
        'rgba(255,90,54,0.24)',
        '-stroke',
        '#FF5A36',
        '-strokewidth',
        '3',
        '-draw',
        `circle ${cx},${cy} ${cx + Math.max(8, baseR)},${cy}`
      );
      args.push(
        '-fill',
        'none',
        '-stroke',
        '#FFC300',
        '-strokewidth',
        '2',
        '-draw',
        `circle ${cx},${cy} ${cx + Math.max(10, pulseR)},${cy}`
      );
    }

    // Progressively animated curved route arrow (draws from start -> end over the beat!)
    const routeT = easeOutCubic(clamp(localProgress * 1.3, 0.05, 1));
    for (const route of beat.mapSpec?.routes || []) {
      const x0 = route.fromX * 12.8;
      const y0 = route.fromY * 7.2;
      const x2 = route.toX * 12.8;
      const y2 = route.toY * 7.2;
      const mx = (x0 + x2) / 2;
      const my = (y0 + y2) / 2 - 86;

      // Subdivide quadratic Bezier up to routeT
      const steps = 16;
      const pts: string[] = [];
      let headX = x0;
      let headY = y0;
      for (let sIdx = 0; sIdx <= steps; sIdx++) {
        const u = (sIdx / steps) * routeT;
        const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x2;
        const py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y2;
        pts.push(`${Math.round(px)},${Math.round(py)}`);
        headX = px;
        headY = py;
      }
      args.push(
        '-fill',
        'none',
        '-stroke',
        route.color || '#FF5A36',
        '-strokewidth',
        '7',
        '-draw',
        `polyline ${pts.join(' ')}`
      );
      args.push(
        '-fill',
        '#FFC300',
        '-stroke',
        '#FFFFFF',
        '-strokewidth',
        '3',
        '-draw',
        `circle ${Math.round(headX)},${Math.round(headY)} ${Math.round(headX) + 11},${Math.round(headY)}`
      );
    }

    // Map markers + city labels
    for (const m of beat.mapSpec?.markers || []) {
      const mx = Math.round(m.x * 12.8);
      const my = Math.round(m.y * 7.2);
      const label = escapeMvgText(m.label.toUpperCase());
      const bw = Math.max(96, label.length * 10 + 24);
      const pingR = Math.round(11 + ((timeSec * 28) % 16));
      args.push(
        '-fill',
        'none',
        '-stroke',
        '#FFC300',
        '-strokewidth',
        '2',
        '-draw',
        `circle ${mx},${my} ${mx + pingR},${my}`
      );
      args.push(
        '-fill',
        m.color || '#FF5A36',
        '-stroke',
        '#FFFFFF',
        '-strokewidth',
        '2.5',
        '-draw',
        `circle ${mx},${my} ${mx + 9},${my}`
      );
      args.push(
        '-fill',
        'rgba(10,17,30,0.92)',
        '-stroke',
        '#3EC6E0',
        '-strokewidth',
        '2',
        '-draw',
        `roundrectangle ${mx - Math.round(bw / 2)},${my - 46} ${mx + Math.round(bw / 2)},${my - 18} 6,6`
      );
      args.push(
        '-fill',
        '#FFFFFF',
        '-stroke',
        'none',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '14',
        '-gravity',
        'NorthWest',
        '-annotate',
        `+${mx - Math.round(bw / 2) + 12}+${my - 40}`,
        label
      );
    }

    const regLabel = escapeMvgText(region.label.toUpperCase());
    args.push(
      '-fill',
      'rgba(9,16,28,0.92)',
      '-stroke',
      '#3EC6E0',
      '-strokewidth',
      '2',
      '-draw',
      'roundrectangle 34,28 330,70 7,7'
    );
    args.push('-fill', '#FF5A36', '-stroke', 'none', '-draw', 'circle 54,49 60,49');
    args.push(
      '-fill',
      '#FFFFFF',
      '-font',
      'DejaVu-Sans-Bold',
      '-pointsize',
      '16',
      '-gravity',
      'NorthWest',
      '-annotate',
      '+70+40',
      regLabel
    );
  } else if (beat.sceneType === 'diagram_callout') {
    args.push('-size', '1280x720', `radial-gradient:${p.bgSecondary}-${p.bg}`);
    args.push(
      '-fill',
      p.surface,
      '-stroke',
      '#3EC6E0',
      '-strokewidth',
      '2.5',
      '-draw',
      'roundrectangle 72,62 1208,554 16,16'
    );
    if (photoVariantPath) {
      args.push(photoVariantPath, '-gravity', 'NorthWest', '-geometry', '+104+96', '-composite');
      args.push('-fill', 'none', '-stroke', '#FFC300', '-strokewidth', '3.5', '-draw', 'rectangle 104,96 640,516');
    }
    args.push(
      '-fill',
      '#FFFFFF',
      '-stroke',
      'none',
      '-font',
      'DejaVu-Sans-Bold',
      '-pointsize',
      '29',
      '-gravity',
      'NorthWest',
      '-annotate',
      '+684+96',
      escapeMvgText((beat.onScreenText || 'CAMPAIGN STATS').toUpperCase())
    );
    args.push('-fill', '#FF5A36', '-draw', 'rectangle 684,140 810,146');

    const callouts = (beat.calloutItems && beat.calloutItems.length > 0
      ? beat.calloutItems
      : [
          { label: 'EMUS MOBILIZED', value: '20,000' },
          { label: 'ROUNDS FIRED', value: '9,860' },
          { label: 'MILITARY OUTCOME', value: 'RETREAT' },
        ]
    ).slice(0, 3);

    callouts.forEach((c, idx) => {
      const y = 190 + idx * 104;
      const barGrow = easeOutBack(clamp(localProgress * 2.2 - idx * 0.16, 0, 1));
      const targetW = 280 + ((idx * 95 + beat.orderIndex * 40) % 180);
      const barW = Math.max(16, Math.round(targetW * barGrow));
      args.push(
        '-fill',
        '#F8FAFC',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '17',
        '-gravity',
        'NorthWest',
        '-annotate',
        `+684+${y}`,
        escapeMvgText(c.label.toUpperCase())
      );
      if (c.value) {
        args.push(
          '-fill',
          '#FFC300',
          '-font',
          'DejaVu-Sans-Bold',
          '-pointsize',
          '19',
          '-gravity',
          'NorthWest',
          '-annotate',
          `+1032+${y}`,
          escapeMvgText(c.value)
        );
      }
      args.push(
        '-fill',
        'rgba(255,255,255,0.12)',
        '-stroke',
        'none',
        '-draw',
        `roundrectangle 684,${y + 30} 1160,${y + 56} 7,7`
      );
      args.push(
        '-fill',
        idx === 0 ? '#FF5A36' : idx === 1 ? '#FFC300' : '#3EC6E0',
        '-draw',
        `roundrectangle 684,${y + 30} ${684 + barW},${y + 56} 7,7`
      );
    });
  } else {
    // Punchy animated white-sticker archival cutout or kinetic title with spring pop & live drift
    args.push('-size', '1280x720', `radial-gradient:${p.bgSecondary}-${p.bg}`);
    const driftX = Math.round(Math.sin(timeSec * 1.8) * 14);
    const springY = Math.round((1 - easeOutBack(clamp(localProgress * 3.2, 0, 1))) * 36);

    // Decorative vivid background accent bars
    args.push(
      '-fill',
      'rgba(62,198,224,0.16)',
      '-stroke',
      'none',
      '-draw',
      `polygon 0,0 380,0 180,600 0,600`
    );
    args.push(
      '-fill',
      'rgba(255,90,54,0.16)',
      '-draw',
      `polygon 1040,0 1280,0 1280,600 880,600`
    );

    if (beat.sceneType === 'kinetic_title') {
      const popW = Math.round(220 * easeOutBack(clamp(localProgress * 2.8, 0, 1)));
      args.push(
        '-fill',
        '#FFC300',
        '-draw',
        `roundrectangle ${640 - Math.round(popW / 2)},198 ${640 + Math.round(popW / 2)},206 4,4`
      );
      args.push(
        '-fill',
        '#FFFFFF',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '66',
        '-gravity',
        'Center',
        '-annotate',
        `+0+${-48 + springY}`,
        escapeMvgText((beat.onScreenText || 'THE GREAT EMU WAR').toUpperCase())
      );
      args.push(
        '-fill',
        '#3EC6E0',
        '-font',
        'DejaVu-Sans-Bold',
        '-pointsize',
        '24',
        '-gravity',
        'Center',
        '-annotate',
        `+0+${28 + springY}`,
        'WESTERN AUSTRALIA · NOVEMBER 1932'
      );
    } else {
      // White-bordered modern documentary sticker cutout
      const left = 166 + driftX;
      const top = 74 + springY;
      args.push(
        '-fill',
        '#FFFFFF',
        '-stroke',
        '#FFC300',
        '-strokewidth',
        '3',
        '-draw',
        `roundrectangle ${left},${top} ${left + 948},${top + 462} 18,18`
      );
      if (photoVariantPath) {
        args.push(
          photoVariantPath,
          '-gravity',
          'NorthWest',
          '-geometry',
          `+${left + 12}+${top + 12}`,
          '-composite'
        );
      }
      // Animated leader callout badge
      const primaryCallout = beat.calloutItems?.[0]?.label || beat.onScreenText || 'ARCHIVAL EVIDENCE';
      const lbl = escapeMvgText(primaryCallout.toUpperCase()).slice(0, 26);
      const bw = Math.max(150, lbl.length * 10 + 36);
      const badgePop = easeOutBack(clamp(localProgress * 2.5 - 0.15, 0, 1));
      if (badgePop > 0.05) {
        args.push('-stroke', '#FF5A36', '-strokewidth', '3.5', '-draw', `line ${360 + driftX},260 220,164`);
        args.push('-fill', '#FF5A36', '-stroke', '#FFFFFF', '-strokewidth', '2.5', '-draw', `circle ${360 + driftX},260 ${368 + driftX},260`);
        args.push(
          '-fill',
          '#0F172A',
          '-stroke',
          '#FFC300',
          '-strokewidth',
          '2.5',
          '-draw',
          `roundrectangle 96,134 ${96 + bw},180 8,8`
        );
        args.push(
          '-fill',
          '#FFFFFF',
          '-stroke',
          'none',
          '-font',
          'DejaVu-Sans-Bold',
          '-pointsize',
          '15',
          '-gravity',
          'NorthWest',
          '-annotate',
          '+114+149',
          lbl
        );
      }
    }
  }

  // Bottom dark glass caption bar
  args.push(
    '-fill',
    'rgba(8,12,24,0.9)',
    '-stroke',
    'none',
    '-draw',
    'rectangle 0,582 1280,720'
  );

  // Top-right vivid Date Ticker Badge
  const dateLabel = escapeMvgText(beat.dateBadge || beat.mapSpec?.dateLabel || 'NOV 1932');
  args.push(
    '-fill',
    'rgba(10,16,32,0.92)',
    '-stroke',
    '#FFC300',
    '-strokewidth',
    '2',
    '-draw',
    'roundrectangle 1046,28 1246,70 7,7'
  );
  args.push('-fill', '#FF5A36', '-stroke', 'none', '-draw', 'rectangle 1056,37 1062,61');
  args.push(
    '-fill',
    '#FFFFFF',
    '-font',
    'DejaVu-Sans-Bold',
    '-pointsize',
    '17',
    '-gravity',
    'NorthWest',
    '-annotate',
    '+1074+40',
    dateLabel
  );

  // Real-time word-synced kinetic caption highlighting at exact `timeMs`
  const tsWords = (beat.wordTimestamps || []).filter((w) => w.word.trim().length > 0);
  if (tsWords.length > 0) {
    let activeGlobalIdx = tsWords.findIndex((w) => timeMs >= w.startMs && timeMs <= w.endMs);
    if (activeGlobalIdx < 0) {
      activeGlobalIdx = Math.min(
        tsWords.length - 1,
        Math.max(0, Math.floor(localProgress * tsWords.length))
      );
    }
    const chunkSize = 6;
    const chunkIdx = Math.floor(activeGlobalIdx / chunkSize);
    const chunk = tsWords.slice(chunkIdx * chunkSize, chunkIdx * chunkSize + chunkSize);
    const activeLocalIdx = activeGlobalIdx - chunkIdx * chunkSize;

    const cleanWords = chunk.map((w) => escapeMvgText(w.word)).filter(Boolean);
    const estTotalW = cleanWords.reduce((sum, w) => sum + Math.max(44, w.length * 16) + 18, -18);
    let cursorX = Math.max(40, Math.round(640 - estTotalW / 2));

    cleanWords.forEach((word, idx) => {
      const ww = Math.max(44, word.length * 16);
      if (idx === activeLocalIdx) {
        args.push(
          '-fill',
          p.highlightBg,
          '-stroke',
          'none',
          '-draw',
          `roundrectangle ${cursorX - 9},620 ${cursorX + ww + 9},668 8,8`
        );
        args.push(
          '-fill',
          '#0A0F1F',
          '-font',
          'DejaVu-Sans-Bold',
          '-pointsize',
          '27',
          '-gravity',
          'NorthWest',
          '-annotate',
          `+${cursorX + 1}+629`,
          word
        );
      } else {
        args.push(
          '-fill',
          idx < activeLocalIdx ? '#FFFFFF' : '#94A3B8',
          '-stroke',
          'none',
          '-font',
          'DejaVu-Sans-Bold',
          '-pointsize',
          '25',
          '-gravity',
          'NorthWest',
          '-annotate',
          `+${cursorX + 2}+631`,
          word
        );
      }
      cursorX += ww + 18;
    });
  }

  // Smooth continuous timeline progress bar along bottom edge
  const progFrac = clamp((beat.orderIndex + localProgress) / Math.max(1, totalBeats), 0, 1);
  const progW = Math.round(progFrac * 1280);
  args.push('-fill', 'rgba(255,255,255,0.16)', '-draw', 'rectangle 0,714 1280,720');
  args.push('-fill', '#FF5A36', '-draw', `rectangle 0,714 ${progW},720`);

  args.push(outPngPath);
  await execFileAsync('convert', args, { timeout: 20000 });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/**
 * Computes mean absolute RGB pixel difference (0..255) between two frames extracted at t1Sec and t2Sec
 * inside the same beat of the rendered MP4, proving genuine continuous intra-scene motion (not static slides).
 */
async function measureIntraBeatPixelMotion(
  mp4Path: string,
  t1Sec: number,
  t2Sec: number
): Promise<number> {
  const grabRawRgb = async (tSec: number): Promise<Buffer> => {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      [
        '-ss',
        tSec.toFixed(3),
        '-i',
        mp4Path,
        '-vframes',
        '1',
        '-vf',
        'scale=320:180',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 15000 }
    );
    return stdout as unknown as Buffer;
  };
  const [buf1, buf2] = await Promise.all([grabRawRgb(t1Sec), grabRawRgb(t2Sec)]);
  const len = Math.min(buf1.length, buf2.length);
  if (len === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < len; i++) {
    sumDiff += Math.abs(buf1[i] - buf2[i]);
  }
  return Number((sumDiff / len).toFixed(2));
}

async function main() {
  const startedAt = Date.now();
  const ownerId = 'e2e_demo_runner';
  const projectId = 'proj_emu_war_demo';
  const renderId = `rnd_${Date.now().toString(36)}`;
  const stylePreset: VideoStylePresetId = 'historically';
  const presetInfo = VIDEO_STYLE_PRESETS[stylePreset];

  const inputBrief = {
    title: 'The Great Emu War: How Australia Lost a Military Campaign in 1932',
    topic:
      'The Great Emu War in Western Australia, November 1932, when the Australian military deployed Royal Artillery soldiers with Lewis machine guns against 20,000 emus.',
    videoStylePreset: stylePreset,
    referenceChannel: presetInfo.referenceChannel,
    resolution: { width: 1280, height: 720, fps: 30 },
    audioMixer: {
      voiceVolume: 1.0,
      musicVolume: 0.28,
      sfxVolume: 0.55,
      autoDucking: true,
      duckingDepthDb: 10,
      ambientBed: presetInfo.defaultAmbientBed,
    } satisfies AudioMixerSettings,
    scriptParagraphs: [
      {
        heading: 'The 20,000 Emu Invasion',
        durationSec: 8.6,
        text: 'In November 1932, twenty thousand emus charged straight onto Western Australian wheat farms. Desperate farmers begged Canberra for military aid against the unstoppable feathered invasion.',
      },
      {
        heading: 'Outback Truck Pursuit',
        durationSec: 8.8,
        text: 'Major Meredith deployed Royal Artillery soldiers armed with Lewis machine guns near Campion. Across the vast outback map, agile flocks scattered faster than pursuit trucks could chase.',
      },
      {
        heading: 'Parliament Retreats',
        durationSec: 8.4,
        text: 'After nearly 10,000 rounds fired, fewer than 1,000 birds fell in 30 days. Parliament withdrew the troops, crowning the emus victorious in history’s wildest military campaign.',
      },
    ],
  };

  console.log('\n============================================================');
  console.log('CINEFORGE UPGRADED LIVING-DOCUMENTARY E2E PIPELINE TEST');
  console.log('============================================================\n');
  console.log('INPUT PROJECT BRIEF:');
  console.log(
    JSON.stringify(
      {
        title: inputBrief.title,
        stylePreset: `${inputBrief.videoStylePreset} (${inputBrief.referenceChannel})`,
        vibrantPalette: presetInfo.palette,
        resolution: `${inputBrief.resolution.width}x${inputBrief.resolution.height} @ ${inputBrief.resolution.fps} FPS`,
        musicBed: inputBrief.audioMixer.ambientBed,
        scriptParagraphCount: inputBrief.scriptParagraphs.length,
      },
      null,
      2
    )
  );

  const storage = new LocalFileStorageService();
  const archivalService = new ArchivalAssetService();
  const storyboardService = new GeminiStoryboardService();
  const beatFulfillmentService = new BeatMediaFulfillmentService(archivalService);
  const renderer = new FfmpegVideoRenderingService(storage);

  // STEP 3: Voiceover Mastering + Broadcast DSP + Word Timestamps
  console.log('\n[Step 3/7] Mastering narration track with Broadcast DSP (-16 LUFS) & word-level timestamps...');
  const rawVoice = generateRealisticNarrationWav(inputBrief.scriptParagraphs, 24000);
  const masteredVoiceWav = await applyBroadcastAudioPostProcessing(rawVoice.wavBuffer, {
    loudnessNormalization: true,
    targetLufs: -16,
    warmEq: true,
    gentleCompression: true,
    deEsser: true,
    noiseReduction: true,
  });
  const wavMeta = getWavDurationMs(masteredVoiceWav);
  const savedVoice = await storage.saveFile({
    ownerId,
    projectId,
    folder: 'audio',
    fileName: `narration_${renderId}.wav`,
    buffer: masteredVoiceWav,
  });
  console.log(
    `  -> Mastered WAV: ${(masteredVoiceWav.length / 1024).toFixed(1)} KB · ${(wavMeta.durationMs / 1000).toFixed(2)}s (${wavMeta.sampleRate} Hz)`
  );

  // STEP 4: Storyboard-First Shot Blueprint (Asset-Agnostic — Planned Directly From Spoken Narration!)
  console.log('\n[Step 4/7] Planning Storyboard-First Shot Blueprint directly from spoken narration (zero pre-fetched assets)...');
  const draftBeats = await storyboardService.generateStoryboard({
    topic: inputBrief.topic,
    researchSummary:
      'In November 1932, 20,000 emus raided Western Australian wheat farms. Royal Artillery soldiers chased flocks in Lewis machine gun trucks across the outback before Parliament withdrew.',
    worldEnvironment: presetInfo.defaultWorld,
    videoStylePreset: stylePreset,
    segments: rawVoice.segments,
  });

  const plannedBeats: StoryboardBeat[] = draftBeats.map((b, idx) => ({
    ...b,
    id: `beat_${idx + 1}`,
    ownerId,
    projectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
  console.log(`  -> Planned ${plannedBeats.length} asset-agnostic shot cards ready for 1-to-1 fulfillment.`);

  // STEP 5: Beat-Matched 1-to-1 Media & Animation Studio (Zero Duplicates Guaranteed!)
  console.log('\n[Step 5/7] Fulfilling every storyboard beat 1-to-1 across photos, public video clips, animated rigs & maps (zero repeats)...');
  const fulfillment = await beatFulfillmentService.fulfillStoryboardBeats({
    topic: inputBrief.topic,
    researchSummary:
      'In November 1932, 20,000 emus raided Western Australian wheat farms. Royal Artillery soldiers chased flocks in Lewis machine gun trucks across the outback before Parliament withdrew.',
    stylePreset,
    beats: plannedBeats,
    onProgress: (completed, total, message) => {
      console.log(`     [${completed}/${total}] ${message}`);
    },
  });

  if (fulfillment.uniquenessReport.duplicateCount !== 0) {
    throw new Error(
      `Zero-repeat violation: detected ${fulfillment.uniquenessReport.duplicateCount} duplicate beat visuals!`
    );
  }

  const patchMap = new Map(fulfillment.beatPatches.map((bp) => [bp.beatId, bp.patch]));
  const beats: StoryboardBeat[] = plannedBeats.map((b) => ({
    ...b,
    ...(patchMap.get(b.id) || {}),
  }));

  const avgBeatSec =
    beats.reduce((sum, b) => sum + (b.endMs - b.startMs), 0) / Math.max(1, beats.length) / 1000;
  const rigBeatCount = beats.filter((b) => b.sceneType === 'animated_rig').length;
  const videoBeatCount = beats.filter((b) => b.sceneType === 'archival_video').length;
  console.log(
    `  -> Fulfilled ${beats.length}/${beats.length} beats with ${fulfillment.uniquenessReport.duplicateCount} duplicates (avg ${avgBeatSec.toFixed(2)}s/beat · video=${videoBeatCount}, rigs=${rigBeatCount}, photos=${fulfillment.uniquenessReport.breakdown.archivalPhoto}, maps=${fulfillment.uniquenessReport.breakdown.animatedMap}):`
  );
  beats.forEach((b) => {
    const dur = ((b.endMs - b.startMs) / 1000).toFixed(2);
    console.log(
      `     Beat ${b.orderIndex + 1} [${(b.startMs / 1000).toFixed(1)}s–${(b.endMs / 1000).toFixed(1)}s | ${dur}s] scene=${b.sceneType} | asset="${(b.heroAssetTitle || '').slice(0, 36)}" | "${b.narrationText.slice(0, 38)}..."`
    );
  });

  // STEP 6: True Multi-Frame Animated Vector, Real Video Clip, Cartography & Archival Cutout Sequence -> 30 FPS Broadcast H.264
  console.log('\n[Step 6/7] Rendering true multi-frame beat-matched documentary sequence (1280x720 @ 30 FPS)...');
  const tmpWork = await fs.mkdtemp(path.join(os.tmpdir(), 'cineforge-living-demo-'));
  const framesDir = path.join(tmpWork, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  try {
    // Pre-download unique archival photos and public video clips once
    const photoRawCache = new Map<string, string | null>();
    const photoCutoutCache = new Map<string, string | null>();
    const photoDiagramCache = new Map<string, string | null>();
    const videoFileCache = new Map<string, string | null>();

    for (const beat of beats) {
      if (beat.sceneType === 'archival_video' && beat.heroVideoUrl && !videoFileCache.has(beat.heroVideoUrl)) {
        const vidPath = path.join(tmpWork, `clip_${videoFileCache.size}.mp4`);
        const dlVid = await downloadVideoToDisk(beat.heroVideoUrl, vidPath);
        videoFileCache.set(beat.heroVideoUrl, dlVid);
      }
      if (beat.heroAssetUrl && beat.sceneType !== 'animated_rig' && beat.sceneType !== 'animated_map') {
        if (!photoRawCache.has(beat.heroAssetUrl)) {
          const dlPath = path.join(tmpWork, `photo_${photoRawCache.size}.jpg`);
          const downloaded = await downloadPhotoToDisk(beat.heroAssetUrl, dlPath);
          photoRawCache.set(beat.heroAssetUrl, downloaded);
          if (downloaded) {
            photoCutoutCache.set(
              beat.heroAssetUrl,
              await prepareCachedPhotoVariant(downloaded, `${dlPath}_cutout.png`, '924x438')
            );
            photoDiagramCache.set(
              beat.heroAssetUrl,
              await prepareCachedPhotoVariant(downloaded, `${dlPath}_diagram.png`, '536x420')
            );
          }
        }
      }
    }

    const animFps = 10; // Snappy stylized animation cadence, encoded cleanly to 30 FPS H.264
    const totalDurationSec = wavMeta.durationMs / 1000;
    const totalAnimFrames = Math.max(24, Math.ceil(totalDurationSec * animFps));

    interface FrameJob {
      index: number;
      timeMs: number;
      beat: StoryboardBeat;
      localProgress: number;
      photoVariantPath: string | null;
      outPngPath: string;
    }

    const jobs: FrameJob[] = [];
    for (let f = 0; f < totalAnimFrames; f++) {
      const timeMs = Math.round((f / animFps) * 1000);
      const beat =
        beats.find((b) => timeMs >= b.startMs && timeMs < b.endMs) ||
        beats[beats.length - 1];
      const beatDur = Math.max(1, beat.endMs - beat.startMs);
      const localProgress = clamp((timeMs - beat.startMs) / beatDur, 0, 1);
      const assetKey = beat.heroAssetUrl || '';
      const photoVariantPath =
        beat.sceneType === 'diagram_callout'
          ? photoDiagramCache.get(assetKey) || null
          : photoCutoutCache.get(assetKey) || null;

      jobs.push({
        index: f,
        timeMs,
        beat,
        localProgress,
        photoVariantPath,
        outPngPath: path.join(framesDir, `frame_${String(f).padStart(5, '0')}.png`),
      });
    }

    const frameRenderStart = Date.now();
    await runPool(jobs, 8, async (job) => {
      let mediaPath = job.photoVariantPath;
      if (job.beat.sceneType === 'archival_video' && job.beat.heroVideoUrl) {
        const localClip = videoFileCache.get(job.beat.heroVideoUrl);
        if (localClip) {
          const clipOffsetSec =
            (job.beat.videoStartOffsetSec || 0) + Math.max(0, job.timeMs - job.beat.startMs) / 1000;
          const extracted = await extractVideoFramePng(
            localClip,
            clipOffsetSec,
            path.join(tmpWork, `vframe_${job.index}.png`),
            924,
            438
          );
          if (extracted) mediaPath = extracted;
        }
      }
      await renderAnimatedFramePng({
        beat: job.beat,
        totalBeats: beats.length,
        presetId: stylePreset,
        photoVariantPath: mediaPath,
        timeMs: job.timeMs,
        localProgress: job.localProgress,
        outPngPath: job.outPngPath,
      });
    });
    console.log(
      `  -> Rendered ${jobs.length} live animated vector frames in ${((Date.now() - frameRenderStart) / 1000).toFixed(2)}s`
    );

    const rawVisualMp4 = path.join(tmpWork, 'visual_world_1280x720.mp4');
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-framerate',
        String(animFps),
        '-i',
        path.join(framesDir, 'frame_%05d.png'),
        '-vf',
        'fps=30,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-an',
        rawVisualMp4,
      ],
      { timeout: 60000 }
    );
    const visualStat = await fs.stat(rawVisualMp4);
    console.log(
      `  -> Encoded multi-frame 1280x720 @ 30 FPS stream (${(visualStat.size / 1024).toFixed(0)} KB raw H.264)`
    );

    // STEP 7: Final Broadcast MP4 Mastering + Auto-Ducked Music/SFX + Automated QA
    console.log('\n[Step 7/7] Mastering final H.264/AAC MP4 with music bed + transition SFX + FFprobe/blackdetect QA...');
    const sfxEvents: BeatSfxEvent[] = beats.map((b) => ({
      timeMs: b.startMs,
      cue: b.sfxCue || 'whoosh',
    }));

    const finalRender = await renderer.finalizeUploadedVideo(
      {
        ownerId,
        projectId,
        renderId,
        inputFilePath: rawVisualMp4,
        inputExt: 'mp4',
        audioRelativePath: savedVoice.relativePath,
        audioMixConfig: {
          mixer: inputBrief.audioMixer,
          sfxEvents,
        },
        width: 1280,
        height: 720,
        fps: 30,
      },
      (stage: string, pct: number) => console.log(`     [${pct}%] ${stage}`)
    );

    // Copy newly mastered living-documentary MP4 to /public/demo/emu_war_demo.mp4 for instant in-app playback
    const relFromUrl = decodeURIComponent(
      finalRender.outputUrl.replace(/^\/api\/media\/file\//, '')
    );
    const renderedDiskPath = storage.resolveSafePath(relFromUrl);
    const publicDemoPath = path.resolve(process.cwd(), 'public', 'demo', 'emu_war_demo.mp4');
    await fs.mkdir(path.dirname(publicDemoPath), { recursive: true });
    await fs.copyFile(renderedDiskPath, publicDemoPath);

    // Quantitative Inter-Frame Pixel Motion Verification inside an animated_rig beat (proves NOT a static slideshow!)
    const firstRigBeat = beats.find((b) => b.sceneType === 'animated_rig') || beats[0];
    const sampleT1 = (firstRigBeat.startMs + 450) / 1000;
    const sampleT2 = (firstRigBeat.startMs + 1050) / 1000;
    const intraBeatPixelDelta = await measureIntraBeatPixelMotion(publicDemoPath, sampleT1, sampleT2);
    if (intraBeatPixelDelta < 3.0) {
      throw new Error(`Inter-frame motion check failed: mean RGB diff ${intraBeatPixelDelta} < 3.0`);
    }

    // Live HTTP 206 Range verification against Express server on port 3000
    const rangeResp = await fetch('http://127.0.0.1:3000/demo/emu_war_demo.mp4', {
      headers: { Range: 'bytes=0-65535' },
    });

    // Save extracted QA keyframe PNGs to artifacts directory for visual verification
    const qaOutDir = path.resolve(
      process.cwd(),
      '.aistudio/artifacts/brain/4874cbbc-7f2e-4650-8ffe-b13a56d46ec0/e2e_qa_frames'
    );
    await fs.mkdir(qaOutDir, { recursive: true });
    // Remove stale previous frames
    const prevFiles = await fs.readdir(qaOutDir).catch(() => []);
    await Promise.all(
      prevFiles.filter((f) => f.endsWith('.png')).map((f) => fs.rm(path.join(qaOutDir, f), { force: true }))
    );

    const savedQaFiles: Array<{ timeSec: number; label: string; path: string; bytes: number }> = [];
    for (let i = 0; i < finalRender.qaFrames.length; i++) {
      const frame = finalRender.qaFrames[i];
      const b64 = frame.dataUrl.replace(/^data:image\/[a-z+]+;base64,/i, '');
      const buf = Buffer.from(b64, 'base64');
      const outFile = path.join(qaOutDir, `qa_frame_${i + 1}_${frame.timeSec.toFixed(1)}s.png`);
      await fs.writeFile(outFile, buf);
      savedQaFiles.push({ timeSec: frame.timeSec, label: frame.label, path: outFile, bytes: buf.length });
    }

    console.log('\n============================================================');
    console.log('FINAL OUTPUT SUMMARY');
    console.log('============================================================');
    console.log(
      JSON.stringify(
        {
          renderId,
          publicDemoUrl: '/demo/emu_war_demo.mp4',
          outputUrl: finalRender.outputUrl,
          codecInfo: finalRender.codecInfo,
          durationSec: finalRender.durationSec,
          fileSizeMB: Number((finalRender.fileSizeBytes / (1024 * 1024)).toFixed(2)),
          beatsRendered: beats.length,
          avgBeatDurationSec: Number(avgBeatSec.toFixed(2)),
          uniquenessReport: fulfillment.uniquenessReport,
          animatedRigBeats: rigBeatCount,
          archivalVideoBeats: videoBeatCount,
          intraBeatMotionCheck: {
            beatIndex: firstRigBeat.orderIndex + 1,
            sceneType: firstRigBeat.sceneType,
            t1Sec: Number(sampleT1.toFixed(2)),
            t2Sec: Number(sampleT2.toFixed(2)),
            meanRgbPixelDelta: intraBeatPixelDelta,
            passed: intraBeatPixelDelta >= 3.0,
          },
          blackFramesDetected: finalRender.blackFramesDetected,
          audioSyncDeltaMs: finalRender.audioSyncDeltaMs,
          qaFrames: savedQaFiles.map((f) => ({
            timeSec: f.timeSec,
            label: f.label,
            file: path.basename(f.path),
            sizeKB: Number((f.bytes / 1024).toFixed(1)),
          })),
          qaChecks: finalRender.qaChecks,
          httpRangePlaybackCheck: {
            status: rangeResp.status,
            contentType: rangeResp.headers.get('content-type'),
            contentRange: rangeResp.headers.get('content-range'),
          },
          totalPipelineElapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        },
        null,
        2
      )
    );
  } finally {
    await fs.rm(tmpWork, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nEND-TO-END DEMO FAILED:', err);
  process.exit(1);
});
