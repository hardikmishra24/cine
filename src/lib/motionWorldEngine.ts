import {
  VIDEO_STYLE_PRESETS,
  type BeatCalloutItem,
  type BeatMapSpec,
  type StoryboardBeat,
  type VideoStylePresetId,
  type VisualDirection,
  type WorldEnvironment,
} from '../types/cineforge';
import { MAP_REGIONS, detectMapRegionFromText } from './worldMapData';
import { drawAnimatedRigScene } from './animatedRigRenderer';

export interface RenderWorldConfig {
  width: number;
  height: number;
  worldEnvironment: WorldEnvironment;
  videoStylePreset?: VideoStylePresetId;
  projectTitle: string;
  visualDirection?: VisualDirection;
  beats: StoryboardBeat[];
  images: Map<string, HTMLImageElement>;
  videos?: Map<string, HTMLVideoElement>;
  deskTexture?: HTMLImageElement | null;
  totalDurationMs: number;
  showSafeGuides?: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutQuint(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 5);
}

function easeOutBack(t: number): number {
  const x = clamp(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function computeTriggerFraction(beat: StoryboardBeat): number {
  if (!beat.triggerWord || !beat.narrationText) return 0.14;
  const idx = beat.narrationText.toLowerCase().indexOf(beat.triggerWord.toLowerCase());
  if (idx < 0) return 0.16;
  return clamp(idx / Math.max(1, beat.narrationText.length), 0.06, 0.72);
}

export function getActiveBeatAtTime(beats: StoryboardBeat[], timeMs: number): {
  beat: StoryboardBeat | null;
  index: number;
  localProgress: number;
} {
  if (beats.length === 0) return { beat: null, index: -1, localProgress: 0 };
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (timeMs >= b.startMs && timeMs <= b.endMs) {
      const span = Math.max(1, b.endMs - b.startMs);
      return { beat: b, index: i, localProgress: clamp((timeMs - b.startMs) / span, 0, 1) };
    }
  }
  if (timeMs < beats[0].startMs) {
    return { beat: beats[0], index: 0, localProgress: 0 };
  }
  const last = beats[beats.length - 1];
  return { beat: last, index: beats.length - 1, localProgress: 1 };
}

function resolveEffectivePreset(config: RenderWorldConfig): VideoStylePresetId {
  if (config.videoStylePreset && config.videoStylePreset in VIDEO_STYLE_PRESETS) {
    return config.videoStylePreset;
  }
  return 'historically';
}

function isLightPaperPreset(presetId: VideoStylePresetId): boolean {
  const mode = VIDEO_STYLE_PRESETS[presetId].paperMode;
  return mode === 'aged_parchment' || mode === 'cream_sketchbook';
}

function drawPresetBackdrop(
  ctx: CanvasRenderingContext2D,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  timeMs: number,
  deskTexture?: HTMLImageElement | null
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { bg, bgSecondary, accent } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);

  const grad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    width * 0.08,
    width * 0.5,
    height * 0.5,
    width * 0.82
  );
  grad.addColorStop(0, bgSecondary);
  grad.addColorStop(1, bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (presetId === 'archival_documentary' && deskTexture && deskTexture.complete && deskTexture.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.drawImage(deskTexture, 0, 0, width, height);
    ctx.restore();
  }

  ctx.save();
  if (presetId === 'minute_earth') {
    // Sketchbook faint dot grid
    ctx.fillStyle = 'rgba(43, 38, 34, 0.085)';
    const step = Math.max(24, Math.round(width / 36));
    for (let x = step / 2; x < width; x += step) {
      for (let y = step / 2; y < height; y += step) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  } else if (presetId === 'simple_history') {
    // Subtle aged parchment drafting lines & border
    ctx.strokeStyle = 'rgba(28, 25, 23, 0.06)';
    ctx.lineWidth = 1;
    const step = Math.max(48, Math.round(width / 20));
    ctx.beginPath();
    for (let x = 0; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (presetId === 'historically') {
    // Crisp editorial diagonal grid & subtle radial glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = Math.max(54, Math.round(width / 20));
    ctx.beginPath();
    for (let x = 0; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  } else if (presetId === 'ted_ed') {
    // Soft gouache floating geometric accents in background
    const drift = Math.sin(timeMs / 2400) * 18;
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(width * 0.14 + drift, height * 0.22, width * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = preset.palette.secondaryAccent;
    ctx.beginPath();
    ctx.arc(width * 0.86 - drift, height * 0.78, width * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (presetId === 'history_on_maps') {
    // Ocean graticule lines
    ctx.strokeStyle = 'rgba(180, 210, 240, 0.08)';
    ctx.lineWidth = 1;
    const step = Math.max(60, Math.round(width / 16));
    ctx.beginPath();
    for (let x = 0; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Subtle deterministic paper / film texture specks
  const seed = Math.floor(timeMs / 80);
  ctx.save();
  ctx.fillStyle = paperMode ? 'rgba(40, 32, 22, 0.032)' : 'rgba(255, 255, 255, 0.025)';
  for (let i = 0; i < 45; i++) {
    const h1 = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const h2 = Math.sin(seed * 93.9898 + i * 19.137) * 24634.6345;
    ctx.fillRect((h1 - Math.floor(h1)) * width, (h2 - Math.floor(h2)) * height, 1.8, 1.8);
  }
  ctx.restore();
}

function drawAnimatedMapScene(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number,
  timeMs: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const isLightPaper = isLightPaperPreset(presetId);
  const spec: BeatMapSpec = beat.mapSpec || {
    region: detectMapRegionFromText(beat.narrationText || beat.heroAssetTitle || ''),
    dateLabel: beat.dateBadge,
    markers: [],
    routes: [],
    territories: [],
  };
  const regionData = MAP_REGIONS[spec.region] || MAP_REGIONS.world;

  // Map viewport fills frame cleanly above caption strip with smooth camera flight
  const targetFocusX = clamp((spec.focusX ?? 50) / 100, 0.25, 0.75);
  const targetFocusY = clamp((spec.focusY ?? 50) / 100, 0.25, 0.75);
  const targetZoom = clamp(spec.zoom ?? 1.18, 1.04, 1.65);
  const moveT = easeInOutCubic(localProgress);
  const camX = lerp(0.5, targetFocusX, moveT);
  const camY = lerp(0.5, targetFocusY, moveT);
  const zoom = lerp(1.02, targetZoom, moveT);

  // Vibrant ocean backdrop tuned to preset palette
  ctx.save();
  const oceanGrad = ctx.createRadialGradient(width * 0.5, height * 0.45, width * 0.06, width * 0.5, height * 0.5, width * 0.8);
  if (isLightPaper) {
    oceanGrad.addColorStop(0, preset.palette.ocean);
    oceanGrad.addColorStop(1, '#1D5B96');
  } else {
    oceanGrad.addColorStop(0, preset.palette.ocean);
    oceanGrad.addColorStop(1, preset.palette.bg);
  }
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // Apply smooth camera flight transform
  ctx.translate(width / 2, height * 0.46);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX * width, -camY * height);

  // Latitude / Longitude graticule
  ctx.strokeStyle = isLightPaper ? 'rgba(255, 255, 255, 0.2)' : 'rgba(56, 189, 248, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 0; gx <= 10; gx++) {
    const x = (gx / 10) * width;
    ctx.moveTo(x, -height * 0.2);
    ctx.lineTo(x, height * 1.2);
  }
  for (let gy = 0; gy <= 8; gy++) {
    const y = (gy / 8) * height;
    ctx.moveTo(-width * 0.2, y);
    ctx.lineTo(width * 1.2, y);
  }
  ctx.stroke();

  // Coastline bathymetry halo + crisp high-contrast land polygons
  const landFill = preset.palette.land;
  const landStroke = isLightPaper ? '#14213D' : preset.palette.border;
  const haloColor = isLightPaper ? 'rgba(255, 255, 255, 0.28)' : 'rgba(0, 212, 255, 0.26)';

  for (const poly of regionData.landmasses) {
    if (poly.points.length < 3) continue;
    ctx.beginPath();
    poly.points.forEach(([px, py]: [number, number], idx: number) => {
      const sx = (px / 100) * width;
      const sy = (py / 100) * height;
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();

    // Soft coastal bathymetry ring
    ctx.save();
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = Math.max(8, width * 0.012);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = landFill;
    ctx.fill();
    ctx.strokeStyle = landStroke;
    ctx.lineWidth = Math.max(1.8, width * 0.0022);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Animated territory control zones (History on Maps style expanding control tints)
  const territories = spec.territories || [];
  territories.forEach((terr, idx) => {
    const appear = easeOutQuint((localProgress - idx * 0.14) / 0.35);
    if (appear <= 0.01) return;
    const cx = (terr.x / 100) * width;
    const cy = (terr.y / 100) * height;
    const rad = (terr.radius / 100) * Math.min(width, height) * appear * 1.25;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = terr.color;
    ctx.globalAlpha = 0.26;
    ctx.fill();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = terr.color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // Animated curved troop/trade route arrows
  const routes = spec.routes || [];
  routes.forEach((route, idx) => {
    const drawT = easeInOutCubic((localProgress - 0.12 - idx * 0.12) / 0.56);
    if (drawT <= 0.01) return;

    const x0 = (route.fromX / 100) * width;
    const y0 = (route.fromY / 100) * height;
    const x2 = (route.toX / 100) * width;
    const y2 = (route.toY / 100) * height;
    const mx = (x0 + x2) / 2;
    const my = (y0 + y2) / 2 - height * 0.11;

    // Sample quadratic curve up to drawT
    const steps = 36;
    const maxStep = Math.max(1, Math.floor(steps * drawT));
    ctx.save();
    ctx.beginPath();
    let tipX = x0;
    let tipY = y0;
    let prevX = x0;
    let prevY = y0;
    for (let s = 0; s <= maxStep; s++) {
      const t = s / steps;
      const inv = 1 - t;
      const px = inv * inv * x0 + 2 * inv * t * mx + t * t * x2;
      const py = inv * inv * y0 + 2 * inv * t * my + t * t * y2;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      if (s === maxStep - 1) {
        prevX = px;
        prevY = py;
      }
      if (s === maxStep) {
        tipX = px;
        tipY = py;
      }
    }
    ctx.strokeStyle = route.color || preset.palette.accent;
    ctx.lineWidth = Math.max(4, width * 0.005);
    ctx.lineCap = 'round';
    if (route.dashed) ctx.setLineDash([12, 8]);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.setLineDash([]);

    // Bold arrowhead at animated tip
    const angle = Math.atan2(tipY - prevY, tipX - prevX);
    const headLen = Math.max(14, width * 0.017);
    ctx.fillStyle = route.color || preset.palette.accent;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle - 0.45), tipY - headLen * Math.sin(angle - 0.45));
    ctx.lineTo(tipX - headLen * Math.cos(angle + 0.45), tipY - headLen * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();

    // Route label pill along midpoint once > 45% drawn
    if (route.label && drawT > 0.45) {
      const lx = 0.25 * x0 + 0.5 * mx + 0.25 * x2;
      const ly = 0.25 * y0 + 0.5 * my + 0.25 * y2 - 14;
      const labelFont = Math.max(12, Math.round(height * 0.018));
      ctx.font = `700 ${labelFont}px "Inter", system-ui, sans-serif`;
      const tw = ctx.measureText(route.label).width;
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = isLightPaper ? '#1C1917' : '#0B1220';
      roundRectPath(ctx, lx - tw / 2 - 10, ly - labelFont * 0.78, tw + 20, labelFont * 1.45, 5);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(route.label, lx, ly - 1);
    }
    ctx.restore();
  });

  // Pulsing map markers (battle starbursts / city pins)
  const markers =
    spec.markers && spec.markers.length > 0
      ? spec.markers
      : regionData.defaultLabels.slice(0, 2).map((h: { text: string; x: number; y: number }, i: number) => ({
          label: h.text,
          x: h.x,
          y: h.y,
          kind: (i === 0 ? 'battle' : 'city') as 'battle' | 'city',
          color: preset.palette.accent,
        }));

  markers.forEach((m, idx: number) => {
    const pop = easeOutBack((localProgress - idx * 0.14) / 0.24);
    if (pop <= 0.02) return;
    const mx = (m.x / 100) * width;
    const my = (m.y / 100) * height;
    const pulse = (Math.sin(timeMs / 240 + idx * 1.7) + 1) * 0.5;
    const color = m.color || preset.palette.accent;

    ctx.save();
    ctx.translate(mx, my);

    // Expanding sonar ring
    ctx.beginPath();
    ctx.arc(0, 0, (12 + pulse * 18) * pop, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = (1 - pulse) * 0.65;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (m.kind === 'battle') {
      // 8-point conflict starburst
      const spikes = 8;
      const outerR = 13 * pop;
      const innerR = 6 * pop;
      ctx.beginPath();
      for (let s = 0; s < spikes * 2; s++) {
        const r = s % 2 === 0 ? outerR : innerR;
        const ang = (s * Math.PI) / spikes;
        const sx = Math.cos(ang) * r;
        const sy = Math.sin(ang) * r;
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 8 * pop, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Crisp city / location tag
    const tagSize = Math.max(13, Math.round(height * 0.022));
    ctx.font = `700 ${tagSize}px "Inter", system-ui, sans-serif`;
    const tw = ctx.measureText(m.label).width;
    const boxY = -tagSize * 1.95;
    ctx.fillStyle = isLightPaper ? 'rgba(28, 25, 23, 0.92)' : 'rgba(10, 17, 30, 0.9)';
    roundRectPath(ctx, -tw / 2 - 10, boxY, tw + 20, tagSize * 1.48, 5);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.label, 0, boxY + tagSize * 0.74);

    ctx.restore();
  });

  ctx.restore();

  // Top-left cartographic region label & subtle compass emblem
  ctx.save();
  const badgePad = Math.round(width * 0.028);
  const titleFont = Math.max(13, Math.round(height * 0.021));
  ctx.font = `700 ${titleFont}px "Inter", system-ui, sans-serif`;
  const regionLabel = regionData.label.toUpperCase();
  const rw = ctx.measureText(regionLabel).width;
  ctx.fillStyle = isLightPaper ? 'rgba(28, 25, 23, 0.88)' : 'rgba(9, 16, 28, 0.84)';
  roundRectPath(ctx, badgePad, badgePad, rw + 36, titleFont * 1.9, 6);
  ctx.fill();
  ctx.strokeStyle = preset.palette.accent;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = preset.palette.accent;
  ctx.beginPath();
  ctx.arc(badgePad + 14, badgePad + titleFont * 0.95, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(regionLabel, badgePad + 26, badgePad + titleFont * 0.96);
  ctx.restore();
}

function drawCalloutLeaderLines(
  ctx: CanvasRenderingContext2D,
  callouts: BeatCalloutItem[] | undefined,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number
) {
  if (!callouts || callouts.length === 0) return;
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const isLightPaper = isLightPaperPreset(presetId);

  const toNorm = (v: number, fallback: number): number => {
    if (!Number.isFinite(v)) return fallback;
    return v > 1 ? v / 100 : v;
  };

  callouts.slice(0, 3).forEach((item) => {
    const startFrac = item.appearAt ?? 0.16;
    const t = easeOutBack((localProgress - startFrac) / 0.22);
    if (t <= 0.02) return;

    const x = clamp(toNorm(item.x, 0.25), 0.12, 0.88) * width;
    const y = clamp(toNorm(item.y, 0.28), 0.14, 0.68) * height;
    const tx = clamp(toNorm(item.anchorX ?? 50, 0.5), 0.2, 0.8) * width;
    const ty = clamp(toNorm(item.anchorY ?? 48, 0.48), 0.2, 0.72) * height;

    ctx.save();
    // Leader line from target dot to callout card
    const lineT = clamp((localProgress - startFrac) / 0.16, 0, 1);
    const elbowX = lerp(tx, x, lineT);
    const elbowY = lerp(ty, y, lineT);

    ctx.strokeStyle = preset.palette.accent;
    ctx.lineWidth = Math.max(2, width * 0.0022);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(elbowX, elbowY);
    ctx.stroke();

    // Target dot
    ctx.fillStyle = preset.palette.accent;
    ctx.beginPath();
    ctx.arc(tx, ty, 5 * Math.min(1, t), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pop-in callout badge
    const labelFont = Math.max(13, Math.round(height * 0.021));
    const valFont = Math.max(16, Math.round(height * 0.026));
    ctx.font = `700 ${labelFont}px "Inter", system-ui, sans-serif`;
    const lw = ctx.measureText(item.label.toUpperCase()).width;
    let vw = 0;
    if (item.value) {
      ctx.font = `800 ${valFont}px "Inter", system-ui, sans-serif`;
      vw = ctx.measureText(item.value).width;
    }
    const cardW = Math.max(lw, vw) + 28;
    const cardH = item.value ? labelFont + valFont + 22 : labelFont + 18;

    ctx.translate(x, y);
    ctx.scale(t, t);

    ctx.shadowColor = 'rgba(0,0,0,0.34)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = isLightPaper ? '#FFFFFF' : '#161C2C';
    roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 8);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = isLightPaper ? '#1C1917' : preset.palette.accent;
    ctx.lineWidth = isLightPaper ? 2.4 : 1.8;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (item.value) {
      ctx.font = `700 ${labelFont * 0.85}px "Inter", system-ui, sans-serif`;
      ctx.fillStyle = isLightPaper ? '#57534E' : '#94A3B8';
      ctx.fillText(item.label.toUpperCase(), 0, -cardH * 0.2);

      ctx.font = `800 ${valFont}px "Inter", system-ui, sans-serif`;
      ctx.fillStyle = preset.palette.accent;
      ctx.fillText(item.value, 0, cardH * 0.2);
    } else {
      ctx.font = `700 ${labelFont}px "Inter", system-ui, sans-serif`;
      ctx.fillStyle = isLightPaper ? '#1C1917' : '#F8FAFC';
      ctx.fillText(item.label.toUpperCase(), 0, 1);
    }

    ctx.restore();
  });
}

function drawProceduralEditorialFallbackCard(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  presetId: VideoStylePresetId,
  x: number,
  y: number,
  w: number,
  h: number,
  localProgress: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { surface, accent, secondaryAccent: accentSecondary, ink: textPrimary, ink } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);

  ctx.save();
  ctx.fillStyle = surface;
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.fill();

  // Layered gouache / editorial geometric art inside stage
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.clip();

  // Horizon hills / abstract editorial silhouette
  const drift = easeInOutCubic(localProgress) * 28;
  ctx.fillStyle = accent;
  ctx.globalAlpha = paperMode ? 0.16 : 0.22;
  ctx.beginPath();
  ctx.arc(x + w * 0.78 - drift, y + h * 0.34, h * 0.36, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accentSecondary;
  ctx.globalAlpha = paperMode ? 0.18 : 0.24;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.52, x + w * 0.62, y + h * 0.72);
  ctx.quadraticCurveTo(x + w * 0.85, y + h * 0.85, x + w, y + h * 0.56);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  // Central focus emblem + highlight keywords
  ctx.globalAlpha = 1;
  const heading = (beat.onScreenText || beat.heroAssetTitle || 'Editorial Scene').slice(0, 42);
  const titleSize = Math.round(clamp(h * 0.11, 26, 58));
  ctx.font = `700 ${titleSize}px "Fraunces", Georgia, serif`;
  ctx.fillStyle = textPrimary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(heading, x + w / 2, y + h * 0.42, w * 0.84);

  // Decorative animated underline rule
  const ruleW = w * 0.24 * easeOutQuint(localProgress / 0.35);
  ctx.fillStyle = accent;
  ctx.fillRect(x + w / 2 - ruleW / 2, y + h * 0.54, ruleW, 5);

  const keywords = (beat.highlightWords || []).slice(0, 3);
  if (keywords.length > 0) {
    const tagFont = Math.max(14, Math.round(h * 0.036));
    ctx.font = `700 ${tagFont}px "Inter", system-ui, sans-serif`;
    const spacing = w / (keywords.length + 1);
    keywords.forEach((kw, idx) => {
      const pop = easeOutBack((localProgress - 0.15 - idx * 0.1) / 0.22);
      if (pop <= 0.02) return;
      const kx = x + spacing * (idx + 1);
      const ky = y + h * 0.72;
      const tw = ctx.measureText(kw.toUpperCase()).width;
      ctx.save();
      ctx.translate(kx, ky);
      ctx.scale(pop, pop);
      ctx.fillStyle = paperMode ? '#FFFFFF' : 'rgba(11, 15, 28, 0.78)';
      roundRectPath(ctx, -tw / 2 - 14, -tagFont * 0.9, tw + 28, tagFont * 1.8, 8);
      ctx.fill();
      ctx.strokeStyle = idx % 2 === 0 ? accent : accentSecondary;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = textPrimary;
      ctx.fillText(kw.toUpperCase(), 0, 1);
      ctx.restore();
    });
  }

  ctx.restore();

  // Crisp editorial border
  ctx.strokeStyle = paperMode ? ink : accent;
  ctx.lineWidth = paperMode ? 3 : 2;
  roundRectPath(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.restore();
}

function drawDiagramCalloutScene(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  img: HTMLImageElement | undefined,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { surface, accent, secondaryAccent: accentSecondary, ink: textPrimary, mutedInk: textMuted, ink } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);

  const padX = Math.round(width * 0.06);
  const topY = Math.round(height * 0.09);
  const stageW = width - padX * 2;
  const stageH = Math.round(height * 0.67);

  ctx.save();
  // Main diagram card
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = surface;
  roundRectPath(ctx, padX, topY, stageW, stageH, 16);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = paperMode ? ink : 'rgba(255,255,255,0.16)';
  ctx.lineWidth = paperMode ? 3 : 1.5;
  ctx.stroke();

  // Left half: Visual asset or stylized graphic; Right half: Animated comparative bars / breakdown
  const hasImg = Boolean(img && img.complete && img.naturalWidth > 0);
  const splitX = padX + Math.round(stageW * 0.52);

  if (hasImg && img) {
    const imgBoxX = padX + 24;
    const imgBoxY = topY + 24;
    const imgBoxW = splitX - padX - 40;
    const imgBoxH = stageH - 48;

    ctx.save();
    roundRectPath(ctx, imgBoxX, imgBoxY, imgBoxW, imgBoxH, 10);
    ctx.clip();
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = imgBoxW / imgBoxH;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgAspect > boxAspect) {
      sw = img.naturalHeight * boxAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / boxAspect;
      sy = (img.naturalHeight - sh) / 2;
    }
    const zoom = lerp(1.0, 1.07, localProgress);
    ctx.translate(imgBoxX + imgBoxW / 2, imgBoxY + imgBoxH / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, sx, sy, sw, sh, -imgBoxW / 2, -imgBoxH / 2, imgBoxW, imgBoxH);
    ctx.restore();

    ctx.strokeStyle = paperMode ? ink : accent;
    ctx.lineWidth = 2;
    roundRectPath(ctx, imgBoxX, imgBoxY, imgBoxW, imgBoxH, 10);
    ctx.stroke();
  } else {
    drawProceduralEditorialFallbackCard(
      ctx,
      beat,
      presetId,
      padX + 24,
      topY + 24,
      splitX - padX - 40,
      stageH - 48,
      localProgress
    );
  }

  // Right half: Animated infographic bars & key breakdown
  const panelX = splitX + 12;
  const panelW = padX + stageW - panelX - 28;
  const panelY = topY + 34;

  const headingFont = Math.max(20, Math.round(height * 0.036));
  ctx.font = `700 ${headingFont}px "Fraunces", Georgia, serif`;
  ctx.fillStyle = textPrimary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const cardHeading = (beat.onScreenText || beat.calloutItems?.[0]?.label || 'Key Breakdown').slice(0, 32);
  ctx.fillText(cardHeading, panelX, panelY, panelW);

  ctx.fillStyle = accent;
  ctx.fillRect(panelX, panelY + headingFont + 10, Math.min(90, panelW * 0.35), 4);

  const items =
    beat.calloutItems && beat.calloutItems.length > 0
      ? beat.calloutItems
      : (beat.highlightWords || ['Primary Factor', 'Scale', 'Outcome']).slice(0, 3).map((w, i) => ({
          label: w,
          value: i === 0 ? beat.dateBadge || 'KEY' : undefined,
          x: 0.5,
          y: 0.5,
        }));

  const barTop = panelY + headingFont + 40;
  const rowGap = Math.min(86, Math.round((stageH - (barTop - topY) - 24) / Math.max(1, items.length)));
  const labelFont = Math.max(13, Math.round(height * 0.021));

  items.slice(0, 3).forEach((item, idx) => {
    const grow = easeOutQuint((localProgress - 0.1 - idx * 0.14) / 0.38);
    const ry = barTop + idx * rowGap;
    const fillRatio = clamp(0.45 + ((idx * 37 + beat.orderIndex * 19) % 48) / 100, 0.35, 0.94) * grow;

    ctx.font = `700 ${labelFont}px "Inter", system-ui, sans-serif`;
    ctx.fillStyle = textPrimary;
    ctx.fillText(item.label.toUpperCase(), panelX, ry, panelW * 0.72);

    if (item.value) {
      ctx.textAlign = 'right';
      ctx.fillStyle = accent;
      ctx.fillText(item.value, panelX + panelW, ry);
      ctx.textAlign = 'left';
    }

    // Track
    const trackY = ry + labelFont + 10;
    const trackH = Math.max(14, Math.round(height * 0.022));
    ctx.fillStyle = paperMode ? 'rgba(28, 25, 23, 0.12)' : 'rgba(255, 255, 255, 0.1)';
    roundRectPath(ctx, panelX, trackY, panelW, trackH, 6);
    ctx.fill();

    // Animated fill bar
    if (fillRatio > 0.01) {
      ctx.fillStyle = idx % 2 === 0 ? accent : accentSecondary;
      roundRectPath(ctx, panelX, trackY, Math.max(12, panelW * fillRatio), trackH, 6);
      ctx.fill();
    }
  });

  // Footer micro-caption
  const subFont = Math.max(12, Math.round(height * 0.017));
  ctx.font = `500 ${subFont}px "Inter", system-ui, sans-serif`;
  ctx.fillStyle = textMuted;
  ctx.textBaseline = 'bottom';
  ctx.fillText(preset.referenceChannel.toUpperCase(), panelX, topY + stageH - 22);

  ctx.restore();
}

function drawKineticTitleScene(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  img: HTMLImageElement | undefined,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { accent, secondaryAccent: accentSecondary, ink: textPrimary, ink } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);

  // Optional subtle background image tint
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = paperMode ? 0.14 : 0.24;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = width / height;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgAspect > boxAspect) {
      sw = img.naturalHeight * boxAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / boxAspect;
      sy = (img.naturalHeight - sh) / 2;
    }
    const zoom = lerp(1.04, 1.14, localProgress);
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  const pop = easeOutBack(localProgress / 0.26);
  const titleText = (beat.onScreenText || beat.heroAssetTitle || 'Chapter One').toUpperCase();

  ctx.save();
  ctx.translate(width / 2, height * 0.43);
  ctx.scale(lerp(0.88, 1.0, Math.min(1, pop)), lerp(0.88, 1.0, Math.min(1, pop)));

  // Animated accent bar above title
  const barW = Math.min(160, width * 0.16) * easeOutQuint(localProgress / 0.3);
  ctx.fillStyle = accent;
  ctx.fillRect(-barW / 2, -height * 0.13, barW, 6);

  // Oversized kinetic headline (wrapped up to 2 lines cleanly)
  const fontSize = Math.round(clamp(height * 0.088, 42, 98));
  ctx.font = `800 ${fontSize}px "Fraunces", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const words = titleText.split(/\s+/).filter(Boolean);
  const mid = Math.ceil(words.length / 2);
  const lines = words.length > 3 ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [titleText];

  lines.forEach((line, idx) => {
    const ly = (idx - (lines.length - 1) / 2) * fontSize * 1.12;
    if (paperMode) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#FFFFFF';
      ctx.strokeText(line, 0, ly, width * 0.84);
      ctx.fillStyle = ink;
      ctx.fillText(line, 0, ly, width * 0.84);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = textPrimary;
      ctx.fillText(line, 0, ly, width * 0.84);
      ctx.shadowColor = 'transparent';
    }
  });

  if (beat.dateBadge) {
    const datePop = easeOutBack((localProgress - 0.14) / 0.25);
    if (datePop > 0.02) {
      const df = Math.max(18, Math.round(height * 0.032));
      ctx.font = `800 ${df}px "Inter", system-ui, sans-serif`;
      const dw = ctx.measureText(beat.dateBadge).width;
      const dy = (lines.length * fontSize * 0.56) + 34;
      ctx.save();
      ctx.translate(0, dy);
      ctx.scale(datePop, datePop);
      ctx.fillStyle = accentSecondary;
      roundRectPath(ctx, -dw / 2 - 20, -df * 0.8, dw + 40, df * 1.6, 8);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(beat.dateBadge, 0, 1);
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawIllustratedOrCutoutScene(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  img: HTMLImageElement | undefined,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number,
  timeMs: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { accent, ink } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);
  const isCutout = beat.sceneType === 'layered_cutout' || presetId === 'historically';
  const isSketch = presetId === 'simple_history' || presetId === 'minute_earth';

  // Hero stage occupies ~78% width x ~66% height cleanly above caption strip
  const stageW = Math.round(width * (isCutout ? 0.74 : 0.82));
  const stageH = Math.round(height * (isCutout ? 0.64 : 0.67));
  const cx = width / 2;
  const cy = height * 0.43;

  // Dynamic continuous camera motion inside the stage
  let panX = 0;
  let panY = 0;
  let zoom = 1.03;
  switch (beat.cameraMotion) {
    case 'push_in':
      zoom = lerp(1.0, 1.13, localProgress);
      break;
    case 'pull_back':
      zoom = lerp(1.13, 1.01, localProgress);
      break;
    case 'pan_left':
      panX = lerp(24, -24, localProgress);
      zoom = 1.08;
      break;
    case 'pan_right':
      panX = lerp(-24, 24, localProgress);
      zoom = 1.08;
      break;
    case 'orbit_drift':
      panX = Math.sin(localProgress * Math.PI) * 18;
      panY = Math.cos(localProgress * Math.PI) * 10;
      zoom = lerp(1.02, 1.08, localProgress);
      break;
    case 'focus_hold':
      zoom = lerp(1.02, 1.05, localProgress);
      break;
  }

  const floatY = Math.sin(timeMs / 900) * 4;
  const tiltDeg = isCutout ? (beat.orderIndex % 2 === 0 ? -1.4 : 1.4) : 0;

  ctx.save();
  ctx.translate(cx, cy + floatY);
  if (tiltDeg !== 0) ctx.rotate((tiltDeg * Math.PI) / 180);

  const halfW = stageW / 2;
  const halfH = stageH / 2;

  // Drop shadow & style-specific physical framing
  ctx.shadowColor = paperMode ? 'rgba(28, 25, 23, 0.25)' : 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = isCutout ? 36 : 28;
  ctx.shadowOffsetX = isCutout ? 10 : 0;
  ctx.shadowOffsetY = isCutout ? 18 : 14;

  if (isCutout) {
    // Crisp white sticker cutout border ("Historically" aesthetic)
    const border = Math.max(10, Math.round(width * 0.009));
    ctx.fillStyle = '#F8FAFC';
    roundRectPath(ctx, -halfW - border, -halfH - border, stageW + border * 2, stageH + border * 2, 16);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  } else if (isSketch) {
    // Double ink comic frame ("Simple History" & "MinuteEarth")
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, -halfW - 10, -halfH - 10, stageW + 20, stageH + 20, 10);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3.2;
    ctx.stroke();
  } else {
    ctx.fillStyle = preset.palette.surface;
    roundRectPath(ctx, -halfW, -halfH, stageW, stageH, 14);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }

  if (img && img.complete && img.naturalWidth > 0) {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const boxAspect = stageW / stageH;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgAspect > boxAspect) {
      sw = img.naturalHeight * boxAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / boxAspect;
      sy = (img.naturalHeight - sh) / 2;
    }

    ctx.save();
    roundRectPath(ctx, -halfW, -halfH, stageW, stageH, isCutout ? 8 : 12);
    ctx.clip();
    ctx.scale(zoom, zoom);
    ctx.translate(panX, panY);
    ctx.drawImage(img, sx, sy, sw, sh, -halfW, -halfH, stageW, stageH);

    // Subtle editorial vignette for non-paper dark modes
    if (!paperMode) {
      const vig = ctx.createRadialGradient(0, 0, stageW * 0.25, 0, 0, stageW * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = vig;
      ctx.fillRect(-halfW, -halfH, stageW, stageH);
    }
    ctx.restore();
  } else {
    drawProceduralEditorialFallbackCard(ctx, beat, presetId, -halfW, -halfH, stageW, stageH, localProgress);
  }

  // Trigger-word focus highlight bracket or sketch underline
  const triggerFrac = computeTriggerFraction(beat);
  if (localProgress >= triggerFrac) {
    const drawT = easeOutQuint((localProgress - triggerFrac) / 0.22);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    const c = 32 * drawT;
    const pad = 16;
    ctx.beginPath();
    ctx.moveTo(-halfW - pad, -halfH - pad + c);
    ctx.lineTo(-halfW - pad, -halfH - pad);
    ctx.lineTo(-halfW - pad + c, -halfH - pad);
    ctx.moveTo(halfW + pad, halfH + pad - c);
    ctx.lineTo(halfW + pad, halfH + pad);
    ctx.lineTo(halfW + pad - c, halfH + pad);
    ctx.stroke();
  }

  ctx.restore();

  // Pop-in callout leader lines over the illustration/cutout
  drawCalloutLeaderLines(ctx, beat.calloutItems, presetId, width, height, localProgress);
}

function drawArchivalVideoScene(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  video: HTMLVideoElement | undefined,
  posterImg: HTMLImageElement | undefined,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number,
  timeMs: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { accent, ink } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);

  const stageW = Math.round(width * 0.84);
  const stageH = Math.round(height * 0.68);
  const cx = width / 2;
  const cy = height * 0.43;
  const halfW = stageW / 2;
  const halfH = stageH / 2;

  const zoom =
    beat.cameraMotion === 'pull_back'
      ? lerp(1.08, 1.01, localProgress)
      : lerp(1.01, 1.07, localProgress);

  ctx.save();
  ctx.translate(cx, cy);

  // Clean broadcast frame shadow + bezel
  ctx.shadowColor = paperMode ? 'rgba(28, 25, 23, 0.28)' : 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#07080D';
  roundRectPath(ctx, -halfW - 6, -halfH - 6, stageW + 12, stageH + 12, 14);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = paperMode ? ink : accent;
  ctx.lineWidth = 2.4;
  ctx.stroke();

  const hasVideoFrame = Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  if (hasVideoFrame && video) {
    const vidAspect = video.videoWidth / video.videoHeight;
    const boxAspect = stageW / stageH;
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (vidAspect > boxAspect) {
      sw = video.videoHeight * boxAspect;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / boxAspect;
      sy = (video.videoHeight - sh) / 2;
    }
    ctx.save();
    roundRectPath(ctx, -halfW, -halfH, stageW, stageH, 10);
    ctx.clip();
    ctx.scale(zoom, zoom);
    ctx.drawImage(video, sx, sy, sw, sh, -halfW, -halfH, stageW, stageH);
    ctx.restore();
  } else if (posterImg && posterImg.complete && posterImg.naturalWidth > 0) {
    const imgAspect = posterImg.naturalWidth / posterImg.naturalHeight;
    const boxAspect = stageW / stageH;
    let sx = 0;
    let sy = 0;
    let sw = posterImg.naturalWidth;
    let sh = posterImg.naturalHeight;
    if (imgAspect > boxAspect) {
      sw = posterImg.naturalHeight * boxAspect;
      sx = (posterImg.naturalWidth - sw) / 2;
    } else {
      sh = posterImg.naturalWidth / boxAspect;
      sy = (posterImg.naturalHeight - sh) / 2;
    }
    ctx.save();
    roundRectPath(ctx, -halfW, -halfH, stageW, stageH, 10);
    ctx.clip();
    ctx.scale(zoom, zoom);
    ctx.drawImage(posterImg, sx, sy, sw, sh, -halfW, -halfH, stageW, stageH);
    ctx.restore();
  } else {
    drawProceduralEditorialFallbackCard(ctx, beat, presetId, -halfW, -halfH, stageW, stageH, localProgress);
  }

  // Crisp top-left live archival footage stamp
  const badgeFont = Math.max(12, Math.round(height * 0.018));
  ctx.font = `800 ${badgeFont}px "Inter", system-ui, sans-serif`;
  const tagText = 'ARCHIVAL FOOTAGE';
  const tw = ctx.measureText(tagText).width;
  const bx = -halfW + 16;
  const by = -halfH + 16;
  ctx.fillStyle = 'rgba(8, 10, 16, 0.84)';
  roundRectPath(ctx, bx, by, tw + 30, badgeFont * 1.75, 6);
  ctx.fill();
  ctx.fillStyle = accent;
  const dotPulse = 0.65 + 0.35 * Math.sin(timeMs / 240);
  ctx.globalAlpha = dotPulse;
  ctx.beginPath();
  ctx.arc(bx + 12, by + badgeFont * 0.88, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tagText, bx + 22, by + badgeFont * 0.9);

  ctx.restore();
  drawCalloutLeaderLines(ctx, beat.calloutItems, presetId, width, height, localProgress);
}

function drawDateTickerBadge(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number
) {
  const label = (beat.dateBadge || beat.mapSpec?.dateLabel || '').trim();
  if (!label) return;
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const isLightPaper = isLightPaperPreset(presetId);

  const enterT = easeOutBack(localProgress / 0.18);
  const pad = Math.round(width * 0.028);
  const fontSize = Math.max(15, Math.round(height * 0.026));

  ctx.save();
  ctx.font = `800 ${fontSize}px "Inter", system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const boxW = tw + 34;
  const boxH = fontSize * 1.75;
  const bx = width - pad - boxW;
  const by = pad;

  ctx.translate(bx + boxW / 2, by + boxH / 2);
  ctx.scale(lerp(0.82, 1.0, Math.min(1, enterT)), lerp(0.82, 1.0, Math.min(1, enterT)));

  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = isLightPaper ? '#1C1917' : 'rgba(11, 16, 28, 0.9)';
  roundRectPath(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 7);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.strokeStyle = preset.palette.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = preset.palette.accent;
  ctx.fillRect(-boxW / 2 + 8, -boxH / 2 + 8, 4, boxH - 16);

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 3, 1);
  ctx.restore();
}

function drawWordSyncedKineticCaptions(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  timeMs: number,
  localProgress: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { highlightBg, ink, accent } = preset.palette;
  const paperMode = isLightPaperPreset(presetId);
  const highlightText =
    presetId === 'historically' || presetId === 'archival_documentary' || presetId === 'ted_ed'
      ? '#0B0D14'
      : '#FFFFFF';

  const words =
    Array.isArray(beat.wordTimestamps) && beat.wordTimestamps.length > 0
      ? beat.wordTimestamps
      : (beat.narrationText || '')
          .split(/\s+/)
          .filter(Boolean)
          .map((w, i, arr) => {
            const span = Math.max(1, beat.endMs - beat.startMs);
            const slice = span / Math.max(1, arr.length);
            return {
              word: w,
              startMs: beat.startMs + i * slice,
              endMs: beat.startMs + (i + 1) * slice,
            };
          });

  if (words.length === 0) return;

  // Locate active spoken word
  let activeWordIdx = 0;
  for (let i = 0; i < words.length; i++) {
    if (timeMs >= words[i].startMs) activeWordIdx = i;
  }

  // Show a brisk, mobile-legible 6–7 word chunk around the active word
  const chunkSize = 6;
  const chunkIdx = Math.floor(activeWordIdx / chunkSize);
  const chunkStart = chunkIdx * chunkSize;
  const visibleWords = words.slice(chunkStart, chunkStart + chunkSize);
  const localActiveIdx = activeWordIdx - chunkStart;

  const fontSize = Math.round(clamp(height * 0.036, 18, 42));
  const yCenter = height - Math.round(height * 0.095);

  ctx.save();
  // Clean readability scrim at bottom for dark presets, crisp paper ribbon for light presets
  if (!paperMode) {
    const scrimH = Math.round(height * 0.24);
    const scrim = ctx.createLinearGradient(0, height - scrimH, 0, height);
    scrim.addColorStop(0, 'rgba(8, 10, 18, 0)');
    scrim.addColorStop(0.55, 'rgba(8, 10, 18, 0.72)');
    scrim.addColorStop(1, 'rgba(8, 10, 18, 0.92)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, height - scrimH, width, scrimH);
  }

  ctx.font = `700 ${fontSize}px "Inter", system-ui, sans-serif`;
  const spaceW = ctx.measureText(' ').width * 1.15;
  const wordWidths = visibleWords.map((w) => ctx.measureText(w.word).width);
  const totalW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, visibleWords.length - 1);

  // Subtle ribbon backing in paper modes so captions pop cleanly over illustrations/maps
  if (paperMode) {
    const padX = 22;
    const padY = 12;
    ctx.fillStyle = 'rgba(255, 252, 245, 0.93)';
    roundRectPath(ctx, width / 2 - totalW / 2 - padX, yCenter - fontSize * 0.62 - padY / 2, totalW + padX * 2, fontSize * 1.25 + padY, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(28, 25, 23, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const highlightSet = new Set((beat.highlightWords || []).map((h) => h.toLowerCase()));
  let cursorX = width / 2 - totalW / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  visibleWords.forEach((w, idx) => {
    const ww = wordWidths[idx];
    const isCurrent = idx === localActiveIdx;
    const isSpoken = idx < localActiveIdx;
    const cleanLower = w.word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const isKey = highlightSet.has(cleanLower);

    if (isCurrent) {
      // High-contrast kinetic highlight block with punchy spring-bounce scale pop on word onset
      const wordElapsed = Math.max(0, timeMs - w.startMs);
      const wordPop = lerp(1.13, 1.0, easeOutBack(clamp(wordElapsed / 170, 0, 1)));
      const padH = 10;
      const padV = 6;
      const cx = cursorX + ww / 2;

      ctx.save();
      ctx.translate(cx, yCenter);
      ctx.scale(wordPop, wordPop);
      ctx.fillStyle = highlightBg;
      roundRectPath(ctx, -ww / 2 - padH, -fontSize * 0.56 - padV / 2, ww + padH * 2, fontSize * 1.12 + padV, 8);
      ctx.fill();

      ctx.fillStyle = highlightText;
      ctx.fillText(w.word, -ww / 2, 1);
      ctx.restore();
    } else {
      ctx.fillStyle = paperMode
        ? isKey
          ? accent
          : isSpoken
          ? ink
          : 'rgba(28, 25, 23, 0.52)'
        : isKey
        ? accent
        : isSpoken
        ? '#F8FAFC'
        : 'rgba(241, 245, 249, 0.62)';
      ctx.fillText(w.word, cursorX, yCenter + 1);
    }

    cursorX += ww + spaceW;
  });

  // Top-of-beat concise display stamp if present (only when not a kinetic_title beat)
  const headline = (beat.onScreenText || '').trim();
  if (headline && beat.sceneType !== 'kinetic_title') {
    const fadeIn = clamp(localProgress / 0.14, 0, 1);
    const fadeOut = clamp((1 - localProgress) / 0.1, 0, 1);
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha > 0.02) {
      ctx.globalAlpha = alpha;
      const hFont = Math.max(14, Math.round(height * 0.022));
      ctx.font = `800 ${hFont}px "Inter", system-ui, sans-serif`;
      const hw = ctx.measureText(headline.toUpperCase()).width;
      const hx = width / 2;
      const hy = yCenter - fontSize * 1.25;
      ctx.fillStyle = paperMode ? ink : 'rgba(15, 23, 42, 0.86)';
      roundRectPath(ctx, hx - hw / 2 - 14, hy - hFont * 0.72, hw + 28, hFont * 1.44, 6);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.fillText(headline.toUpperCase(), hx, hy + 1);
    }
  }

  ctx.restore();
}

function applyBeatTransitionTransform(
  ctx: CanvasRenderingContext2D,
  beat: StoryboardBeat,
  width: number,
  height: number,
  localProgress: number,
  isFirstBeat: boolean
): number {
  if (isFirstBeat || localProgress >= 0.18) return 0;
  const t = clamp(localProgress / 0.18, 0, 1);
  const eased = easeOutQuint(t);
  const inv = 1 - eased;

  switch (beat.transition) {
    case 'whip_pan':
      ctx.translate(inv * width * 0.38, 0);
      return Math.sin(t * Math.PI);
    case 'paper_slide':
      ctx.translate(0, inv * height * 0.24);
      return Math.sin(t * Math.PI) * 0.4;
    case 'zoom_punch': {
      const z = lerp(1.22, 1.0, eased);
      ctx.translate(width / 2, height / 2);
      ctx.scale(z, z);
      ctx.translate(-width / 2, -height / 2);
      return Math.sin(t * Math.PI) * 0.5;
    }
    case 'cut_pop': {
      const s = lerp(0.88, 1.0, easeOutBack(t));
      ctx.translate(width / 2, height / 2);
      ctx.scale(s, s);
      ctx.translate(-width / 2, -height / 2);
      return 0;
    }
    case 'iris_reveal': {
      const maxR = Math.hypot(width, height) * 0.65;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.max(20, maxR * eased), 0, Math.PI * 2);
      ctx.clip();
      return 0;
    }
    default:
      ctx.translate(inv * width * 0.12, 0);
      return Math.sin(t * Math.PI) * 0.25;
  }
}

export function renderWorldFrame(
  ctx: CanvasRenderingContext2D,
  timeMs: number,
  config: RenderWorldConfig
) {
  const { width, height, beats, images, videos, deskTexture } = config;
  const presetId = resolveEffectivePreset(config);
  const preset = VIDEO_STYLE_PRESETS[presetId];
  const { beat, index, localProgress } = getActiveBeatAtTime(beats, timeMs);

  drawPresetBackdrop(ctx, presetId, width, height, timeMs, deskTexture);

  if (!beat) {
    // Clean empty-state editorial title frame
    ctx.save();
    ctx.fillStyle = preset.palette.ink;
    ctx.font = `700 ${Math.round(height * 0.06)}px "Fraunces", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.projectTitle || 'CineForge Studio', width / 2, height / 2, width * 0.8);
    ctx.restore();
    return;
  }

  const img = beat.heroAssetUrl ? images.get(beat.heroAssetUrl) : undefined;
  const vid = beat.heroVideoUrl ? videos?.get(beat.heroVideoUrl) : undefined;
  const sceneType =
    beat.sceneType ||
    (beat.heroVideoUrl || beat.objectType === 'video_clip'
      ? 'archival_video'
      : beat.animatedRigSpec || beat.objectType === 'animated_rig'
      ? 'animated_rig'
      : beat.objectType === 'map'
      ? 'animated_map'
      : beat.objectType === 'title_card'
      ? 'kinetic_title'
      : beat.objectType === 'diagram'
      ? 'diagram_callout'
      : beat.objectType === 'cutout'
      ? 'layered_cutout'
      : 'illustrated_scene');

  ctx.save();
  const motionBlurFactor = applyBeatTransitionTransform(ctx, beat, width, height, localProgress, index === 0);

  if (sceneType === 'archival_video') {
    drawArchivalVideoScene(ctx, beat, vid, img, presetId, width, height, localProgress, timeMs);
  } else if (sceneType === 'animated_rig' && beat.animatedRigSpec) {
    drawAnimatedRigScene(ctx, beat.animatedRigSpec, presetId, width, height, localProgress, timeMs);
    drawCalloutLeaderLines(ctx, beat.calloutItems, presetId, width, height, localProgress);
  } else if (sceneType === 'animated_map') {
    drawAnimatedMapScene(ctx, beat, presetId, width, height, localProgress, timeMs);
  } else if (sceneType === 'diagram_callout') {
    drawDiagramCalloutScene(ctx, beat, img, presetId, width, height, localProgress);
  } else if (sceneType === 'kinetic_title') {
    drawKineticTitleScene(ctx, beat, img, presetId, width, height, localProgress);
  } else {
    drawIllustratedOrCutoutScene(ctx, beat, img, presetId, width, height, localProgress, timeMs);
  }
  ctx.restore();

  // Subtle whip-pan speed lines during high-velocity transitions
  if (motionBlurFactor > 0.2) {
    ctx.save();
    ctx.globalAlpha = motionBlurFactor * 0.14;
    ctx.fillStyle = preset.palette.accent;
    for (let i = 0; i < 6; i++) {
      const y = ((i * 193 + Math.floor(timeMs * 0.25)) % height);
      ctx.fillRect(0, y, width, 2);
    }
    ctx.restore();
  }

  // Date/Year ticker badge (top-right)
  drawDateTickerBadge(ctx, beat, presetId, width, height, localProgress);

  // Word-synced kinetic narration highlight bar (bottom)
  drawWordSyncedKineticCaptions(ctx, beat, presetId, width, height, timeMs, localProgress);

  // Subtle timeline progress bar along very bottom edge
  if (config.totalDurationMs > 0) {
    const pct = clamp(timeMs / config.totalDurationMs, 0, 1);
    ctx.fillStyle = isLightPaperPreset(presetId) ? 'rgba(28,25,23,0.12)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, height - 4, width, 4);
    ctx.fillStyle = preset.palette.accent;
    ctx.fillRect(0, height - 4, width * pct, 4);
  }

  // Optional title safe guides in editor preview
  if (config.showSafeGuides) {
    ctx.save();
    ctx.strokeStyle = 'rgba(229, 160, 58, 0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
    ctx.restore();
  }
}
