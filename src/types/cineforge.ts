export type InputMode = 'topic' | 'script' | 'voiceover';
export type ProjectStatus = 'draft' | 'in_production' | 'rendered' | 'archived';
export type ProductionStage =
  | 'research'
  | 'script'
  | 'voice'
  | 'storyboard'
  | 'assets'
  | 'motion'
  | 'render';

export type NavSection =
  | 'dashboard'
  | 'new_project'
  | 'research'
  | 'script'
  | 'voice'
  | 'storyboard'
  | 'assets'
  | 'motion'
  | 'render'
  | 'settings';

export type WorldEnvironment = 'desk' | 'map' | 'board' | 'archive';

export type VideoStylePresetId =
  | 'ted_ed'
  | 'simple_history'
  | 'history_on_maps'
  | 'minute_earth'
  | 'historically'
  | 'archival_documentary';

export type NarrationPresetId =
  | 'investigative'
  | 'historical'
  | 'journalistic'
  | 'authoritative'
  | 'reflective'
  | 'suspenseful'
  | 'intimate';

export type AmbientBedId =
  | 'none'
  | 'ted_ed_marimba'
  | 'simple_history_march'
  | 'maps_cartography_pulse'
  | 'minute_earth_plucky'
  | 'historically_upbeat'
  | 'obsidian_drone'
  | 'investigative_pulse'
  | 'historical_strings'
  | 'archive_room_tone';

export interface VideoStylePresetDefinition {
  id: VideoStylePresetId;
  label: string;
  referenceChannel: string;
  shortDesc: string;
  defaultWorld: WorldEnvironment;
  defaultAmbientBed: AmbientBedId;
  defaultTransition: BeatTransitionType;
  palette: {
    bg: string;
    bgSecondary: string;
    surface: string;
    ink: string;
    mutedInk: string;
    accent: string;
    secondaryAccent: string;
    highlightBg: string;
    ocean: string;
    land: string;
    border: string;
  };
  paperMode: 'dark_editorial' | 'velvet_gouache' | 'aged_parchment' | 'cartography_parchment' | 'cream_sketchbook' | 'slate_cutout';
  illustrationStylePrompt: string;
}

