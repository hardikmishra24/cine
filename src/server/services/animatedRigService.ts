import { Type } from '@google/genai';
import { generateContentWithResilience } from './geminiClient.ts';
import {
  VIDEO_STYLE_PRESETS,
  type AnimatedRigAction,
  type AnimatedRigActor,
  type AnimatedRigActorKind,
  type AnimatedRigBackdrop,
  type AnimatedRigCameraStyle,
  type AnimatedRigParticles,
  type AnimatedRigSpec,
  type VideoStylePresetId,
} from '../../types/cineforge.ts';

const VALID_BACKDROPS: AnimatedRigBackdrop[] = [
  'sky_outback',
  'night_cosmos',
  'modern_city',
  'ocean_horizon',
  'studio_grid',
  'parliament_hall',
  'lab_grid',
  'mountain_dawn',
];

const VALID_PARTICLES: AnimatedRigParticles[] = [
  'none',
  'dust',
  'sparks',
  'stars',
  'rain',
  'speed_lines',
  'data_dots',
];

const VALID_CAMERA_STYLES: AnimatedRigCameraStyle[] = [
  'tracking_pan',
  'dynamic_zoom',
  'spring_punch',
  'parallax_glide',
];

const VALID_ACTOR_KINDS: AnimatedRigActorKind[] = [
  'person',
  'soldier',
  'scientist',
  'leader',
  'farmer',
  'bird',
  'animal',
  'truck',
  'ship',
  'plane',
  'rocket',
  'gear',
  'chart_bar',
  'globe',
  'building',
  'clock',
  'lightning',
  'document',
  'coin',
];

