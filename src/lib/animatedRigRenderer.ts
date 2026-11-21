import {
  VIDEO_STYLE_PRESETS,
  type AnimatedRigActor,
  type AnimatedRigBackdrop,
  type AnimatedRigParticles,
  type AnimatedRigSpec,
  type VideoStylePresetId,
} from '../types/cineforge';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

function easeOutBack(t: number): number {
  const c = clamp(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

function easeInOutQuad(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, rx: number, ry: number, offsetY = 0) {
  ctx.save();
  ctx.fillStyle = 'rgba(7, 11, 24, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, offsetY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParallaxBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: AnimatedRigBackdrop,
  spec: AnimatedRigSpec,
  presetId: VideoStylePresetId,
  w: number,
  h: number,
  tSec: number,
  progress: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically;
  const pal = preset.palette;
  const panShift = (progress - 0.5) * w * 0.08;

  // Sky / primary canvas gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  if (spec.skyTopColor && spec.skyBottomColor) {
    skyGrad.addColorStop(0, spec.skyTopColor);
    skyGrad.addColorStop(1, spec.skyBottomColor);
  } else {
    switch (backdrop) {
      case 'sky_outback':
        skyGrad.addColorStop(0, '#0EA5E9');
        skyGrad.addColorStop(0.55, '#38BDF8');
        skyGrad.addColorStop(1, '#FDE68A');
        break;
      case 'night_cosmos':
        skyGrad.addColorStop(0, '#070B1E');
        skyGrad.addColorStop(0.6, '#151B45');
        skyGrad.addColorStop(1, '#2D1B54');
        break;
      case 'modern_city':
        skyGrad.addColorStop(0, '#0F172A');
        skyGrad.addColorStop(0.58, '#1E3A8A');
        skyGrad.addColorStop(1, '#FB7185');
        break;
      case 'ocean_horizon':
        skyGrad.addColorStop(0, '#0284C7');
        skyGrad.addColorStop(0.54, '#38BDF8');
        skyGrad.addColorStop(1, '#0F172A');
        break;
      case 'parliament_hall':
        skyGrad.addColorStop(0, '#101533');
        skyGrad.addColorStop(0.7, '#1E2952');
        skyGrad.addColorStop(1, '#283566');
        break;
      case 'lab_grid':
        skyGrad.addColorStop(0, '#081226');
        skyGrad.addColorStop(1, '#122645');
        break;
      case 'mountain_dawn':
        skyGrad.addColorStop(0, '#1E1B4B');
        skyGrad.addColorStop(0.5, '#EC4899');
        skyGrad.addColorStop(1, '#FDBA74');
        break;
      case 'studio_grid':
      default:
        skyGrad.addColorStop(0, pal.bg);
        skyGrad.addColorStop(1, pal.bgSecondary);
        break;
    }
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  const horizonY = h * 0.68;

  if (backdrop === 'sky_outback' || backdrop === 'mountain_dawn') {
    // Glowing stylized sun + rings
    const sunX = w * 0.78 - panShift * 0.2;
    const sunY = h * 0.24;
    const sunR = Math.min(w, h) * 0.11;
    const pulse = 1 + Math.sin(tSec * 2.2) * 0.04;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 214, 102, 0.22)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.55 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Stylized drifting flat-vector clouds
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 4; i++) {
      const cx = ((w * (0.14 + i * 0.27) + tSec * (18 + i * 5) - panShift * 0.3) % (w + 260)) - 130;
      const cy = h * (0.14 + (i % 2) * 0.11);
      const cw = w * (0.11 + (i % 3) * 0.025);
      drawRoundedRect(ctx, cx - cw / 2, cy, cw, cw * 0.28, cw * 0.14);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - cw * 0.16, cy, cw * 0.18, 0, Math.PI * 2);
      ctx.arc(cx + cw * 0.12, cy - cw * 0.03, cw * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Distant parallax mesas / mountain peaks
    ctx.save();
    ctx.fillStyle = backdrop === 'mountain_dawn' ? '#4C1D95' : '#E07A5F';
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let i = 0; i <= 8; i++) {
      const mx = (i / 8) * (w + 180) - 90 - panShift * 0.45;
      const peakH =
        backdrop === 'mountain_dawn'
          ? h * (0.14 + (i % 2) * 0.14 + Math.sin(i * 1.7) * 0.04)
          : h * (0.08 + (i % 3 === 1 ? 0.09 : 0.03));
      ctx.lineTo(mx, horizonY - peakH);
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fill();

    // Midground rolling hills
    ctx.fillStyle = backdrop === 'mountain_dawn' ? '#7C3AED' : '#F4A261';
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 12);
    for (let x = 0; x <= w; x += 24) {
      const y =
        horizonY -
        h * 0.035 +
        Math.sin((x + panShift * 0.75) * 0.0085) * h * 0.03 +
        Math.cos((x + panShift * 0.75) * 0.017) * h * 0.014;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // Vivid foreground ground plane
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, spec.groundColor || (backdrop === 'mountain_dawn' ? '#312E81' : '#F59E0B'));
    groundGrad.addColorStop(1, backdrop === 'mountain_dawn' ? '#1E1B4B' : '#D97706');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Animated scrolling wheat/grass stalks in foreground for real motion feel
    const grassColor = backdrop === 'mountain_dawn' ? 'rgba(167, 139, 250, 0.35)' : '#FDE047';
    ctx.strokeStyle = grassColor;
    ctx.lineWidth = Math.max(2, w * 0.0022);
    ctx.lineCap = 'round';
    const stalkSpacing = Math.max(22, w / 42);
    const scrollOffset = (tSec * 52 + panShift * 1.5) % stalkSpacing;
    for (let x = -stalkSpacing; x < w + stalkSpacing; x += stalkSpacing) {
      const sx = x - scrollOffset;
      const sway = Math.sin(tSec * 4.5 + x * 0.05) * 6;
      const sh = 14 + (Math.abs(Math.sin(x * 0.13)) * 12);
      ctx.beginPath();
      ctx.moveTo(sx, horizonY + 16);
      ctx.quadraticCurveTo(sx + sway * 0.5, horizonY + 16 - sh * 0.6, sx + sway, horizonY + 16 - sh);
      ctx.stroke();
    }
    ctx.restore();
  } else if (backdrop === 'night_cosmos') {
    // Glowing Kurzgesagt nebula orbs & orbit rings
    ctx.save();
    const orbX = w * 0.72 - panShift * 0.25;
    const orbY = h * 0.34;
    const neb = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, w * 0.34);
    neb.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
    neb.addColorStop(0.5, 'rgba(168, 85, 247, 0.18)');
    neb.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);

    // Twinkling stars
    for (let i = 0; i < 48; i++) {
      const sx = pseudoRandom(i + 1) * w;
      const sy = pseudoRandom(i + 91) * h * 0.85;
      const r = 1.2 + pseudoRandom(i + 37) * 2.4;
      const alpha = 0.35 + 0.65 * Math.abs(Math.sin(tSec * (1.5 + (i % 4)) + i));
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Concentric orbital rings
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1.5;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.55, w * 0.18 * r, h * 0.12 * r, -0.14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Curved planetary horizon at bottom
    ctx.fillStyle = spec.groundColor || '#1E1B4B';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 1.18, w * 0.78, h * 0.48, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  } else if (backdrop === 'modern_city') {
    // Sunset / dusk glow + parallax skyscrapers with lit windows
    ctx.save();
    const layers = [
      { color: '#1E293B', speed: 0.3, scale: 0.28, count: 14 },
      { color: '#0F172A', speed: 0.65, scale: 0.4, count: 10 },
    ];
    layers.forEach((layer, li) => {
      ctx.fillStyle = layer.color;
      const bw = w / layer.count;
      for (let i = -1; i <= layer.count + 1; i++) {
        const bh = h * layer.scale * (0.45 + pseudoRandom(i * 13 + li * 77) * 0.75);
        const bx = i * bw - panShift * layer.speed;
        const by = horizonY - bh;
        ctx.fillStyle = layer.color;
        ctx.fillRect(bx + 4, by, bw - 8, bh + 20);
        // Lit modern windows
        ctx.fillStyle = li === 1 ? '#FDE047' : 'rgba(56, 189, 248, 0.55)';
        const rows = Math.floor(bh / 22);
        const cols = Math.max(2, Math.floor((bw - 20) / 16));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (pseudoRandom(i * 31 + r * 7 + c * 11 + li) > 0.42) {
              ctx.fillRect(bx + 12 + c * 14, by + 12 + r * 20, 7, 10);
            }
          }
        }
      }
    });
    // Street surface with scrolling lane dashes
    ctx.fillStyle = spec.groundColor || '#1E293B';
    ctx.fillRect(0, horizonY, w, h - horizonY);
    ctx.fillStyle = '#FFC300';
    const dashStep = 72;
    const dashShift = (tSec * 90) % dashStep;
    for (let x = -dashStep; x < w + dashStep; x += dashStep) {
      drawRoundedRect(ctx, x - dashShift, horizonY + (h - horizonY) * 0.45, 36, 6, 3);
      ctx.fill();
    }
    ctx.restore();
  } else if (backdrop === 'ocean_horizon') {
    // Vivid sunlit sky + 3 animated layered wave ribbons
    ctx.save();
    const sunX = w * 0.25 - panShift * 0.2;
    const sunY = h * 0.26;
    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(w, h) * 0.085, 0, Math.PI * 2);
    ctx.fill();

    const waveColors = ['#0369A1', '#0284C7', '#0E315E'];
    waveColors.forEach((wc, wi) => {
      ctx.fillStyle = wc;
      ctx.beginPath();
      const baseY = h * (0.56 + wi * 0.11);
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 18) {
        const y =
          baseY +
          Math.sin(x * (0.012 + wi * 0.004) + tSec * (2.6 + wi * 0.9)) * (8 + wi * 4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  } else if (backdrop === 'parliament_hall') {
    // Grand stylized colonnade + spotlight beams
    ctx.save();
    const colCount = 6;
    const colW = w * 0.055;
    for (let i = 0; i < colCount; i++) {
      const cx = (w / (colCount + 1)) * (i + 1) - colW / 2 - panShift * 0.35;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(cx, h * 0.12, colW, horizonY - h * 0.12);
      ctx.fillStyle = 'rgba(255, 195, 0, 0.28)';
      ctx.fillRect(cx - 6, h * 0.12, colW + 12, 12);
    }
    // Sweeping spotlight cone
    const spotX = w * 0.5 + Math.sin(tSec * 1.1) * w * 0.14;
    const spotGrad = ctx.createLinearGradient(spotX, 0, spotX, horizonY);
    spotGrad.addColorStop(0, 'rgba(255, 214, 102, 0.26)');
    spotGrad.addColorStop(1, 'rgba(255, 214, 102, 0)');
    ctx.fillStyle = spotGrad;
    ctx.beginPath();
    ctx.moveTo(spotX - 40, 0);
    ctx.lineTo(spotX + 40, 0);
    ctx.lineTo(spotX + w * 0.26, horizonY);
    ctx.lineTo(spotX - w * 0.26, horizonY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = spec.groundColor || '#172047';
    ctx.fillRect(0, horizonY, w, h - horizonY);
    ctx.fillStyle = pal.accent;
    ctx.fillRect(0, horizonY, w, 4);
    ctx.restore();
  } else {
    // studio_grid & lab_grid: crisp modern Vox / Kurzgesagt geometric stage
    ctx.save();
    const gridStep = Math.max(36, Math.round(w / 22));
    const offsetX = (tSec * 18) % gridStep;
    const isLight = presetId === 'minute_earth' || presetId === 'simple_history';
    ctx.strokeStyle = isLight ? 'rgba(20, 33, 61, 0.08)' : 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    for (let x = -gridStep; x < w + gridStep; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x - offsetX, 0);
      ctx.lineTo(x - offsetX, horizonY);
      ctx.stroke();
    }
    for (let y = 0; y < horizonY; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Accent geometric halo behind center stage
    const haloR = Math.min(w, h) * 0.34;
    const haloGrad = ctx.createRadialGradient(w * 0.5, h * 0.44, 12, w * 0.5, h * 0.44, haloR);
    haloGrad.addColorStop(0, `${spec.accentColor || pal.accent}33`);
    haloGrad.addColorStop(1, `${spec.accentColor || pal.accent}00`);
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.44, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Rotating dashed telemetry ring for lab_grid
    if (backdrop === 'lab_grid') {
      ctx.save();
      ctx.translate(w * 0.5, h * 0.45);
      ctx.rotate(tSec * 0.25);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Ground platform ribbon
    ctx.fillStyle = spec.groundColor || (isLight ? '#E2E8F0' : 'rgba(255, 255, 255, 0.06)');
    ctx.fillRect(0, horizonY, w, h - horizonY);
    ctx.fillStyle = spec.accentColor || pal.accent;
    ctx.fillRect(0, horizonY, w, 4);
    ctx.restore();
  }
}

function drawWeatherParticles(
  ctx: CanvasRenderingContext2D,
  particles: AnimatedRigParticles,
  accentColor: string,
  w: number,
  h: number,
  tSec: number
) {
  if (particles === 'none') return;
  ctx.save();
  if (particles === 'speed_lines') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const y = h * (0.08 + pseudoRandom(i + 11) * 0.72);
      const len = 55 + pseudoRandom(i + 3) * 110;
      const x = w - (((tSec * (540 + i * 28) + i * 190) % (w + len * 2)) - len);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  } else if (particles === 'dust') {
    for (let i = 0; i < 20; i++) {
      const speed = 75 + (i % 5) * 26;
      const x = w - ((tSec * speed + i * 97) % (w + 60)) + 30;
      const y = h * 0.62 + pseudoRandom(i + 5) * h * 0.24 + Math.sin(tSec * 4 + i) * 6;
      const r = 4 + (i % 4) * 3.5;
      ctx.fillStyle = 'rgba(254, 240, 138, 0.36)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (particles === 'sparks') {
    for (let i = 0; i < 22; i++) {
      const x = ((pseudoRandom(i + 2) * w + tSec * (40 + (i % 4) * 15)) % w);
      const y = h - ((tSec * (90 + (i % 5) * 24) + i * 53) % (h * 0.9));
      const r = 2 + (i % 3) * 1.8;
      ctx.fillStyle = i % 2 === 0 ? '#FFC300' : accentColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (particles === 'rain') {
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const x = (pseudoRandom(i + 7) * w - tSec * 110 + w * 10) % w;
      const y = (pseudoRandom(i + 19) * h + tSec * 420) % h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8, y + 22);
      ctx.stroke();
    }
  } else if (particles === 'stars' || particles === 'data_dots') {
    for (let i = 0; i < 24; i++) {
      const x = (pseudoRandom(i + 15) * w + Math.sin(tSec + i) * 14 + w) % w;
      const y = (pseudoRandom(i + 41) * h * 0.8 + Math.cos(tSec * 0.8 + i) * 10 + h) % h;
      const r = particles === 'data_dots' ? 3.5 : 2.2;
      ctx.fillStyle = i % 3 === 0 ? accentColor : 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// --- Stylized Flat-Vector (Vox / Kurzgesagt) Articulated Actors ---

function drawHumanActor(
  ctx: CanvasRenderingContext2D,
  actor: AnimatedRigActor,
  phase: number,
  primary: string,
  accent: string
) {
  const isMoving = actor.action === 'walk' || actor.action === 'run' || actor.action === 'march';
  const freq = actor.action === 'run' ? 2.1 : actor.action === 'march' ? 1.5 : 1.2;
  const strideAmp = actor.action === 'run' ? 0.65 : actor.action === 'march' ? 0.52 : isMoving ? 0.42 : 0.06;
  const stride = Math.sin(phase * freq) * strideAmp;
  const bounce = isMoving ? Math.abs(Math.sin(phase * freq)) * (actor.action === 'run' ? -10 : -5) : Math.sin(phase * 0.9) * 2.5;
  const lean = actor.action === 'run' ? 0.16 : actor.action === 'march' ? 0.06 : 0;

  drawGroundShadow(ctx, 26, 7, 56);

  ctx.save();
  ctx.translate(0, bounce);
  ctx.rotate(lean);

  // Back leg
  ctx.save();
  ctx.translate(-5, 16);
  ctx.rotate(-stride);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 34);
  ctx.stroke();
  ctx.restore();

  // Front leg
  ctx.save();
  ctx.translate(6, 16);
  ctx.rotate(stride);
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 10.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 34);
  ctx.stroke();
  // Boot highlight
  ctx.fillStyle = accent;
  drawRoundedRect(ctx, -5, 30, 14, 7, 3);
  ctx.fill();
  ctx.restore();

  // Back arm
  const armSwing =
    actor.action === 'gesture'
      ? -1.15 + Math.sin(phase * 2.2) * 0.35
      : -stride * 1.1;
  ctx.save();
  ctx.translate(-12, -16);
  ctx.rotate(armSwing);
  ctx.strokeStyle = primary;
  ctx.lineWidth = 8.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 26);
  ctx.stroke();
  ctx.restore();

  // Stylized Torso (Kurzgesagt pill-trapezoid)
  ctx.fillStyle = primary;
  drawRoundedRect(ctx, -17, -24, 34, 44, 14);
  ctx.fill();

  // Role-specific outfit details
  if (actor.kind === 'scientist') {
    ctx.fillStyle = '#F8FAFC';
    drawRoundedRect(ctx, -18, -23, 36, 46, 12);
    ctx.fill();
    // Tie / collar
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-4, -22);
    ctx.lineTo(4, -22);
    ctx.lineTo(2, -2);
    ctx.lineTo(-2, -2);
    ctx.closePath();
    ctx.fill();
  } else if (actor.kind === 'soldier') {
    // Belt & cross-strap
    ctx.strokeStyle = '#78350F';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-14, -20);
    ctx.lineTo(14, 10);
    ctx.stroke();
    ctx.fillStyle = '#451A03';
    ctx.fillRect(-17, 6, 34, 6);
  } else if (actor.kind === 'leader') {
    // Diagonal sash & lapel
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-13, -20);
    ctx.lineTo(13, 14);
    ctx.stroke();
  } else if (actor.kind === 'farmer') {
    // Overalls straps
    ctx.fillStyle = '#1D4ED8';
    drawRoundedRect(ctx, -16, -2, 32, 22, 8);
    ctx.fill();
    ctx.fillRect(-11, -22, 5, 22);
    ctx.fillRect(6, -22, 5, 22);
  }

  // Subtle rim highlight on torso
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  drawRoundedRect(ctx, -14, -21, 9, 36, 4);
  ctx.fill();

  // Head
  ctx.fillStyle = '#FDBA74';
  ctx.beginPath();
  ctx.arc(0, -40, 15, 0, Math.PI * 2);
  ctx.fill();
  // Expressive eye dot
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(6, -42, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Role headwear
  if (actor.kind === 'soldier') {
    // Iconic Australian slouch / expedition hat
    ctx.fillStyle = '#B45309';
    drawRoundedRect(ctx, -23, -53, 44, 6, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -52, 13, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(-12, -55, 24, 3.5);
  } else if (actor.kind === 'farmer') {
    // Wide straw sun hat
    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.ellipse(0, -51, 25, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -52, 12, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (actor.kind === 'scientist') {
    // Glasses + sleek hair
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.arc(-2, -45, 14, Math.PI * 0.95, Math.PI * 2.02);
    ctx.fill();
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(6, -42, 5.2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (actor.kind === 'leader') {
    // Crest / formal cap
    ctx.fillStyle = '#1E293B';
    drawRoundedRect(ctx, -14, -57, 28, 10, 4);
    ctx.fill();
    ctx.fillStyle = '#FFC300';
    ctx.fillRect(-14, -50, 28, 3);
  } else {
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.arc(-1, -44, 15, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fill();
  }

  // Front gesturing / prop-holding arm
  const frontArmAngle =
    actor.action === 'gesture'
      ? -1.45 - Math.sin(phase * 2.8) * 0.35
      : stride * 1.15;
  ctx.save();
  ctx.translate(12, -16);
  ctx.rotate(frontArmAngle);
  ctx.strokeStyle = actor.kind === 'scientist' ? '#E2E8F0' : primary;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 27);
  ctx.stroke();

  // Held prop
  if (actor.kind === 'scientist') {
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(0, 32, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(-2, 30, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (actor.kind === 'leader') {
    // Flag/pointer staff
    ctx.strokeStyle = '#FFC300';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 25);
    ctx.lineTo(0, -14);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(22, -7);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
  } else if (actor.kind === 'soldier') {
    // Field megaphone / spotting scope
    ctx.fillStyle = '#334155';
    drawRoundedRect(ctx, -3, 22, 22, 6, 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}

function drawBirdOrEmuActor(
  ctx: CanvasRenderingContext2D,
  actor: AnimatedRigActor,
  phase: number,
  primary: string,
  accent: string
) {
  if (actor.action === 'fly') {
    // Soaring / flapping Kurzgesagt bird
    const flap = Math.sin(phase * 2.8);
    ctx.save();
    ctx.translate(0, Math.sin(phase * 2.8) * 8);
    // Back wing
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.quadraticCurveTo(-18, -28 * flap - 10, -34, -18 * flap);
    ctx.lineTo(-8, 6);
    ctx.closePath();
    ctx.fill();
    // Sleek body
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 13, -0.08, 0, Math.PI * 2);
    ctx.fill();
    // Head + beak
    ctx.beginPath();
    ctx.arc(24, -6, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFC300';
    ctx.beginPath();
    ctx.moveTo(31, -8);
    ctx.lineTo(44, -4);
    ctx.lineTo(31, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(26, -8, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Front wing
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-12, 30 * flap - 6, -32, 22 * flap);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  // Stylized tall running Emu / Flightless Bird (super recognizable & energetic!)
  const stride = Math.sin(phase * 2.5) * 0.78;
  const bob = Math.abs(Math.sin(phase * 2.5)) * -9;
  const neckBob = Math.sin(phase * 2.5 - 0.6) * 6;

  drawGroundShadow(ctx, 28, 7, 54);

  ctx.save();
  ctx.translate(0, bob);

  // Back running leg
  ctx.save();
  ctx.translate(-4, 14);
  ctx.rotate(-stride);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 5.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, 18);
  ctx.lineTo(4, 38);
  ctx.stroke();
  ctx.restore();

  // Front running leg
  ctx.save();
  ctx.translate(4, 14);
  ctx.rotate(stride);
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, 18);
  ctx.lineTo(5, 38);
  ctx.stroke();
  ctx.restore();

  // Plumed oval body
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.ellipse(-2, 2, 30, 21, -0.14, 0, Math.PI * 2);
  ctx.fill();

  // Tail plumage feathers
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-24, -4);
  ctx.lineTo(-42, 4 + Math.sin(phase * 3) * 3);
  ctx.lineTo(-34, 16);
  ctx.lineTo(-20, 12);
  ctx.closePath();
  ctx.fill();

  // Layered feather highlight arc
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath();
  ctx.ellipse(-4, -3, 18, 10, -0.14, 0, Math.PI * 2);
  ctx.fill();

  // Long expressive S-curved neck
  ctx.strokeStyle = primary;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16, -6);
  ctx.quadraticCurveTo(28 + neckBob * 0.4, -26, 22 + neckBob * 0.5, -44);
  ctx.stroke();

  // Head + bright eye + beak
  const hx = 24 + neckBob * 0.5;
  const hy = -46;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(hx, hy, 10, 0, Math.PI * 2);
  ctx.fill();
  // Beak
  ctx.fillStyle = '#FFC300';
  ctx.beginPath();
  ctx.moveTo(hx + 7, hy - 3);
  ctx.lineTo(hx + 22, hy + 1);
  ctx.lineTo(hx + 7, hy + 4);
  ctx.closePath();
  ctx.fill();
  // Bright eye
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(hx + 3, hy - 2.5, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.arc(hx + 4, hy - 2.5, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Speed dust puff behind feet
  const puffAlpha = 0.25 + 0.35 * Math.abs(Math.sin(phase * 2.5));
  ctx.fillStyle = `rgba(254, 240, 138, ${puffAlpha.toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(-26 - Math.abs(stride) * 14, 46, 6, 0, Math.PI * 2);
  ctx.arc(-36 - Math.abs(stride) * 18, 42, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawQuadrupedAnimalActor(
  ctx: CanvasRenderingContext2D,
  phase: number,
  primary: string,
  accent: string
) {
  const stride = Math.sin(phase * 2.2) * 0.6;
  const bob = Math.abs(Math.sin(phase * 2.2)) * -7;
  drawGroundShadow(ctx, 34, 7, 42);

  ctx.save();
  ctx.translate(0, bob);
  // Legs
  const legs = [
    { x: -20, rot: -stride, col: '#1E293B' },
    { x: -12, rot: stride, col: primary },
    { x: 14, rot: stride, col: '#1E293B' },
    { x: 22, rot: -stride, col: primary },
  ];
  for (const leg of legs) {
    ctx.save();
    ctx.translate(leg.x, 8);
    ctx.rotate(leg.rot);
    ctx.strokeStyle = leg.col;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 28);
    ctx.stroke();
    ctx.restore();
  }
  // Body
  ctx.fillStyle = primary;
  drawRoundedRect(ctx, -28, -14, 56, 26, 13);
  ctx.fill();
  // Head & ear
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(30, -14, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(24, -24);
  ctx.lineTo(28, -36);
  ctx.lineTo(35, -24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(34, -16, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVehicleActor(
  ctx: CanvasRenderingContext2D,
  actor: AnimatedRigActor,
  phase: number,
  primary: string,
  accent: string
) {
  if (actor.kind === 'truck') {
    const rumble = Math.sin(phase * 8) * 2.5;
    drawGroundShadow(ctx, 56, 9, 36);

    ctx.save();
    ctx.translate(0, rumble);

    // Exhaust puffs trailing left
    for (let i = 0; i < 3; i++) {
      const p = ((phase * 0.7 + i * 0.33) % 1);
      ctx.fillStyle = `rgba(226, 232, 240, ${(0.65 * (1 - p)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(-58 - p * 38, 16 - p * 22, 5 + p * 9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cargo bed
    ctx.fillStyle = primary;
    drawRoundedRect(ctx, -54, -22, 68, 42, 7);
    ctx.fill();
    // Accent stripe
    ctx.fillStyle = accent;
    ctx.fillRect(-54, 4, 68, 7);

    // Cab
    ctx.fillStyle = primary;
    drawRoundedRect(ctx, 12, -16, 40, 36, 8);
    ctx.fill();
    // Windshield
    ctx.fillStyle = '#38BDF8';
    drawRoundedRect(ctx, 22, -10, 24, 15, 4);
    ctx.fill();
    // Headlamp beam
    ctx.fillStyle = 'rgba(253, 224, 71, 0.36)';
    ctx.beginPath();
    ctx.moveTo(52, 4);
    ctx.lineTo(96, -8);
    ctx.lineTo(96, 22);
    ctx.lineTo(52, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FDE047';
    ctx.fillRect(49, 4, 5, 9);

    // Rotating spoked wheels
    [-30, 30].forEach((wx) => {
      ctx.save();
      ctx.translate(wx, 22);
      ctx.rotate(phase * 3.8);
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
      ctx.stroke();
      ctx.restore();
    });

    ctx.restore();
  } else if (actor.kind === 'ship') {
    const rock = Math.sin(phase * 1.4) * 0.06;
    const bob = Math.sin(phase * 1.8) * 5;
    ctx.save();
    ctx.translate(0, bob);
    ctx.rotate(rock);
    // Smokestacks + drifting steam
    ctx.fillStyle = accent;
    drawRoundedRect(ctx, -20, -40, 14, 24, 3);
    ctx.fill();
    drawRoundedRect(ctx, 2, -36, 14, 20, 3);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const p = (phase * 0.5 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(255,255,255,${(0.6 * (1 - p)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(-14 - p * 36, -46 - p * 26, 6 + p * 8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bridge
    ctx.fillStyle = '#F8FAFC';
    drawRoundedRect(ctx, -32, -20, 62, 20, 5);
    ctx.fill();
    // Hull
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(-58, 0);
    ctx.lineTo(62, 0);
    ctx.lineTo(44, 24);
    ctx.lineTo(-46, 24);
    ctx.closePath();
    ctx.fill();
    // Waterline foam
    ctx.strokeStyle = '#7DD3FC';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-64, 26);
    ctx.lineTo(64, 26);
    ctx.stroke();
    ctx.restore();
  } else if (actor.kind === 'plane') {
    const bank = Math.sin(phase * 1.6) * 0.08;
    ctx.save();
    ctx.rotate(bank);
    // Contrail
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-48, 0);
    ctx.lineTo(-112, 2);
    ctx.stroke();
    // Fuselage
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(0, 0, 44, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tail & wings
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-36, -4);
    ctx.lineTo(-48, -26);
    ctx.lineTo(-24, -4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-18, -32);
    ctx.lineTo(12, 0);
    ctx.closePath();
    ctx.fill();
    // Cockpit
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.ellipse(22, -4, 12, 5, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    // Rocket (Kurzgesagt sleek launch!)
    const tremble = Math.sin(phase * 16) * 1.5;
    ctx.save();
    ctx.translate(tremble, 0);
    // Flickering plasma exhaust plume
    const flameLen = 36 + Math.sin(phase * 22) * 12;
    ctx.fillStyle = '#FF5A5F';
    ctx.beginPath();
    ctx.moveTo(-14, 30);
    ctx.lineTo(14, 30);
    ctx.lineTo(0, 30 + flameLen);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.moveTo(-8, 30);
    ctx.lineTo(8, 30);
    ctx.lineTo(0, 30 + flameLen * 0.62);
    ctx.closePath();
    ctx.fill();
    // Fins
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-18, 10);
    ctx.lineTo(-34, 34);
    ctx.lineTo(-14, 30);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18, 10);
    ctx.lineTo(34, 34);
    ctx.lineTo(14, 30);
    ctx.closePath();
    ctx.fill();
    // Body
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.quadraticCurveTo(22, -20, 18, 30);
    ctx.lineTo(-18, 30);
    ctx.quadraticCurveTo(-22, -20, 0, -48);
    ctx.closePath();
    ctx.fill();
    // Nosecone
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.quadraticCurveTo(13, -34, 14, -22);
    ctx.lineTo(-14, -22);
    ctx.quadraticCurveTo(-13, -34, 0, -48);
    ctx.closePath();
    ctx.fill();
    // Glowing porthole
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(0, -2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
}

function drawMotionGraphicObject(
  ctx: CanvasRenderingContext2D,
  actor: AnimatedRigActor,
  phase: number,
  localProgress: number,
  primary: string,
  accent: string
) {
  if (actor.kind === 'gear') {
    const drawSingleGear = (gx: number, gy: number, r: number, teeth: number, rot: number, col: string) => {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(rot);
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i * Math.PI) / teeth;
        const rad = i % 2 === 0 ? r + 8 : r - 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0B1024';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    drawSingleGear(-18, 4, 28, 10, phase * 0.9, primary);
    drawSingleGear(24, -18, 19, 8, -phase * 1.125 + 0.3, accent);
  } else if (actor.kind === 'chart_bar') {
    const grow = easeOutBack(clamp(localProgress * 1.7, 0, 1));
    const heights = [34, 62, 48, 92];
    const barW = 20;
    const gap = 10;
    const startX = -((heights.length * (barW + gap)) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(startX - 10, 42, heights.length * (barW + gap) + 12, 4);
    heights.forEach((bh, idx) => {
      const hVal = Math.max(8, bh * grow + Math.sin(phase * 1.8 + idx) * 3);
      ctx.fillStyle = idx === heights.length - 1 ? accent : primary;
      drawRoundedRect(ctx, startX + idx * (barW + gap), 42 - hVal, barW, hVal, 5);
      ctx.fill();
    });
  } else if (actor.kind === 'globe') {
    const r = 40;
    ctx.save();
    // Outer atmosphere halo
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.24, 0, Math.PI * 2);
    ctx.fill();
    // Ocean sphere
    ctx.fillStyle = '#0284C7';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Rotating latitude/longitude wireframe
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    const drift = ((phase * 16) % (r * 2)) - r;
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.ellipse(drift - 12, -10, 20, 14, 0.3, 0, Math.PI * 2);
    ctx.ellipse(drift + 24, 14, 18, 12, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(4, Math.abs(Math.cos(phase * 0.5 + i * 0.6)) * r), r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // Orbiting satellite dot
    const satX = Math.cos(phase * 1.6) * (r * 1.42);
    const satY = Math.sin(phase * 1.6) * (r * 0.52);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(satX, satY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (actor.kind === 'building') {
    const pop = easeOutBack(clamp(localProgress * 2, 0, 1));
    ctx.save();
    ctx.scale(1, Math.max(0.2, pop));
    ctx.fillStyle = primary;
    drawRoundedRect(ctx, -36, -42, 72, 84, 6);
    ctx.fill();
    // Pediment roof
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-42, -40);
    ctx.lineTo(0, -64);
    ctx.lineTo(42, -40);
    ctx.closePath();
    ctx.fill();
    // Columns / windows
    ctx.fillStyle = '#F8FAFC';
    for (let c = -24; c <= 24; c += 16) {
      drawRoundedRect(ctx, c - 4, -30, 8, 56, 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (actor.kind === 'clock') {
    const r = 38;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 7;
    ctx.stroke();
    // Minute & hour hands
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(phase * 2.5 - Math.PI / 2) * 24, Math.sin(phase * 2.5 - Math.PI / 2) * 24);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(phase * 0.4 - Math.PI / 2) * 16, Math.sin(phase * 0.4 - Math.PI / 2) * 16);
    ctx.stroke();
  } else if (actor.kind === 'lightning') {
    const pulse = 1 + Math.sin(phase * 6) * 0.1;
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255, 195, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFC300';
    ctx.beginPath();
    ctx.moveTo(8, -42);
    ctx.lineTo(-22, 4);
    ctx.lineTo(-2, 4);
    ctx.lineTo(-10, 42);
    ctx.lineTo(24, -6);
    ctx.lineTo(2, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (actor.kind === 'coin') {
    const spinW = Math.max(0.22, Math.abs(Math.cos(phase * 2.2)));
    ctx.save();
    ctx.scale(spinW, 1);
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#B45309';
    ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 2);
    ctx.restore();
  } else {
    // document / dossier card with animated highlight bars
    const tilt = Math.sin(phase * 1.4) * 0.05;
    ctx.save();
    ctx.rotate(tilt);
    ctx.fillStyle = '#FFFDF7';
    drawRoundedRect(ctx, -32, -40, 64, 80, 6);
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = primary;
    drawRoundedRect(ctx, -22, -28, 44, 10, 3);
    ctx.fill();
    const scanW = 18 + Math.abs(Math.sin(phase * 1.6)) * 26;
    ctx.fillStyle = accent;
    drawRoundedRect(ctx, -22, -10, scanW, 7, 3);
    ctx.fill();
    ctx.fillStyle = '#94A3B8';
    drawRoundedRect(ctx, -22, 4, 38, 6, 3);
    ctx.fill();
    drawRoundedRect(ctx, -22, 16, 30, 6, 3);
    ctx.fill();
    ctx.restore();
  }
}

function drawSingleActorInstance(
  ctx: CanvasRenderingContext2D,
  actor: AnimatedRigActor,
  phase: number,
  localProgress: number,
  primary: string,
  accent: string
) {
  switch (actor.kind) {
    case 'person':
    case 'soldier':
    case 'scientist':
    case 'leader':
    case 'farmer':
      drawHumanActor(ctx, actor, phase, primary, accent);
      break;
    case 'bird':
      drawBirdOrEmuActor(ctx, actor, phase, primary, accent);
      break;
    case 'animal':
      drawQuadrupedAnimalActor(ctx, phase, primary, accent);
      break;
    case 'truck':
    case 'ship':
    case 'plane':
    case 'rocket':
      drawVehicleActor(ctx, actor, phase, primary, accent);
      break;
    default:
      drawMotionGraphicObject(ctx, actor, phase, localProgress, primary, accent);
      break;
  }
}

export function drawAnimatedRigScene(
  ctx: CanvasRenderingContext2D,
  spec: AnimatedRigSpec,
  presetId: VideoStylePresetId,
  width: number,
  height: number,
  localProgress: number,
  timeMs: number
) {
  const preset = VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically;
  const pal = preset.palette;
  const tSec = timeMs / 1000;
  const p = clamp(localProgress, 0, 1);

  ctx.save();

  // Dynamic camera energy (spring punch / tracking pan / subtle zoom)
  let camScale = 1.0;
  let camOffsetX = 0;
  let camOffsetY = 0;
  if (spec.cameraStyle === 'dynamic_zoom') {
    camScale = 1.0 + p * 0.08;
  } else if (spec.cameraStyle === 'spring_punch') {
    camScale = 0.94 + easeOutBack(clamp(p * 3.2, 0, 1)) * 0.08;
  } else if (spec.cameraStyle === 'tracking_pan') {
    camScale = 1.05;
    camOffsetX = (0.5 - p) * width * 0.04;
  } else {
    camScale = 1.02 + Math.sin(p * Math.PI) * 0.03;
    camOffsetY = Math.sin(tSec * 1.2) * 3;
  }

  ctx.translate(width / 2 + camOffsetX, height / 2 + camOffsetY);
  ctx.scale(camScale, camScale);
  ctx.translate(-width / 2, -height / 2);

  // 1. Multi-layer parallax backdrop
  drawParallaxBackdrop(ctx, spec.backdrop || 'studio_grid', spec, presetId, width, height, tSec, p);

  // 2. Background weather/speed particles
  drawWeatherParticles(ctx, spec.weatherParticles || 'none', spec.accentColor || pal.accent, width, height, tSec);

  // 3. Draw all articulated flat-vector actors (sorted by Y for natural depth)
  const baseUnit = Math.min(width / 1280, height / 720);
  const actorsSorted = [...(spec.actors || [])].sort((a, b) => a.startY - b.startY);

  for (let ai = 0; ai < actorsSorted.length; ai++) {
    const actor = actorsSorted[ai];
    const appearAt = clamp(actor.appearAt ?? 0, 0, 0.7);
    if (p < appearAt) continue;

    const actorProgress = clamp((p - appearAt) / Math.max(0.15, 1 - appearAt), 0, 1);
    const popScale = easeOutBack(clamp(actorProgress * 3.8, 0, 1));
    const moveT = easeInOutQuad(actorProgress);

    const count = clamp(Math.round(actor.count ?? 1), 1, 6);
    const primary = actor.color || (ai % 2 === 0 ? pal.accent : pal.secondaryAccent);
    const accent = actor.accentColor || (ai % 2 === 0 ? pal.secondaryAccent : '#38BDF8');
    const actorScale = clamp(actor.scale ?? 1.0, 0.5, 2.0) * baseUnit * 1.22;

    // Direction facing: auto-face travel direction unless flipX explicitly flips
    const dx = actor.endX - actor.startX;
    const autoFlip = dx < -2;
    const shouldFlip = actor.flipX ? !autoFlip : autoFlip;

    for (let ci = 0; ci < count; ci++) {
      const spreadX = count > 1 ? (ci - (count - 1) / 2) * 5.8 : 0;
      const spreadY = count > 1 ? ((ci % 2) * 3.4 - 1.7) : 0;
      const depthScale = count > 1 ? 0.86 + (ci % 3) * 0.09 : 1.0;

      let posX = ((actor.startX + (actor.endX - actor.startX) * moveT + spreadX) / 100) * width;
      let posY = ((actor.startY + (actor.endY - actor.startY) * moveT + spreadY) / 100) * height;

      // Action-specific extra organic trajectories
      const phase = tSec * 5.2 + ai * 1.7 + ci * 1.15;
      if (actor.action === 'bounce') {
        posY -= Math.abs(Math.sin(phase * 1.4)) * 22 * baseUnit;
      } else if (actor.action === 'orbit') {
        posX += Math.cos(phase * 0.7) * 32 * baseUnit;
        posY += Math.sin(phase * 0.7) * 18 * baseUnit;
      } else if (actor.action === 'idle_sway') {
        posY += Math.sin(phase * 0.9) * 5 * baseUnit;
      }

      ctx.save();
      ctx.translate(posX, posY);
      const pulseFactor = actor.action === 'pulse' ? 1 + Math.sin(phase * 1.8) * 0.08 : 1;
      const finalScale = actorScale * depthScale * popScale * pulseFactor;
      ctx.scale(shouldFlip ? -finalScale : finalScale, finalScale);

      drawSingleActorInstance(ctx, actor, phase, actorProgress, primary, accent);
      ctx.restore();

      // Actor floating callout tag (render once on lead unit)
      if (ci === 0 && actor.label && actorProgress > 0.15) {
        const tagAlpha = easeOutCubic(clamp((actorProgress - 0.15) * 4, 0, 1));
        ctx.save();
        ctx.globalAlpha = tagAlpha;
        ctx.font = `700 ${Math.round(14 * Math.max(0.8, baseUnit))}px "Plus Jakarta Sans", sans-serif`;
        const text = actor.label.toUpperCase();
        const tw = ctx.measureText(text).width + 22;
        const th = 26 * Math.max(0.85, baseUnit);
        const tagX = clamp(posX - tw / 2, 18, width - tw - 18);
        const tagY = clamp(posY - 84 * actorScale, 20, height - 120);

        ctx.fillStyle = 'rgba(11, 16, 36, 0.88)';
        drawRoundedRect(ctx, tagX, tagY, tw, th, 6);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tagX + tw / 2, tagY + th / 2 + 0.5);
        ctx.restore();
      }
    }
  }

  ctx.restore();

  // 4. Optional Animated Count-Up Metric Overlay (e.g., 0 -> 20,000 EMUS)
  if (spec.counterStat && Number.isFinite(spec.counterStat.targetValue)) {
    const countT = easeOutCubic(clamp(p * 1.45, 0, 1));
    const currentVal = Math.round(spec.counterStat.targetValue * countT);
    const formatted = `${spec.counterStat.prefix || ''}${currentVal.toLocaleString('en-US')}${spec.counterStat.suffix || ''}`;
    const pop = easeOutBack(clamp(p * 3.5, 0, 1));

    ctx.save();
    const cardW = Math.min(width * 0.34, 340 * Math.max(0.75, baseUnit));
    const cardH = 88 * Math.max(0.75, baseUnit);
    const cardX = width - cardW - 28 * Math.max(0.75, baseUnit);
    const cardY = 26 * Math.max(0.75, baseUnit);

    ctx.translate(cardX + cardW / 2, cardY + cardH / 2);
    ctx.scale(pop, pop);
    ctx.translate(-(cardX + cardW / 2), -(cardY + cardH / 2));

    ctx.fillStyle = 'rgba(11, 16, 36, 0.88)';
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = spec.accentColor || pal.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = spec.accentColor || pal.accent;
    ctx.font = `800 ${Math.round(34 * Math.max(0.75, baseUnit))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(formatted, cardX + 18, cardY + 12);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = `700 ${Math.round(13 * Math.max(0.75, baseUnit))}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(spec.counterStat.label.toUpperCase().slice(0, 32), cardX + 18, cardY + cardH - 26);
    ctx.restore();
  }
}