export const VIDEO_STYLE_PRESETS: Record<VideoStylePresetId, VideoStylePresetDefinition> = {
  ted_ed: {
    id: 'ted_ed',
    label: 'TED-Ed Editorial',
    referenceChannel: 'TED-Ed',
    shortDesc: 'Vivid flat-vector storybook characters in deep royal indigo, vivid coral, solar gold, and mint teal with smooth parallax.',
    defaultWorld: 'board',
    defaultAmbientBed: 'ted_ed_marimba',
    defaultTransition: 'iris_reveal',
    palette: {
      bg: '#101533',
      bgSecondary: '#1D2961',
      surface: '#FFFBF2',
      ink: '#F8FAFF',
      mutedInk: '#B9C7E8',
      accent: '#FF5A5F',
      secondaryAccent: '#FFB703',
      highlightBg: '#FF5A5F',
      ocean: '#123A6B',
      land: '#2EC4B6',
      border: '#FFB703',
    },
    paperMode: 'velvet_gouache',
    illustrationStylePrompt:
      'TED-Ed / Kurzgesagt flat-vector editorial animation: deep royal indigo (#101533), vivid coral (#FF5A5F), solar gold (#FFB703), and mint teal (#2EC4B6), bold geometric silhouettes, clean layered depth, expressive storybook composition.',
  },
  simple_history: {
    id: 'simple_history',
    label: 'Simple History Illustrated',
    referenceChannel: 'Simple History',
    shortDesc: 'Crisp high-contrast ivory stages with signal vermilion, navy ink, bright gold accents, and articulated animated characters.',
    defaultWorld: 'desk',
    defaultAmbientBed: 'simple_history_march',
    defaultTransition: 'paper_slide',
    palette: {
      bg: '#FFF9EE',
      bgSecondary: '#F8EBD0',
      surface: '#FFFFFF',
      ink: '#14213D',
      mutedInk: '#4A5568',
      accent: '#E63946',
      secondaryAccent: '#F4A261',
      highlightBg: '#E63946',
      ocean: '#1D5B96',
      land: '#E9D5A1',
      border: '#14213D',
    },
    paperMode: 'aged_parchment',
    illustrationStylePrompt:
      'Simple History modern high-contrast vector illustration: crisp bright ivory (#FFF9EE), bold navy ink outlines (#14213D), signal vermilion (#E63946), and bright gold (#F4A261), vivid cel shading, expressive moving characters.',
  },
  history_on_maps: {
    id: 'history_on_maps',
    label: 'History on Maps',
    referenceChannel: 'History on Maps',
    shortDesc: 'Deep marine sapphire cartography with golden-sand continents, tactical crimson route arrows, electric cyan markers, and live date ticker.',
    defaultWorld: 'map',
    defaultAmbientBed: 'maps_cartography_pulse',
    defaultTransition: 'map_flight',
    palette: {
      bg: '#061830',
      bgSecondary: '#0E315E',
      surface: '#F6EED9',
      ink: '#F8FAFC',
      mutedInk: '#93C5FD',
      accent: '#FF3B5C',
      secondaryAccent: '#00D4FF',
      highlightBg: '#FF3B5C',
      ocean: '#0E315E',
      land: '#F0E3C0',
      border: '#00D4FF',
    },
    paperMode: 'cartography_parchment',
    illustrationStylePrompt:
      'Modern tactical atlas cartography: deep marine sapphire ocean (#0E315E), crisp golden-sand terrain (#F0E3C0), tactical crimson (#FF3B5C) and electric cyan (#00D4FF) vectors, glowing route trajectories.',
  },
  minute_earth: {
    id: 'minute_earth',
    label: 'MinuteEarth Paper',
    referenceChannel: 'MinuteEarth',
    shortDesc: 'Bright daylight paper with fresh mint accents, vibrant emerald, tangerine pop, and snappy bouncing flat-vector characters.',
    defaultWorld: 'board',
    defaultAmbientBed: 'minute_earth_plucky',
    defaultTransition: 'cut_pop',
    palette: {
      bg: '#FFFDF7',
      bgSecondary: '#EAF8F0',
      surface: '#FFFFFF',
      ink: '#14213D',
      mutedInk: '#475569',
      accent: '#16A34A',
      secondaryAccent: '#FF6B2C',
      highlightBg: '#FDE047',
      ocean: '#38BDF8',
      land: '#86EFAC',
      border: '#14213D',
    },
    paperMode: 'cream_sketchbook',
    illustrationStylePrompt:
      'MinuteEarth vibrant daylight explainer vector art: crisp white-cream background (#FFFDF7), vibrant emerald (#16A34A), tangerine pop (#FF6B2C), and sky cyan (#38BDF8), bold friendly silhouettes, playful visual metaphors.',
  },
  historically: {
    id: 'historically',
    label: 'Historically Dynamic',
    referenceChannel: 'Historically',
    shortDesc: 'High-voltage Vox/Historically hybrid in midnight indigo, electric gold, neon coral, and bright cyan with punchy 2-3.5s cuts.',
    defaultWorld: 'board',
    defaultAmbientBed: 'historically_upbeat',
    defaultTransition: 'whip_pan',
    palette: {
      bg: '#0B1024',
      bgSecondary: '#172047',
      surface: '#FFFDF7',
      ink: '#FFFFFF',
      mutedInk: '#A5B4FC',
      accent: '#FFC300',
      secondaryAccent: '#FF4D6D',
      highlightBg: '#FFC300',
      ocean: '#133C7A',
      land: '#F4D58D',
      border: '#38BDF8',
    },
    paperMode: 'slate_cutout',
    illustrationStylePrompt:
      'Vox / Historically dynamic modern documentary motion design: midnight indigo (#0B1024), electric gold (#FFC300), neon coral (#FF4D6D), and bright sky cyan (#38BDF8), crisp white sticker outlines, punchy high-energy composition.',
  },
  archival_documentary: {
    id: 'archival_documentary',
    label: 'Archival Documentary',
    referenceChannel: 'Modern Archival Cinema',
    shortDesc: 'Crisp deep obsidian editorial aesthetic with luminous amber, crimson highlights, ice blue telemetry, and living motion overlays.',
    defaultWorld: 'desk',
    defaultAmbientBed: 'obsidian_drone',
    defaultTransition: 'zoom_punch',
    palette: {
      bg: '#0D121F',
      bgSecondary: '#1A2338',
      surface: '#F4F1EA',
      ink: '#F8FAFC',
      mutedInk: '#94A3B8',
      accent: '#FFB020',
      secondaryAccent: '#F43F5E',
      highlightBg: '#FFB020',
      ocean: '#17375E',
      land: '#C7B693',
      border: '#60A5FA',
    },
    paperMode: 'dark_editorial',
    illustrationStylePrompt:
      'Modern archival documentary graphic plate: deep obsidian (#0D121F), luminous amber (#FFB020), crimson accent (#F43F5E), and ice blue (#60A5FA), sharp broadcast contrast and clean modern framing.',
  },
};