const VALID_ACTIONS: AnimatedRigAction[] = [
  'walk',
  'run',
  'march',
  'gesture',
  'fly',
  'drive',
  'spin',
  'bounce',
  'grow',
  'pulse',
  'orbit',
  'idle_sway',
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function safeHex(val: unknown, fallback?: string): string | undefined {
  if (typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

export function sanitizeAnimatedRigSpec(
  raw: any,
  fallbackTitle = 'Animated Scene Rig',
  presetId: VideoStylePresetId = 'historically'
): AnimatedRigSpec {
  const pal = (VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically).palette;
  const backdrop = VALID_BACKDROPS.includes(raw?.backdrop) ? raw.backdrop : 'studio_grid';
  const weatherParticles = VALID_PARTICLES.includes(raw?.weatherParticles) ? raw.weatherParticles : 'speed_lines';
  const cameraStyle = VALID_CAMERA_STYLES.includes(raw?.cameraStyle) ? raw.cameraStyle : 'tracking_pan';

  const rawActors = Array.isArray(raw?.actors) ? raw.actors.slice(0, 8) : [];
  const actors: AnimatedRigActor[] = rawActors
    .map((a: any, idx: number): AnimatedRigActor => {
      const kind: AnimatedRigActorKind = VALID_ACTOR_KINDS.includes(a?.kind) ? a.kind : 'person';
      const action: AnimatedRigAction = VALID_ACTIONS.includes(a?.action) ? a.action : 'walk';
      return {
        id: String(a?.id || `actor_${idx + 1}`).slice(0, 32),
        kind,
        action,
        startX: clamp(Number(a?.startX ?? 20 + idx * 20), 6, 94),
        startY: clamp(Number(a?.startY ?? 64), 18, 86),
        endX: clamp(Number(a?.endX ?? 75 - idx * 10), 6, 94),
        endY: clamp(Number(a?.endY ?? 64), 18, 86),
        scale: clamp(Number(a?.scale ?? 1.05), 0.55, 1.85),
        flipX: Boolean(a?.flipX),
        color: safeHex(a?.color, idx % 2 === 0 ? pal.accent : pal.secondaryAccent),
        accentColor: safeHex(a?.accentColor, idx % 2 === 0 ? pal.secondaryAccent : '#38BDF8'),
        count: clamp(Math.round(Number(a?.count ?? 1)), 1, 6),
        label: typeof a?.label === 'string' && a.label.trim() ? a.label.trim().slice(0, 28) : undefined,
        appearAt: clamp(Number(a?.appearAt ?? 0), 0, 0.7),
      };
    })
    .filter(Boolean);

  if (actors.length === 0) {
    actors.push({
      id: 'actor_1',
      kind: 'person',
      action: 'walk',
      startX: 20,
      startY: 66,
      endX: 72,
      endY: 66,
      scale: 1.15,
      color: pal.accent,
      accentColor: pal.secondaryAccent,
      count: 1,
    });
  }

  let counterStat = undefined;
  if (raw?.counterStat && Number.isFinite(Number(raw.counterStat.targetValue)) && raw.counterStat.label) {
    counterStat = {
      prefix: typeof raw.counterStat.prefix === 'string' ? raw.counterStat.prefix.slice(0, 8) : undefined,
      targetValue: Math.round(clamp(Number(raw.counterStat.targetValue), 1, 999_999_999)),
      suffix: typeof raw.counterStat.suffix === 'string' ? raw.counterStat.suffix.slice(0, 12) : undefined,
      label: String(raw.counterStat.label).trim().slice(0, 36),
    };
  }

  const scriptMatchKeywords = Array.isArray(raw?.scriptMatchKeywords)
    ? raw.scriptMatchKeywords
        .map((k: any) => String(k || '').trim().toLowerCase())
        .filter((k: string) => k.length >= 3)
        .slice(0, 8)
    : [];

  return {
    sceneTitle: String(raw?.sceneTitle || fallbackTitle).trim().slice(0, 90),
    backdrop,
    weatherParticles,
    cameraStyle,
    groundColor: safeHex(raw?.groundColor),
    skyTopColor: safeHex(raw?.skyTopColor),
    skyBottomColor: safeHex(raw?.skyBottomColor),
    accentColor: safeHex(raw?.accentColor, pal.accent),
    actors,
    counterStat,
    scriptMatchKeywords,
  };
}

export interface GeneratedAnimatedRigAsset {
  title: string;
  description: string;
  animatedRigSpec: AnimatedRigSpec;
}

function buildDeterministicTopicRigs(
  topic: string,
  scriptText: string,
  presetId: VideoStylePresetId,
  maxRigs: number
): GeneratedAnimatedRigAsset[] {
  const pal = (VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically).palette;
  const combined = `${topic} ${scriptText}`.toLowerCase();
  const rigs: GeneratedAnimatedRigAsset[] = [];

  // Extract largest meaningful number from script for animated counter
  const numMatches = scriptText.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{3,6}\b/g) || [];
  const parsedNumbers = numMatches
    .map((m) => parseInt(m.replace(/,/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n >= 10 && n !== 1932 && n !== 1939 && n !== 1945 && n !== 2024);
  const heroNumber = parsedNumbers[0] || 20000;

  // 1. Wildlife / Emu / Birds / Agriculture theme
  if (/emu|bird|flock|farm|wheat|crop|outback|animal|wildlife|herd/.test(combined)) {
    rigs.push({
      title: 'Stampeding Wildlife Flock Across Crops',
      description: 'Code-generated flat-vector animated flock sprinting across golden farmland with dynamic dust trails and live count-up metric.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Flock Invasion Across the Wheat Fields',
          backdrop: 'sky_outback',
          weatherParticles: 'dust',
          cameraStyle: 'tracking_pan',
          accentColor: '#FFC300',
          actors: [
            {
              id: 'flock_lead',
              kind: 'bird',
              action: 'run',
              startX: 16,
              startY: 67,
              endX: 82,
              endY: 65,
              scale: 1.05,
              color: '#1E293B',
              accentColor: '#FF4D6D',
              count: 4,
              label: '20,000 Emus',
            },
            {
              id: 'farmer_alarm',
              kind: 'farmer',
              action: 'gesture',
              startX: 84,
              startY: 66,
              endX: 78,
              endY: 66,
              scale: 1.08,
              flipX: true,
              color: '#16A34A',
              accentColor: '#FDE047',
              count: 1,
              label: 'Wheat Farmers',
            },
          ],
          counterStat: {
            targetValue: heroNumber,
            suffix: '+',
            label: 'Migrating Birds',
          },
          scriptMatchKeywords: ['emu', 'emus', 'flock', 'farm', 'wheat', 'crops', 'farmers', 'migrant'],
        },
        'Flock Invasion Across the Wheat Fields',
        presetId
      ),
    });
  }

  // 2. Military / Soldiers / Pursuit / Truck theme
  if (/army|soldier|gunner|artillery|war|troop|truck|chase|pursuit|ambush|military|battle/.test(combined)) {
    rigs.push({
      title: 'High-Speed Field Pursuit & Soldiers',
      description: 'Articulated flat-vector soldiers and bouncing pursuit truck with spinning wheels, exhaust puffs, and fleeing targets.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Mobile Field Pursuit in Action',
          backdrop: 'sky_outback',
          weatherParticles: 'speed_lines',
          cameraStyle: 'tracking_pan',
          accentColor: '#FF4D6D',
          actors: [
            {
              id: 'pursuit_truck',
              kind: 'truck',
              action: 'drive',
              startX: 18,
              startY: 68,
              endX: 56,
              endY: 68,
              scale: 1.15,
              color: '#2563EB',
              accentColor: '#FFC300',
              count: 1,
              label: 'Mounted Truck',
            },
            {
              id: 'fast_targets',
              kind: /emu|bird/.test(combined) ? 'bird' : 'soldier',
              action: 'run',
              startX: 54,
              startY: 66,
              endX: 90,
              endY: 64,
              scale: 0.96,
              color: '#FF4D6D',
              accentColor: '#38BDF8',
              count: 3,
              label: '50 km/h Sprint',
            },
          ],
          counterStat: {
            targetValue: 10000,
            suffix: '',
            label: 'Rounds Expended',
          },
          scriptMatchKeywords: ['truck', 'pursuit', 'soldier', 'gunner', 'artillery', 'rounds', 'chase', 'army', 'war'],
        },
        'Mobile Field Pursuit in Action',
        presetId
      ),
    });

    rigs.push({
      title: 'Artillery Squad Deployment & Command',
      description: 'Marching flat-vector soldiers deployed in formation with animated commanders and tactical timing clock.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Squad Deployment on the Front',
          backdrop: 'mountain_dawn',
          weatherParticles: 'sparks',
          cameraStyle: 'spring_punch',
          accentColor: pal.accent,
          actors: [
            {
              id: 'squad_march',
              kind: 'soldier',
              action: 'march',
              startX: 18,
              startY: 67,
              endX: 60,
              endY: 67,
              scale: 1.05,
              color: '#0D9488',
              accentColor: '#FFC300',
              count: 3,
              label: 'Royal Artillery',
            },
            {
              id: 'field_clock',
              kind: 'clock',
              action: 'pulse',
              startX: 80,
              startY: 36,
              endX: 80,
              endY: 36,
              scale: 1.05,
              color: '#FF4D6D',
              accentColor: '#FFC300',
              count: 1,
              appearAt: 0.12,
            },
          ],
          scriptMatchKeywords: ['deploy', 'deployed', 'major', 'command', 'lewis', 'gun', 'march', 'regiment'],
        },
        'Squad Deployment on the Front',
        presetId
      ),
    });
  }

  // 3. Space / Science / Lab / Tech / Discovery theme
  if (/\b(space|rocket|orbit|planet|star|science|lab|atom|ai|computer|energy|electric|physics|quantum|experiment)\b/.test(combined)) {
    rigs.push({
      title: 'Orbital Launch & Scientific Breakthrough',
      description: 'Kurzgesagt-style glowing rocket launch and orbiting globe over deep cosmos nebula.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Breakthrough Beyond the Horizon',
          backdrop: 'night_cosmos',
          weatherParticles: 'stars',
          cameraStyle: 'dynamic_zoom',
          accentColor: '#38BDF8',
          actors: [
            {
              id: 'hero_rocket',
              kind: 'rocket',
              action: 'fly',
              startX: 28,
              startY: 78,
              endX: 68,
              endY: 26,
              scale: 1.12,
              color: '#FF4D6D',
              accentColor: '#FFC300',
              count: 1,
              label: 'Launch Vehicle',
            },
            {
              id: 'cosmos_globe',
              kind: 'globe',
              action: 'orbit',
              startX: 74,
              startY: 56,
              endX: 74,
              endY: 56,
              scale: 1.25,
              color: '#0EA5E9',
              accentColor: '#FFC300',
              count: 1,
            },
          ],
          scriptMatchKeywords: ['space', 'rocket', 'orbit', 'planet', 'launch', 'science', 'discovery', 'future'],
        },
        'Breakthrough Beyond the Horizon',
        presetId
      ),
    });

    rigs.push({
      title: 'Research Lab Analysis & Interlocking Mechanisms',
      description: 'Expressive flat-vector scientist gesturing beside counter-rotating gears and rising data bars.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Inside the Innovation Engine',
          backdrop: 'lab_grid',
          weatherParticles: 'data_dots',
          cameraStyle: 'spring_punch',
          accentColor: '#00D4FF',
          actors: [
            {
              id: 'lead_scientist',
              kind: 'scientist',
              action: 'gesture',
              startX: 26,
              startY: 66,
              endX: 34,
              endY: 66,
              scale: 1.18,
              color: '#38BDF8',
              accentColor: '#FF4D6D',
              count: 1,
              label: 'Lead Researcher',
            },
            {
              id: 'system_gears',
              kind: 'gear',
              action: 'spin',
              startX: 62,
              startY: 46,
              endX: 62,
              endY: 46,
              scale: 1.22,
              color: '#FFC300',
              accentColor: '#38BDF8',
              count: 1,
            },
            {
              id: 'energy_bolt',
              kind: 'lightning',
              action: 'pulse',
              startX: 80,
              startY: 44,
              endX: 80,
              endY: 44,
              scale: 0.9,
              color: '#FFC300',
              accentColor: '#FF4D6D',
              count: 1,
              appearAt: 0.2,
            },
          ],
          scriptMatchKeywords: ['science', 'research', 'engineer', 'machine', 'energy', 'system', 'invent', 'technology'],
        },
        'Inside the Innovation Engine',
        presetId
      ),
    });
  }

  // 4. Ocean / Naval / Trade / Maritime theme
  if (/\b(ocean|sea|ship|navy|fleet|voyage|trade|island|port|coast)\b/.test(combined)) {
    rigs.push({
      title: 'Maritime Fleet Crossing Open Seas',
      description: 'Animated flat-vector vessel steaming across layered animated ocean waves under vivid sunlight.',
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: 'Voyage Across Open Waters',
          backdrop: 'ocean_horizon',
          weatherParticles: 'speed_lines',
          cameraStyle: 'tracking_pan',
          accentColor: '#38BDF8',
          actors: [
            {
              id: 'hero_ship',
              kind: 'ship',
              action: 'drive',
              startX: 22,
              startY: 62,
              endX: 76,
              endY: 62,
              scale: 1.2,
              color: '#1E293B',
              accentColor: '#FF4D6D',
              count: 1,
              label: 'Expedition Vessel',
            },
            {
              id: 'seabirds',
              kind: 'bird',
              action: 'fly',
              startX: 18,
              startY: 28,
              endX: 82,
              endY: 24,
              scale: 0.85,
              color: '#F8FAFC',
              accentColor: '#38BDF8',
              count: 3,
            },
          ],
          scriptMatchKeywords: ['ocean', 'sea', 'ship', 'navy', 'fleet', 'voyage', 'coast', 'island'],
        },
        'Voyage Across Open Waters',
        presetId
      ),
    });
  }

  // 5. Parliament / Government / Debate / Verdict / Economy (universal high-impact scenes)
  rigs.push({
    title: 'Parliament Debate & Official Verdict',
    description: 'Animated leader gesturing beneath sweeping hall spotlights beside a rising parliament landmark and official dossier.',
    animatedRigSpec: sanitizeAnimatedRigSpec(
      {
        sceneTitle: 'Debate & Official Decision',
        backdrop: 'parliament_hall',
        weatherParticles: 'sparks',
        cameraStyle: 'spring_punch',
        accentColor: '#FFC300',
        actors: [
          {
            id: 'speaker_leader',
            kind: 'leader',
            action: 'gesture',
            startX: 28,
            startY: 66,
            endX: 34,
            endY: 66,
            scale: 1.18,
            color: '#2563EB',
            accentColor: '#FFC300',
            count: 1,
            label: 'Official Order',
          },
          {
            id: 'capitol_building',
            kind: 'building',
            action: 'grow',
            startX: 66,
            startY: 54,
            endX: 66,
            endY: 54,
            scale: 1.25,
            color: '#38BDF8',
            accentColor: '#FF4D6D',
            count: 1,
            label: 'Parliament',
          },
          {
            id: 'order_doc',
            kind: 'document',
            action: 'bounce',
            startX: 82,
            startY: 42,
            endX: 82,
            endY: 42,
            scale: 0.9,
            color: '#FFC300',
            accentColor: '#FF4D6D',
            count: 1,
            appearAt: 0.18,
          },
        ],
        scriptMatchKeywords: ['parliament', 'government', 'minister', 'decision', 'debate', 'report', 'headline', 'withdraw', 'policy'],
      },
      'Debate & Official Decision',
      presetId
    ),
  });

  rigs.push({
    title: 'Animated Impact Metrics & Data Growth',
    description: 'Vox-style animated rising comparison bars, rotating mechanism gears, and live counting headline number.',
    animatedRigSpec: sanitizeAnimatedRigSpec(
      {
        sceneTitle: 'The Numbers Behind the Story',
        backdrop: 'studio_grid',
        weatherParticles: 'data_dots',
        cameraStyle: 'dynamic_zoom',
        accentColor: pal.accent,
        actors: [
          {
            id: 'rising_bars',
            kind: 'chart_bar',
            action: 'grow',
            startX: 36,
            startY: 56,
            endX: 36,
            endY: 56,
            scale: 1.38,
            color: '#38BDF8',
            accentColor: '#FF4D6D',
            count: 1,
            label: 'Escalating Scale',
          },
          {
            id: 'impact_coins',
            kind: 'coin',
            action: 'bounce',
            startX: 70,
            startY: 56,
            endX: 70,
            endY: 50,
            scale: 1.05,
            color: '#FFC300',
            accentColor: '#FF4D6D',
            count: 2,
            appearAt: 0.15,
            label: 'Bounty & Cost',
          },
        ],
        counterStat: {
          targetValue: heroNumber,
          suffix: '+',
          label: 'Total Impact Count',
        },
        scriptMatchKeywords: ['cost', 'bounty', 'million', 'thousand', 'percent', 'number', 'data', 'economy', 'record', 'result'],
      },
      'The Numbers Behind the Story',
      presetId
    ),
  });

  // 6. Modern City & Human Momentum fallback
  rigs.push({
    title: 'Everyday Citizens & Shifting Momentum',
    description: 'Vibrant animated flat-vector citizens striding across a glowing modern skyline with animated world globe.',
    animatedRigSpec: sanitizeAnimatedRigSpec(
      {
        sceneTitle: 'Turning Point on the Global Stage',
        backdrop: 'modern_city',
        weatherParticles: 'sparks',
        cameraStyle: 'parallax_glide',
        accentColor: '#FF4D6D',
        actors: [
          {
            id: 'citizens_walk',
            kind: 'person',
            action: 'walk',
            startX: 18,
            startY: 68,
            endX: 62,
            endY: 68,
            scale: 1.08,
            color: '#FF4D6D',
            accentColor: '#FFC300',
            count: 3,
            label: 'Public Reaction',
          },
          {
            id: 'world_globe',
            kind: 'globe',
            action: 'orbit',
            startX: 78,
            startY: 42,
            endX: 78,
            endY: 42,
            scale: 1.18,
            color: '#38BDF8',
            accentColor: '#FFC300',
            count: 1,
            appearAt: 0.1,
          },
        ],
        scriptMatchKeywords: ['world', 'public', 'people', 'history', 'city', 'global', 'legacy', 'headline'],
      },
      'Turning Point on the Global Stage',
      presetId
    ),
  });

  return rigs.slice(0, clamp(maxRigs, 3, 6));
}

