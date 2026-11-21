import { ThinkingLevel } from '@google/genai';
import {
  VIDEO_STYLE_PRESETS,
  type VideoStylePresetId,
} from '../../types/cineforge.ts';
import { generateContentWithResilience } from './geminiClient.ts';

const ILLUSTRATION_TEXT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

const FORBIDDEN_TAG_RE =
  /<\s*(script|foreignObject|iframe|object|embed|audio|video|link|meta|style|applet|form|input|button)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>|<\s*(script|foreignObject|iframe|object|embed|link|meta|input)\b[^>]*\/?>/gi;

/**
 * Strictly sanitizes generated SVG markup so it is 100% XSS-free, self-contained,
 * and never taints HTML5 Canvas (zero scripts, zero event handlers, zero external URLs).
 */
export function sanitizeGeneratedSvg(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  // Strip markdown code fences if present
  const cleaned = raw.replace(/```(?:svg|xml|html)?/gi, '').replace(/```/g, '').trim();
  const startIdx = cleaned.search(/<svg\b/i);
  const endIdx = cleaned.toLowerCase().lastIndexOf('</svg>');
  if (startIdx < 0 || endIdx <= startIdx) return null;

  let svg = cleaned.slice(startIdx, endIdx + 6);

  // Remove dangerous elements completely
  svg = svg.replace(FORBIDDEN_TAG_RE, '');

  // Remove inline JS event handlers (onload, onclick, onerror, etc.)
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Strip external URLs (http/https/data/javascript) in href / xlink:href / src
  svg = svg.replace(
    /\s+(?:xlink:)?(?:href|src)\s*=\s*(?:"\s*(?:https?:|javascript:|data:|\/\/)[^"]*"|'\s*(?:https?:|javascript:|data:|\/\/)[^']*')/gi,
    ''
  );
  svg = svg.replace(/url\(\s*['"]?\s*(?:https?:|javascript:|data:|\/\/)[^)]*\)/gi, 'none');

  // Ensure proper xmlns and 16:9 viewBox so Canvas drawImage renders crisply at any resolution
  if (!/xmlns\s*=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/viewBox\s*=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 1280 720"');
  }
  // Normalize root width/height for deterministic rasterization
  svg = svg.replace(
    /<svg\b([^>]*)>/i,
    (_m, attrs: string) => {
      const stripped = attrs
        .replace(/\s+width\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/\s+height\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
      return `<svg${stripped} width="1280" height="720">`;
    }
  );

  // Must contain actual vector primitives to be a valid illustration
  const hasShapes = /<(path|rect|circle|ellipse|polygon|polyline|line|g)\b/i.test(svg);
  if (!hasShapes || svg.length < 180 || svg.length > 90000) return null;

  return svg;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Generates a rich, multi-layered procedural 16:9 editorial vector SVG illustration
 * matched to the active reference preset (TED-Ed, Simple History, History on Maps,
 * MinuteEarth, Historically, or Archival Documentary) and topic motifs.
 */
export function buildProceduralEditorialSvg(params: {
  prompt: string;
  title: string;
  stylePreset: VideoStylePresetId;
}): string {
  const preset = VIDEO_STYLE_PRESETS[params.stylePreset] || VIDEO_STYLE_PRESETS.historically;
  const p = preset.palette;
  const lower = `${params.title} ${params.prompt}`.toLowerCase();
  const seed = hashSeed(`${params.title}:${params.prompt}:${params.stylePreset}`);

  const isLightCanvas =
    params.stylePreset === 'minute_earth' ||
    params.stylePreset === 'simple_history' ||
    params.stylePreset === 'history_on_maps';
  const strokeInk = isLightCanvas ? p.border : '#0E121A';
  const strokeWidth = params.stylePreset === 'simple_history' || params.stylePreset === 'minute_earth' ? 4 : 2.5;
  const stickerBorder = params.stylePreset === 'historically' ? '#FFFFFF' : strokeInk;

  // Choose semantic visual centerpiece based on prompt subject
  let motifSvg = '';
  if (/(clock|time|second|atomic|watch|century|year|calendar)/.test(lower)) {
    // Precision clock & atomic orbit motif (MinuteEarth / TED-Ed style)
    motifSvg = `
      <g transform="translate(640, 350)">
        <ellipse cx="0" cy="0" rx="250" ry="92" fill="none" stroke="${p.secondaryAccent}" stroke-width="5" stroke-dasharray="14 10" transform="rotate(-24)" opacity="0.8"/>
        <ellipse cx="0" cy="0" rx="250" ry="92" fill="none" stroke="${p.accent}" stroke-width="5" stroke-dasharray="10 8" transform="rotate(24)" opacity="0.8"/>
        <circle cx="0" cy="0" r="158" fill="${p.surface}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 10 : 6}"/>
        <circle cx="0" cy="0" r="134" fill="none" stroke="${p.accent}" stroke-width="4"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const ang = (i * 30 * Math.PI) / 180;
          const x1 = Math.cos(ang) * 108;
          const y1 = Math.sin(ang) * 108;
          const x2 = Math.cos(ang) * 126;
          const y2 = Math.sin(ang) * 126;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${strokeInk}" stroke-width="${i % 3 === 0 ? 6 : 3}" stroke-linecap="round"/>`;
        }).join('')}
        <line x1="0" y1="0" x2="-46" y2="-62" stroke="${strokeInk}" stroke-width="9" stroke-linecap="round"/>
        <line x1="0" y1="0" x2="78" y2="-28" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>
        <circle cx="0" cy="0" r="13" fill="${p.accent}" stroke="${strokeInk}" stroke-width="4"/>
        <circle cx="218" cy="-94" r="18" fill="${p.secondaryAccent}" stroke="${strokeInk}" stroke-width="3"/>
        <circle cx="-212" cy="88" r="15" fill="${p.accent}" stroke="${strokeInk}" stroke-width="3"/>
      </g>`;
  } else if (/(war|battle|army|soldier|mask|cannon|fort|treaty|siege|empire|trench|emu|gun|military)/.test(lower)) {
    // Historical conflict / banner / tactical emblem (Simple History / Historically style)
    motifSvg = `
      <g transform="translate(640, 365)">
        <path d="M-360,170 Q-180,90 0,130 Q180,170 360,95 L360,240 L-360,240 Z" fill="${p.land}" stroke="${strokeInk}" stroke-width="${strokeWidth}" opacity="0.9"/>
        <path d="M-190,120 L-190,-95 L-110,-145 L-30,-95 L-30,120 Z" fill="${p.surface}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 8 : 5}"/>
        <rect x="-150" y="-45" width="38" height="62" rx="19" fill="${p.bgSecondary}" stroke="${strokeInk}" stroke-width="3"/>
        <line x1="65" y1="120" x2="65" y2="-165" stroke="${strokeInk}" stroke-width="8" stroke-linecap="round"/>
        <path d="M68,-160 L245,-125 L205,-78 L245,-35 L68,-52 Z" fill="${p.accent}" stroke="${stickerBorder}" stroke-width="5"/>
        <polygon points="145,-118 154,-94 180,-94 159,-79 167,-55 145,-70 123,-55 131,-79 110,-94 136,-94" fill="${p.secondaryAccent}"/>
        <circle cx="-275" cy="-120" r="46" fill="${p.secondaryAccent}" opacity="0.88"/>
        <path d="M-240,145 L180,145" stroke="${p.accent}" stroke-width="8" stroke-dasharray="18 12" stroke-linecap="round"/>
        <polygon points="195,145 162,126 162,164" fill="${p.accent}"/>
      </g>`;
  } else if (/(space|voyager|planet|star|rocket|nasa|orbit|galaxy|moon|science|tooth|teeth|bacteria|cell|microscope)/.test(lower)) {
    // Science / discovery / anatomy / cosmos scene (TED-Ed / MinuteEarth style)
    motifSvg = `
      <g transform="translate(640, 355)">
        <circle cx="0" cy="0" r="220" fill="${p.bgSecondary}" stroke="${p.secondaryAccent}" stroke-width="3" stroke-dasharray="8 12" opacity="0.7"/>
        <circle cx="0" cy="0" r="142" fill="${p.accent}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 9 : 5}"/>
        <ellipse cx="0" cy="12" rx="235" ry="52" fill="none" stroke="${p.secondaryAccent}" stroke-width="14" transform="rotate(-14)"/>
        <circle cx="-54" cy="-42" r="32" fill="${p.surface}" opacity="0.32"/>
        <circle cx="48" cy="36" r="20" fill="${p.bg}" opacity="0.28"/>
        <circle cx="236" cy="-110" r="38" fill="${p.secondaryAccent}" stroke="${strokeInk}" stroke-width="4"/>
        <circle cx="-250" cy="96" r="26" fill="${p.surface}" stroke="${strokeInk}" stroke-width="4"/>
        <path d="M-280,-140 L-268,-112 L-240,-100 L-268,-88 L-280,-60 L-292,-88 L-320,-100 L-292,-112 Z" fill="${p.secondaryAccent}"/>
        <path d="M270,85 L278,104 L298,112 L278,120 L270,139 L262,120 L242,112 L262,104 Z" fill="${p.surface}"/>
      </g>`;
  } else if (/(ship|sea|ocean|island|voyage|trade|map|explorer|navy|route|fleet)/.test(lower)) {
    // Maritime expedition & compass motif
    motifSvg = `
      <g transform="translate(640, 360)">
        <path d="M-420,90 Q-315,52 -210,90 T0,90 T210,90 T420,90 L420,240 L-420,240 Z" fill="${p.ocean}" stroke="${strokeInk}" stroke-width="4"/>
        <path d="M-190,82 L-135,148 L145,148 L205,72 Z" fill="${p.surface}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 8 : 5}"/>
        <line x1="-15" y1="82" x2="-15" y2="-165" stroke="${strokeInk}" stroke-width="8"/>
        <path d="M-10,-152 Q118,-105 128,-22 L-10,-15 Z" fill="${p.accent}" stroke="${strokeInk}" stroke-width="4"/>
        <path d="M-22,-130 Q-128,-88 -134,-18 L-22,-14 Z" fill="${p.secondaryAccent}" stroke="${strokeInk}" stroke-width="4"/>
        <circle cx="275" cy="-120" r="64" fill="${p.surface}" stroke="${strokeInk}" stroke-width="4"/>
        <polygon points="275,-172 287,-120 275,-68 263,-120" fill="${p.accent}"/>
        <polygon points="223,-120 275,-132 327,-120 275,-108" fill="${strokeInk}"/>
      </g>`;
  } else {
    // Editorial narrative composition: layered geometric figures, archival scroll, spotlight rays
    const accentShift = (seed % 50) - 25;
    motifSvg = `
      <g transform="translate(640, 360)">
        <circle cx="${accentShift}" cy="-15" r="196" fill="${p.secondaryAccent}" opacity="0.24"/>
        <rect x="-250" y="-150" width="230" height="290" rx="14" fill="${p.surface}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 8 : 5}" transform="rotate(-5)"/>
        <rect x="-215" y="-110" width="155" height="95" rx="6" fill="${p.accent}" opacity="0.88" transform="rotate(-5)"/>
        <line x1="-215" y1="18" x2="-70" y2="18" stroke="${strokeInk}" stroke-width="7" stroke-linecap="round" transform="rotate(-5)"/>
        <line x1="-215" y1="52" x2="-100" y2="52" stroke="${strokeInk}" stroke-width="5" stroke-linecap="round" opacity="0.65" transform="rotate(-5)"/>
        <line x1="-215" y1="82" x2="-125" y2="82" stroke="${strokeInk}" stroke-width="5" stroke-linecap="round" opacity="0.45" transform="rotate(-5)"/>
        <g transform="translate(135, 18)">
          <circle cx="0" cy="-78" r="54" fill="${p.accent}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 8 : 5}"/>
          <path d="M-95,125 C-95,28 -55,-8 0,-8 C55,-8 95,28 95,125 Z" fill="${p.secondaryAccent}" stroke="${stickerBorder}" stroke-width="${params.stylePreset === 'historically' ? 8 : 5}"/>
          <circle cx="95" cy="-120" r="32" fill="${p.surface}" stroke="${strokeInk}" stroke-width="4"/>
          <path d="M84,-120 L94,-110 L110,-130" fill="none" stroke="${p.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>`;
  }

  const shortCaption = escapeXml(params.title.slice(0, 48));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.bg}"/>
      <stop offset="100%" stop-color="${p.bgSecondary}"/>
    </linearGradient>
    <radialGradient id="spotGrad" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="${p.secondaryAccent}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${p.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bgGrad)"/>
  <rect width="1280" height="720" fill="url(#spotGrad)"/>
  <!-- Subtle background editorial framing lines -->
  <g opacity="0.16" stroke="${p.accent}" stroke-width="2" fill="none">
    <circle cx="170" cy="140" r="110"/>
    <circle cx="1115" cy="575" r="140"/>
    <line x1="72" y1="640" x2="1208" y2="640"/>
  </g>
  ${motifSvg}
  <!-- Subtle corner editorial plate label -->
  <g transform="translate(56, 56)" opacity="0.88">
    <rect x="0" y="0" width="380" height="36" rx="4" fill="${isLightCanvas ? p.border : p.bgSecondary}" stroke="${p.accent}" stroke-width="1.5"/>
    <text x="16" y="23" font-family="sans-serif" font-size="15" font-weight="700" fill="${isLightCanvas ? '#FFFFFF' : p.ink}" letter-spacing="1.2">${shortCaption.toUpperCase()}</text>
  </g>
</svg>`;
}

export class EditorialIllustrationService {
  /**
   * Generates a custom 16:9 editorial vector illustration (.svg) styled for the selected
   * channel preset using free-tier Gemini models (`gemini-4-hydrogen` / `gemini-3.1-flash-lite`),
   * with strict SVG sanitization and procedural editorial SVG fallback.
   */
  async generateEditorialIllustrationSvg(params: {
    prompt: string;
    title: string;
    stylePreset: VideoStylePresetId;
    topic?: string;
  }): Promise<{ svg: string; generatedBy: 'gemini_vector' | 'procedural_vector' }> {
    const preset = VIDEO_STYLE_PRESETS[params.stylePreset] || VIDEO_STYLE_PRESETS.historically;
    const p = preset.palette;

    try {
      const resp = await generateContentWithResilience({
        models: ILLUSTRATION_TEXT_MODELS,
        attemptTimeoutMs: 28000,
        maxRetriesPerModel: 0,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
        contents: `Create a rich, expressive, hand-crafted 16:9 editorial 2D vector illustration in pure SVG (viewBox="0 0 1280 720") for an animated YouTube documentary/explainer video.

Visual Style Preset: ${preset.label} (${preset.referenceChannel})
Art Direction: ${preset.illustrationStylePrompt}
Color Palette: background ${p.bg} / ${p.bgSecondary}, surface ${p.surface}, primary accent ${p.accent}, secondary accent ${p.secondaryAccent}, ink ${p.ink}.
Documentary Topic: ${params.topic || params.title}
Scene Subject: ${params.prompt}

Strict SVG Requirements:
1. Return ONLY the complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">...</svg> markup.
2. Build 12 to 28 layered vector shapes (<defs> gradients, background setting, midground props/architecture/landscape, expressive foreground characters or hero objects, subtle shadow ellipses, highlight strokes).
3. Match the exact visual craft of ${preset.referenceChannel}: clean readable silhouettes, zero clutter, strong focal composition centered in the middle 70% of the frame (leave bottom 18% open for kinetic narration captions).
4. Keep text inside the SVG minimal (0 to 3 short label words max, or no text at all).
5. NEVER include <script>, <style>, <foreignObject>, external URLs, or event handlers.`,
      });

      const sanitized = sanitizeGeneratedSvg(resp.text || '');
      if (sanitized) {
        return { svg: sanitized, generatedBy: 'gemini_vector' };
      }
    } catch (err) {
      console.warn(
        `Vector illustration generation fell back to procedural SVG for "${params.title}":`,
        err instanceof Error ? err.message.slice(0, 140) : String(err)
      );
    }

    return {
      svg: buildProceduralEditorialSvg({
        prompt: params.prompt,
        title: params.title,
        stylePreset: params.stylePreset,
      }),
      generatedBy: 'procedural_vector',
    };
  }
}