export interface ResearchEntities {
  people: string[];
  organizations: string[];
  events: string[];
  dates: string[];
  locations: string[];
}

export interface VisualDirection {
  worldEnvironment: WorldEnvironment;
  cinematographyNotes: string;
  lightingStyle: string;
  colorPalette: string[];
  typographyStyle: string;
  cameraLanguage: string;
  physicalMotifs: string[];
  referenceNotes: string;
}

export interface VoiceProfile {
  provider: 'gemini' | 'elevenlabs';
  voiceName: 'Charon' | 'Kore' | 'Fenrir' | 'Puck' | 'Zephyr';
  gender: 'male' | 'female';
  language: string;
  regionalAccent: string;
  vocalDepth: 'deep' | 'baritone' | 'medium' | 'warm' | 'crisp';
  speakingSpeed: number;
  emotionalCharacter: string;
  narrationStyle: string;
  preset: NarrationPresetId;
  sampleAudioUrl?: string;
  sampleText?: string;
  approved: boolean;
}

export interface AudioPostProcessing {
  loudnessNormalization: boolean;
  targetLufs: number;
  warmEq: boolean;
  gentleCompression: boolean;
  deEsser: boolean;
  noiseReduction: boolean;
}

export interface MasterAudioInfo {
  audioUrl: string;
  durationMs: number;
  sampleRate: number;
  isUploadedOriginal: boolean;
  waveformPeaks: number[];
  analyzedAt?: string;
}

export interface AudioMixerSettings {
  voiceVolume: number;
  musicVolume: number;
  sfxVolume: number;
  autoDucking: boolean;
  duckingDepthDb: number;
  ambientBed: AmbientBedId;
}