export function computeRigSignature(spec: AnimatedRigSpec): string {
  const actorSig = (spec.actors || [])
    .map((a) => `${a.kind}:${a.action}:${a.count || 1}`)
    .sort()
    .join(',');
  return `${spec.backdrop}|${spec.weatherParticles}|${actorSig}`;
}

function buildUniqueBeatProceduralRig(params: {
  prompt: string;
  narrationText?: string;
  topic?: string;
  stylePreset: VideoStylePresetId;
  beatIndex: number;
  avoidSignatures: Set<string>;
}): GeneratedAnimatedRigAsset {
  const combined = `${params.prompt} ${params.narrationText || ''} ${params.topic || ''}`.toLowerCase();
  const pal = (VIDEO_STYLE_PRESETS[params.stylePreset] || VIDEO_STYLE_PRESETS.historically).palette;

  // Extract a relevant numeric stat from this specific beat's narration if present
  const numMatch = (params.narrationText || params.prompt).match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{2,6}\b/);
  const parsedNum = numMatch ? parseInt(numMatch[0].replace(/,/g, ''), 10) : undefined;
  const validStatNum =
    parsedNum && parsedNum >= 10 && parsedNum !== 1932 && parsedNum !== 1939 && parsedNum !== 1945
      ? parsedNum
      : undefined;

  const shortHeadline =
    params.prompt
      .replace(/^[^a-zA-Z0-9]+/, '')
      .split(/[.!?]/)[0]
      .trim()
      .slice(0, 64) || `Animated Scene ${params.beatIndex + 1}`;

  // Build rich candidate pool from topic + beat-specific cues
  const baseCandidates = buildDeterministicTopicRigs(
    params.topic || params.prompt,
    `${params.prompt} ${params.narrationText || ''}`,
    params.stylePreset,
    6
  );

  // Additional distinct choreographies so even long 14-beat documentaries NEVER repeat a rig signature
  const extraBlueprints: Array<{
    title: string;
    backdrop: AnimatedRigBackdrop;
    particles: AnimatedRigParticles;
    camera: AnimatedRigCameraStyle;
    actors: AnimatedRigActor[];
  }> = [
    {
      title: 'Field Dispatch & Courier Action',
      backdrop: 'sky_outback',
      particles: 'dust',
      camera: 'tracking_pan',
      actors: [
        { id: 'courier', kind: 'truck', action: 'drive', startX: 14, startY: 69, endX: 78, endY: 69, scale: 1.08, color: '#0EA5E9', accentColor: '#FFC300', count: 1, label: 'Field Dispatch' },
        { id: 'doc_alert', kind: 'document', action: 'bounce', startX: 78, startY: 36, endX: 78, endY: 34, scale: 0.92, color: '#FFC300', accentColor: '#FF4D6D', count: 1, appearAt: 0.14 },
      ],
    },
    {
      title: 'Tactical Briefing & Command Gears',
      backdrop: 'studio_grid',
      particles: 'data_dots',
      camera: 'spring_punch',
      actors: [
        { id: 'cmdr', kind: 'leader', action: 'gesture', startX: 24, startY: 66, endX: 30, endY: 66, scale: 1.14, color: '#FF4D6D', accentColor: '#FFC300', count: 1, label: 'Strategy' },
        { id: 'ops_gears', kind: 'gear', action: 'spin', startX: 66, startY: 46, endX: 66, endY: 46, scale: 1.25, color: '#38BDF8', accentColor: '#FFC300', count: 1 },
        { id: 'deadline', kind: 'clock', action: 'pulse', startX: 84, startY: 38, endX: 84, endY: 38, scale: 0.88, color: '#FFC300', accentColor: '#FF4D6D', count: 1, appearAt: 0.18 },
      ],
    },
    {
      title: 'Breaking Press & Public Reaction',
      backdrop: 'modern_city',
      particles: 'speed_lines',
      camera: 'dynamic_zoom',
      actors: [
        { id: 'press_doc', kind: 'document', action: 'grow', startX: 32, startY: 48, endX: 32, endY: 48, scale: 1.24, color: '#FFC300', accentColor: '#FF4D6D', count: 1, label: 'Headlines' },
        { id: 'crowd_react', kind: 'person', action: 'gesture', startX: 66, startY: 68, endX: 74, endY: 68, scale: 1.02, color: '#38BDF8', accentColor: '#FFC300', count: 4, label: 'Public Debate' },
      ],
    },
    {
      title: 'Escalating Momentum & Flashpoint',
      backdrop: 'mountain_dawn',
      particles: 'sparks',
      camera: 'spring_punch',
      actors: [
        { id: 'flash_bolt', kind: 'lightning', action: 'pulse', startX: 50, startY: 36, endX: 50, endY: 36, scale: 1.22, color: '#FFC300', accentColor: '#FF4D6D', count: 1 },
        { id: 'runners', kind: /emu|bird|flock/.test(combined) ? 'bird' : 'person', action: 'run', startX: 16, startY: 67, endX: 86, endY: 66, scale: 1.04, color: '#FF4D6D', accentColor: '#38BDF8', count: 5 },
      ],
    },
    {
      title: 'Global Ripple & Historical Legacy',
      backdrop: 'night_cosmos',
      particles: 'stars',
      camera: 'parallax_glide',
      actors: [
        { id: 'legacy_globe', kind: 'globe', action: 'orbit', startX: 46, startY: 50, endX: 54, endY: 48, scale: 1.32, color: '#38BDF8', accentColor: '#FFC300', count: 1, label: 'Global Echo' },
        { id: 'signal_plane', kind: 'plane', action: 'fly', startX: 16, startY: 32, endX: 86, endY: 26, scale: 0.96, color: '#FF4D6D', accentColor: '#FFC300', count: 1 },
      ],
    },
    {
      title: 'Rural Frontline & Barrier Campaign',
      backdrop: 'sky_outback',
      particles: 'sparks',
      camera: 'parallax_glide',
      actors: [
        { id: 'farmers_crew', kind: 'farmer', action: 'walk', startX: 20, startY: 67, endX: 58, endY: 67, scale: 1.08, color: '#16A34A', accentColor: '#FFC300', count: 2, label: 'Settlers' },
        { id: 'bounty_coins', kind: 'coin', action: 'bounce', startX: 74, startY: 48, endX: 74, endY: 44, scale: 1.06, color: '#FFC300', accentColor: '#FF4D6D', count: 3, appearAt: 0.12 },
      ],
    },
  ];

  for (const bp of extraBlueprints) {
    baseCandidates.push({
      title: shortHeadline,
      description: `Beat-specific animated flat-vector scene: ${params.prompt.slice(0, 220)}`,
      animatedRigSpec: sanitizeAnimatedRigSpec(
        {
          sceneTitle: shortHeadline,
          backdrop: bp.backdrop,
          weatherParticles: bp.particles,
          cameraStyle: bp.camera,
          accentColor: pal.accent,
          actors: bp.actors,
          counterStat: validStatNum
            ? { targetValue: validStatNum, suffix: '+', label: 'Key Metric' }
            : undefined,
        },
        shortHeadline,
        params.stylePreset
      ),
    });
  }

  // Pick the first candidate whose signature is NOT yet in avoidSignatures
  const rotatedStart = params.beatIndex % baseCandidates.length;
  for (let offset = 0; offset < baseCandidates.length; offset++) {
    const candidate = baseCandidates[(rotatedStart + offset) % baseCandidates.length];
    const sig = computeRigSignature(candidate.animatedRigSpec);
    if (!params.avoidSignatures.has(sig)) {
      return {
        ...candidate,
        title: shortHeadline,
        animatedRigSpec: {
          ...candidate.animatedRigSpec,
          sceneTitle: shortHeadline,
        },
      };
    }
  }

  // Ultimate guaranteed-unique mutation: rotate backdrop & particle & actor count based on beatIndex
  const pick = baseCandidates[rotatedStart];
  const altBackdrop = VALID_BACKDROPS[(params.beatIndex + 3) % VALID_BACKDROPS.length];
  const altParticles = VALID_PARTICLES[1 + ((params.beatIndex + 2) % (VALID_PARTICLES.length - 1))];
  const mutatedSpec = sanitizeAnimatedRigSpec(
    {
      ...pick.animatedRigSpec,
      sceneTitle: shortHeadline,
      backdrop: altBackdrop,
      weatherParticles: altParticles,
      actors: pick.animatedRigSpec.actors.map((a, idx) => ({
        ...a,
        count: idx === 0 ? ((params.beatIndex % 4) + 1) : a.count,
        startX: clamp(a.startX + (params.beatIndex % 2 === 0 ? 5 : -5), 10, 88),
      })),
    },
    shortHeadline,
    params.stylePreset
  );

  return {
    title: shortHeadline,
    description: `Beat-specific animated flat-vector rig for: ${params.prompt.slice(0, 220)}`,
    animatedRigSpec: mutatedSpec,
  };
}