export interface UploadedReference {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  extractedText?: string;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  inputMode: InputMode;
  topic: string;
  language: string;
  narratorLanguage: string;
  narratorAccent: string;
  voiceCharacter: string;
  targetDurationSec: number;
  aspectRatio: string;
  resolution: string;
  frameRate: number;
  visualStyle: string;
  videoStylePreset?: VideoStylePresetId;
  worldEnvironment: WorldEnvironment;
  status: ProjectStatus;
  activeStage: ProductionStage;
  thumbnailUrl?: string;
  narrationDurationSec: number;
  renderStatus: 'idle' | 'rendering' | 'completed' | 'failed';
  researchApproved: boolean;
  visualDirectionApproved: boolean;
  scriptApproved: boolean;
  voiceApproved: boolean;
  storyboardApproved: boolean;
  assetsApproved?: boolean;
  researchSummary?: string;
  researchPreferences?: string;
  visualDirection?: VisualDirection;
  researchEntities?: ResearchEntities;
  voiceProfile?: VoiceProfile;
  audioPostProcessing?: AudioPostProcessing;
  masterAudio?: MasterAudioInfo;
  audioMixer?: AudioMixerSettings;
  uploadedReferences?: UploadedReference[];
  animatedRigsScriptHash?: string;
  mediaFulfilledHash?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface ResearchSource {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  url: string;
  publisher?: string;
  sourceType?: string;
  summary?: string;
  dateRange?: string;
  createdAt?: any;
}

export type AnimatedRigBackdrop =
  | 'sky_outback'
  | 'night_cosmos'
  | 'modern_city'
  | 'ocean_horizon'
  | 'studio_grid'
  | 'parliament_hall'
  | 'lab_grid'
  | 'mountain_dawn';

export type AnimatedRigParticles =
  | 'none'
  | 'dust'
  | 'sparks'
  | 'stars'
  | 'rain'
  | 'speed_lines'
  | 'data_dots';

export type AnimatedRigCameraStyle =
  | 'tracking_pan'
  | 'dynamic_zoom'
  | 'spring_punch'
  | 'parallax_glide';

export type AnimatedRigActorKind =
  | 'person'
  | 'soldier'
  | 'scientist'
  | 'leader'
  | 'farmer'
  | 'bird'
  | 'animal'
  | 'truck'
  | 'ship'
  | 'plane'
  | 'rocket'
  | 'gear'
  | 'chart_bar'
  | 'globe'
  | 'building'
  | 'clock'
  | 'lightning'
  | 'document'
  | 'coin';

export type AnimatedRigAction =
  | 'walk'
  | 'run'
  | 'march'
  | 'gesture'
  | 'fly'
  | 'drive'
  | 'spin'
  | 'bounce'
  | 'grow'
  | 'pulse'
  | 'orbit'
  | 'idle_sway';

export interface AnimatedRigActor {
  id: string;
  kind: AnimatedRigActorKind;
  action: AnimatedRigAction;
  startX: number; // 0..100 stage %
  startY: number; // 0..100 stage %
  endX: number; // 0..100 stage %
  endY: number; // 0..100 stage %
  scale?: number; // 0.5..2.0
  flipX?: boolean;
  color?: string;
  accentColor?: string;
  count?: number; // 1..6 for flocks/squads/crowds
  label?: string;
  appearAt?: number; // 0..0.75 normalized beat start
}

export interface AnimatedRigCounterStat {
  prefix?: string;
  targetValue: number;
  suffix?: string;
  label: string;
}

export interface AnimatedRigSpec {
  sceneTitle: string;
  backdrop: AnimatedRigBackdrop;
  weatherParticles: AnimatedRigParticles;
  cameraStyle: AnimatedRigCameraStyle;
  groundColor?: string;
  skyTopColor?: string;
  skyBottomColor?: string;
  accentColor?: string;
  actors: AnimatedRigActor[];
  counterStat?: AnimatedRigCounterStat;
  scriptMatchKeywords?: string[];
}

export interface ArchivalAsset {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  description?: string;
  sourceProvider:
    | 'wikimedia'
    | 'wikimedia_video'
    | 'loc'
    | 'nasa'
    | 'nasa_video'
    | 'upload'
    | 'ai_illustration'
    | 'code_animation';
  sourceUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  mediaKind?: 'image' | 'video' | 'animated_rig';
  durationSec?: number;
  creator?: string;
  license?: string;
  category:
    | 'photograph'
    | 'video_clip'
    | 'map'
    | 'document'
    | 'newspaper'
    | 'archive'
    | 'reference'
    | 'illustration'
    | 'animated_rig';
  approvalStatus: 'pending' | 'approved' | 'rejected';
  downloadStatus: 'ready' | 'missing' | 'unavailable';
  assignedSegmentId?: string;
  assignedBeatId?: string;
  limitationNote?: string;
  animatedRigSpec?: AnimatedRigSpec;
  createdAt?: any;
  updatedAt?: any;
}

export interface ScriptParagraph {
  id: string;
  heading: string;
  text: string;
  researchRef?: string;
  visualCue?: string;
  estimatedSec: number;
}

export interface PronunciationEntry {
  term: string;
  phonetic: string;
  notes?: string;
}

export interface ScriptVersion {
  id: string;
  ownerId: string;
  projectId: string;
  versionNumber: number;
  label?: string;
  isActive: boolean;
  isApproved: boolean;
  wordCount: number;
  estimatedDurationSec: number;
  paragraphs: ScriptParagraph[];
  pronunciationGuide?: PronunciationEntry[];
  createdAt?: any;
  updatedAt?: any;
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  emphasis?: boolean;
}

export interface PauseMarker {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface NarrationSegment {
  id: string;
  ownerId: string;
  projectId: string;
  orderIndex: number;
  text: string;
  pronunciationHint?: string;
  audioUrl?: string;
  durationMs: number;
  status: 'pending' | 'generated' | 'approved' | 'uploaded';
  wordTimestamps?: WordTimestamp[];
  pauseMarkers?: PauseMarker[];
  version?: number;
  createdAt?: any;
  updatedAt?: any;
}

export type CameraMotionType =
  | 'push_in'
  | 'pull_back'
  | 'pan_left'
  | 'pan_right'
  | 'orbit_drift'
  | 'focus_hold';

export type BeatSceneType =
  | 'animated_rig'
  | 'archival_video'
  | 'illustrated_scene'
  | 'animated_map'
  | 'layered_cutout'
  | 'diagram_callout'
  | 'archival_photo'
  | 'kinetic_title';

export type BeatObjectType =
  | 'photo'
  | 'video_clip'
  | 'document'
  | 'newspaper'
  | 'map'
  | 'title_card'
  | 'illustration'
  | 'cutout'
  | 'diagram'
  | 'animated_rig';

export type BeatTransitionType =
  | 'continuous_glide'
  | 'pull_reveal'
  | 'desk_sweep'
  | 'map_flight'
  | 'whip_pan'
  | 'paper_slide'
  | 'zoom_punch'
  | 'iris_reveal'
  | 'cut_pop';

export type SfxCueType =
  | 'none'
  | 'paper_slide'
  | 'document_land'
  | 'soft_impact'
  | 'map_pin'
  | 'whoosh'
  | 'pop_in'
  | 'stamp_hit'
  | 'map_ping'
  | 'chalk_draw';

export type MapRegionId =
  | 'world'
  | 'north_america'
  | 'europe'
  | 'australia'
  | 'asia'
  | 'middle_east'
  | 'south_america'
  | 'pacific'
  | 'atlantic';

export interface MapMarkerSpec {
  label: string;
  x: number; // 0..100 normalized within regional viewport
  y: number; // 0..100
  kind?: 'battle' | 'city' | 'capital' | 'event';
  color?: string;
}

export interface MapRouteSpec {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface MapTerritorySpec {
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface BeatMapSpec {
  region: MapRegionId;
  dateLabel?: string;
  focusX?: number; // 0..100
  focusY?: number; // 0..100
  zoom?: number; // 1.0..2.2
  markers?: MapMarkerSpec[];
  routes?: MapRouteSpec[];
  territories?: MapTerritorySpec[];
}

export interface BeatCalloutItem {
  label: string;
  value?: string;
  x: number; // 0..100 screen-space %
  y: number; // 0..100
  anchorX?: number; // 0..100 target point for leader line
  anchorY?: number; // 0..100
  appearAt?: number; // 0..1 fraction of beat duration
}

export interface StoryboardBeat {
  id: string;
  ownerId: string;
  projectId: string;
  orderIndex: number;
  segmentId?: string;
  startMs: number;
  endMs: number;
  narrationText: string;
  heroAssetId?: string;
  heroAssetUrl?: string;
  heroVideoUrl?: string;
  videoStartOffsetSec?: number;
  heroAssetTitle?: string;
  shotBrief?: string;
  assetSearchQuery?: string;
  rigPrompt?: string;
  fulfillmentStatus?: 'planned' | 'fulfilled' | 'fallback';
  onScreenText?: string;
  triggerWord?: string;
  sceneType?: BeatSceneType;
  illustrationPrompt?: string;
  dateBadge?: string;
  mapSpec?: BeatMapSpec;
  animatedRigSpec?: AnimatedRigSpec;
  calloutItems?: BeatCalloutItem[];
  highlightWords?: string[];
  wordTimestamps?: WordTimestamp[];
  objectType: BeatObjectType;
  worldX: number;
  worldY: number;
  worldRotation: number;
  worldScale: number;
  cameraMotion: CameraMotionType;
  cameraZoom: number;
  transition: BeatTransitionType;
  sfxCue: SfxCueType;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface QaCheckItem {
  category: 'voice' | 'visual' | 'technical';
  label: string;
  passed: boolean;
  detail: string;
}

export interface QaFrameSample {
  timeSec: number;
  label: string;
  dataUrl: string;
}

export interface QaReport {
  overallPassed: boolean;
  checkedAt: string;
  resolutionVerified: string;
  fpsVerified: number;
  durationSecVerified: number;
  audioSyncDeltaMs: number;
  blackFramesDetected: number;
  checks: QaCheckItem[];
}

export interface RenderJob {
  id: string;
  ownerId: string;
  projectId: string;
  status: 'queued' | 'rendering' | 'encoding' | 'qa_checking' | 'completed' | 'failed';
  stage?: string;
  progress: number;
  width: number;
  height: number;
  fps: number;
  aspectRatio?: string;
  outputUrl?: string;
  fileSizeBytes?: number;
  durationSec?: number;
  codecInfo?: string;
  qaReport?: QaReport;
  qaFrames?: QaFrameSample[];
  errorMessage?: string;
  createdAt?: any;
  updatedAt?: any;
}

export const NARRATION_PRESETS: Record<
  NarrationPresetId,
  {
    label: string;
    description: string;
    styleInstruction: string;
    recommendedVoice: 'Charon' | 'Kore' | 'Fenrir' | 'Puck' | 'Zephyr';
    defaultSpeed: number;
    defaultDepth: VoiceProfile['vocalDepth'];
  }
> = {
  investigative: {
    label: 'Investigative Documentary',
    description: 'Measured, incisive, crisp articulation with deliberate pauses on facts.',
    styleInstruction:
      'Investigative documentary narrator. Calm, incisive, grounded human delivery with deliberate pauses before key revelations and subtle vocal gravitas. Never theatrical or rushed.',
    recommendedVoice: 'Charon',
    defaultSpeed: 0.96,
    defaultDepth: 'baritone',
  },
  historical: {
    label: 'Historical Documentary',
    description: 'Warm, resonant, archival authority with natural storytelling cadence.',
    styleInstruction:
      'Historical documentary narrator. Warm, resonant, deeply informed voice with measured cadence, clear pronunciation of historical dates and names, and quiet emotional weight.',
    recommendedVoice: 'Fenrir',
    defaultSpeed: 0.94,
    defaultDepth: 'deep',
  },
  journalistic: {
    label: 'Serious Journalistic',
    description: 'Clear, objective, unhurried broadcast documentary reporting.',
    styleInstruction:
      'Serious long-form journalistic documentary narrator. Clear, precise, trustworthy diction with even pacing and understated emphasis on verified evidence.',
    recommendedVoice: 'Kore',
    defaultSpeed: 1.0,
    defaultDepth: 'medium',
  },
  authoritative: {
    label: 'Calm & Authoritative',
    description: 'Steady, composed command with low vocal warmth and zero hype.',
    styleInstruction:
      'Calm, authoritative documentary voice. Steady breath control, composed timbre, unhurried sentence endings, projecting quiet mastery over complex subjects.',
    recommendedVoice: 'Charon',
    defaultSpeed: 0.95,
    defaultDepth: 'deep',
  },
  reflective: {
    label: 'Reflective Storytelling',
    description: 'Thoughtful, human, lyrical cadence with space for contemplation.',
    styleInstruction:
      'Reflective documentary storyteller. Gentle, warm, unhurried human cadence with natural breathing and subtle emotional inflection that lets ideas settle.',
    recommendedVoice: 'Zephyr',
    defaultSpeed: 0.92,
    defaultDepth: 'warm',
  },
  suspenseful: {
    label: 'Suspenseful Documentary',
    description: 'Restrained tension, lower register, quiet intensity on turning points.',
    styleInstruction:
      'Suspenseful documentary narrator. Low, restrained, controlled intensity with subtle drops in vocal volume and deliberate spacing before pivotal turns. Never melodramatic.',
    recommendedVoice: 'Fenrir',
    defaultSpeed: 0.93,
    defaultDepth: 'baritone',
  },
  intimate: {
    label: 'Intimate Narration',
    description: 'Close-mic, quiet conversational warmth suited for personal archives.',
    styleInstruction:
      'Intimate close-microphone documentary narrator. Soft, natural, personal tone as if speaking quietly across an archival desk, with organic human warmth and clarity.',
    recommendedVoice: 'Kore',
    defaultSpeed: 0.95,
    defaultDepth: 'warm',
  },
};

export const STUDIO_BACKDROPS = {
  editSuite: '/src/assets/images/cineforge_edit_suite_1795215675020.jpg',
  archivalDesk: '/src/assets/images/cineforge_archival_desk_1795215674946.jpg',
};