export class AnimatedRigGenerationService {
  static async generateMissingRigsForScript(params: {
    topic: string;
    researchSummary?: string;
    scriptParagraphs: Array<{ heading?: string; text: string; visualCue?: string }>;
    existingAssetTitles?: string[];
    stylePreset?: VideoStylePresetId;
    maxRigs?: number;
  }): Promise<{ rigs: GeneratedAnimatedRigAsset[]; generatedBy: 'gemini' | 'procedural' }> {
    const presetId: VideoStylePresetId = params.stylePreset || 'historically';
    const maxRigs = clamp(params.maxRigs ?? 5, 1, 6);
    const scriptCombined = params.scriptParagraphs
      .map((p, idx) => `[Paragraph ${idx + 1}${p.heading ? ` - ${p.heading}` : ''}]: ${p.text}`)
      .join('\n\n');

    const deterministicFallback = () => ({
      rigs: buildDeterministicTopicRigs(params.topic, scriptCombined, presetId, maxRigs),
      generatedBy: 'procedural' as const,
    });

    if (!process.env.GEMINI_API_KEY) {
      return deterministicFallback();
    }

    try {
      const preset = VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically;

      const prompt = `You are a lead Vox / Kurzgesagt flat-vector motion designer for CineForge.
Analyze the documentary topic, research summary, and narration script below, and identify the ${maxRigs} most important MISSING dynamic visual scenes (moving characters, animal flocks, vehicles, machines, debates, animated data charts) that static archival photos cannot animate.

TOPIC: ${params.topic}
STYLE PRESET: ${preset.label} (Vibrant palette: accent ${preset.palette.accent}, secondary ${preset.palette.secondaryAccent}, border ${preset.palette.border})
EXISTING ARCHIVAL ASSETS (already covered as static photos): ${(params.existingAssetTitles || []).slice(0, 12).join(', ') || 'None yet'}
RESEARCH CONTEXT: ${(params.researchSummary || '').slice(0, 900)}

NARRATION SCRIPT:
${scriptCombined.slice(0, 3200)}

Design ${maxRigs} rich, distinct, fast-paced AnimatedRigSpec scenes.
Rules:
- Every rig MUST have 2 to 4 moving actors (walking/running/gesturing people, flocks of birds/animals with count 2-5, driving trucks/ships/rockets, spinning gears, growing chart_bars, orbiting globes).
- Use bold, vibrant, modern hex colors (NO muddy sepia/brown!).
- Make actors actively travel across the stage (startX != endX for walkers/runners/vehicles!) so every scene has unmistakable continuous motion.
- Include scriptMatchKeywords (4-6 lowercase words directly from the script paragraph this rig illustrates) so each rig binds cleanly to its spoken moment.
- Include counterStat on 1-2 rigs when the script mentions a dramatic statistic or quantity.`;

      const actorSchema = {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          kind: { type: Type.STRING, enum: VALID_ACTOR_KINDS },
          action: { type: Type.STRING, enum: VALID_ACTIONS },
          startX: { type: Type.NUMBER },
          startY: { type: Type.NUMBER },
          endX: { type: Type.NUMBER },
          endY: { type: Type.NUMBER },
          scale: { type: Type.NUMBER },
          flipX: { type: Type.BOOLEAN },
          color: { type: Type.STRING },
          accentColor: { type: Type.STRING },
          count: { type: Type.NUMBER },
          label: { type: Type.STRING },
          appearAt: { type: Type.NUMBER },
        },
        required: ['id', 'kind', 'action', 'startX', 'startY', 'endX', 'endY'],
      };

      const rigResponse = await generateContentWithResilience({
        models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
        contents: prompt,
        attemptTimeoutMs: 22000,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rigs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    sceneTitle: { type: Type.STRING },
                    backdrop: { type: Type.STRING, enum: VALID_BACKDROPS },
                    weatherParticles: { type: Type.STRING, enum: VALID_PARTICLES },
                    cameraStyle: { type: Type.STRING, enum: VALID_CAMERA_STYLES },
                    accentColor: { type: Type.STRING },
                    actors: { type: Type.ARRAY, items: actorSchema },
                    counterStat: {
                      type: Type.OBJECT,
                      properties: {
                        prefix: { type: Type.STRING },
                        targetValue: { type: Type.NUMBER },
                        suffix: { type: Type.STRING },
                        label: { type: Type.STRING },
                      },
                      required: ['targetValue', 'label'],
                    },
                    scriptMatchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ['title', 'description', 'sceneTitle', 'backdrop', 'weatherParticles', 'cameraStyle', 'actors'],
                },
              },
            },
            required: ['rigs'],
          },
        },
      });

      const parsed = JSON.parse(rigResponse.text || '{}');
      const rawRigs = Array.isArray(parsed?.rigs) ? parsed.rigs.slice(0, maxRigs) : [];
      if (rawRigs.length === 0) return deterministicFallback();

      const sanitized: GeneratedAnimatedRigAsset[] = rawRigs.map((r: any, idx: number) => ({
        title: String(r?.title || `Animated Scene ${idx + 1}`).trim().slice(0, 120),
        description: String(r?.description || 'Code-generated animated flat-vector scene rig.').trim().slice(0, 400),
        animatedRigSpec: sanitizeAnimatedRigSpec(r, r?.title || `Animated Scene ${idx + 1}`, presetId),
      }));

      return { rigs: sanitized, generatedBy: 'gemini' };
    } catch (err) {
      console.warn('[AnimatedRigGenerationService] Gemini fallback triggered:', err instanceof Error ? err.message : err);
      return deterministicFallback();
    }
  }

  static async generateSingleRig(params: {
    prompt: string;
    narrationText?: string;
    topic?: string;
    stylePreset?: VideoStylePresetId;
    beatIndex?: number;
    avoidSignatures?: string[];
  }): Promise<{ rig: GeneratedAnimatedRigAsset; generatedBy: 'gemini' | 'procedural' }> {
    const presetId: VideoStylePresetId = params.stylePreset || 'historically';
    const avoidSet = new Set(params.avoidSignatures || []);
    const beatIndex = params.beatIndex ?? 0;

    if (process.env.GEMINI_API_KEY) {
      try {
        const preset = VIDEO_STYLE_PRESETS[presetId] || VIDEO_STYLE_PRESETS.historically;
        const avoidHint =
          avoidSet.size > 0
            ? `\nALREADY USED RIG SIGNATURES ON OTHER BEATS (DO NOT REPEAT ANY OF THESE BACKDROP+ACTOR COMBOS):\n${Array.from(avoidSet).slice(0, 10).join('\n')}`
            : '';

        const promptText = `Design ONE unique, vibrant Vox / Kurzgesagt flat-vector animated scene rig strictly for this single documentary beat.
TOPIC: ${params.topic || params.prompt}
STYLE: ${preset.label} (accent ${preset.palette.accent}, secondary ${preset.palette.secondaryAccent})
DIRECTOR VISUAL BRIEF: ${params.prompt}
SPOKEN NARRATION FOR THIS BEAT: "${(params.narrationText || params.prompt).slice(0, 320)}"${avoidHint}

Rules:
- Include 2 to 4 actively moving flat-vector actors with startX != endX where appropriate.
- Match the exact characters, vehicles, creatures, or charts described in THIS beat's narration.
- Use bold modern saturated hex colors (NO muddy sepia).
- Include counterStat ONLY if a real number/statistic is spoken in this beat.`;

        const actorSchema = {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            kind: { type: Type.STRING, enum: VALID_ACTOR_KINDS },
            action: { type: Type.STRING, enum: VALID_ACTIONS },
            startX: { type: Type.NUMBER },
            startY: { type: Type.NUMBER },
            endX: { type: Type.NUMBER },
            endY: { type: Type.NUMBER },
            scale: { type: Type.NUMBER },
            flipX: { type: Type.BOOLEAN },
            color: { type: Type.STRING },
            accentColor: { type: Type.STRING },
            count: { type: Type.NUMBER },
            label: { type: Type.STRING },
            appearAt: { type: Type.NUMBER },
          },
          required: ['id', 'kind', 'action', 'startX', 'startY', 'endX', 'endY'],
        };

        const resp = await generateContentWithResilience({
          models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
          contents: promptText,
          attemptTimeoutMs: 16000,
          maxRetriesPerModel: 0,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                sceneTitle: { type: Type.STRING },
                backdrop: { type: Type.STRING, enum: VALID_BACKDROPS },
                weatherParticles: { type: Type.STRING, enum: VALID_PARTICLES },
                cameraStyle: { type: Type.STRING, enum: VALID_CAMERA_STYLES },
                accentColor: { type: Type.STRING },
                actors: { type: Type.ARRAY, items: actorSchema },
                counterStat: {
                  type: Type.OBJECT,
                  properties: {
                    prefix: { type: Type.STRING },
                    targetValue: { type: Type.NUMBER },
                    suffix: { type: Type.STRING },
                    label: { type: Type.STRING },
                  },
                  required: ['targetValue', 'label'],
                },
                scriptMatchKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['title', 'description', 'sceneTitle', 'backdrop', 'weatherParticles', 'cameraStyle', 'actors'],
            },
          },
        });

        const parsed = JSON.parse(resp.text || '{}');
        if (parsed && Array.isArray(parsed.actors) && parsed.actors.length > 0) {
          let spec = sanitizeAnimatedRigSpec(parsed, parsed.title || params.prompt.slice(0, 72), presetId);
          // Enforce zero-repeat signature if Gemini accidentally echoed a previously used combo
          if (avoidSet.has(computeRigSignature(spec))) {
            const altBackdrop = VALID_BACKDROPS[(VALID_BACKDROPS.indexOf(spec.backdrop) + beatIndex + 1) % VALID_BACKDROPS.length];
            const altParticles = VALID_PARTICLES[1 + ((beatIndex + 1) % (VALID_PARTICLES.length - 1))];
            spec = { ...spec, backdrop: altBackdrop, weatherParticles: altParticles };
          }
          return {
            rig: {
              title: String(parsed.title || params.prompt.slice(0, 80)).trim().slice(0, 120),
              description: String(parsed.description || params.prompt).trim().slice(0, 400),
              animatedRigSpec: spec,
            },
            generatedBy: 'gemini',
          };
        }
      } catch (err) {
        console.warn('[AnimatedRigGenerationService] Single rig Gemini fallback:', err instanceof Error ? err.message : err);
      }
    }

    const fallback = buildUniqueBeatProceduralRig({
      prompt: params.prompt,
      narrationText: params.narrationText,
      topic: params.topic,
      stylePreset: presetId,
      beatIndex,
      avoidSignatures: avoidSet,
    });
    return { rig: fallback, generatedBy: 'procedural' };
  }
}
