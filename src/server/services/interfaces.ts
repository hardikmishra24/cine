import type {
  ArchivalAsset,
  AudioMixerSettings,
  AudioPostProcessing,
  NarrationPresetId,
  PauseMarker,
  PronunciationEntry,
  ResearchEntities,
  ResearchSource,
  ScriptParagraph,
  SfxCueType,
  StoryboardBeat,
  VideoStylePresetId,
  VisualDirection,
  VoiceProfile,
  WordTimestamp,
  WorldEnvironment,
} from '../../types/cineforge.ts';

export interface ResearchResult {
  summary: string;
  entities: ResearchEntities;
  sources: Array<Omit<ResearchSource, 'id' | 'ownerId' | 'projectId' | 'createdAt'>>;
  visualDirection: VisualDirection;
  imageSearchQueries: Array<{ query: string; category: ArchivalAsset['category']; subject: string }>;
}

export interface IResearchService {
  researchTopic(params: {
    topic: string;
    scriptContext?: string;
    language: string;
    researchPreferences?: string;
    referenceTexts?: string[];
  }): Promise<ResearchResult>;
}

export interface IAssetManagementService {
  discoverArchivalAssets(params: {
    queries: Array<{ query: string; category: ArchivalAsset['category']; subject: string }>;
    topic: string;
  }): Promise<Array<Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>>;
  searchArchive(
    query: string,
    providers?: Array<'wikimedia' | 'loc' | 'nasa'>,
    mediaKind?: 'image' | 'video' | 'all'
  ): Promise<
    Array<Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>
  >;
}

export interface GeneratedScriptResult {
  paragraphs: ScriptParagraph[];
  pronunciationGuide: PronunciationEntry[];
  wordCount: number;
  estimatedDurationSec: number;
}

export interface IScriptGenerationService {
  generateOrRefineScript(params: {
    topic: string;
    existingScript?: string;
    researchSummary?: string;
    entities?: ResearchEntities;
    targetDurationSec: number;
    language: string;
    narrationStyle?: string;
  }): Promise<GeneratedScriptResult>;

  regenerateParagraph(params: {
    topic: string;
    paragraph: ScriptParagraph;
    surroundingContext: string;
    instruction: string;
    language: string;
  }): Promise<ScriptParagraph>;
}

export interface SynthesizeSpeechParams {
  text: string;
  voiceProfile: VoiceProfile;
  pronunciationHint?: string;
  postProcessing?: AudioPostProcessing;
}

export interface SynthesizedAudioResult {
  audioBuffer: Buffer;
  mimeType: string;
  durationMs: number;
  sampleRate: number;
}

export interface IVoiceGenerationService {
  readonly providerName: 'gemini' | 'elevenlabs';
  isConfigured(): boolean;
  synthesize(params: SynthesizeSpeechParams): Promise<SynthesizedAudioResult>;
}

export interface AnalyzedAudioResult {
  transcript: string;
  durationMs: number;
  sampleRate: number;
  waveformPeaks: number[];
  segments: Array<{
    orderIndex: number;
    text: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    wordTimestamps: WordTimestamp[];
    pauseMarkers: PauseMarker[];
  }>;
}

export interface IAudioAnalysisService {
  analyzeAudioBuffer(params: {
    buffer: Buffer;
    mimeType: string;
    knownScriptSegments?: Array<{ id?: string; text: string; durationMs?: number }>;
  }): Promise<AnalyzedAudioResult>;
}

export interface IStoryboardService {
  generateStoryboard(params: {
    topic: string;
    researchSummary?: string;
    worldEnvironment: WorldEnvironment;
    videoStylePreset?: VideoStylePresetId;
    visualDirection?: VisualDirection;
    segments: Array<{
      id: string;
      orderIndex: number;
      text: string;
      startMs: number;
      endMs: number;
      wordTimestamps?: WordTimestamp[];
    }>;
    assets?: ArchivalAsset[];
  }): Promise<Array<Omit<StoryboardBeat, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>>;
}

export interface IFileStorageService {
  saveFile(params: {
    ownerId: string;
    projectId: string;
    folder: 'audio' | 'uploads' | 'renders';
    fileName: string;
    buffer: Buffer;
  }): Promise<{ relativePath: string; publicUrl: string; sizeBytes: number }>;
  resolveSafePath(relativePath: string): string;
  readFile(relativePath: string): Promise<Buffer>;
}

export interface IVideoRenderingService {
  finalizeUploadedVideo(params: {
    ownerId: string;
    projectId: string;
    renderId: string;
    videoBuffer?: Buffer;
    inputFilePath?: string;
    inputExt: string;
    audioRelativePath?: string;
    audioMixConfig?: {
      mixer: AudioMixerSettings;
      sfxEvents: Array<{ timeMs: number; cue: SfxCueType }>;
    };
    width: number;
    height: number;
    fps: number;
  }): Promise<{
    outputUrl: string;
    fileSizeBytes: number;
    durationSec: number;
    codecInfo: string;
    qaFrames: Array<{ timeSec: number; label: string; dataUrl: string }>;
    qaChecks: Array<{ category: 'voice' | 'visual' | 'technical'; label: string; passed: boolean; detail: string }>;
    blackFramesDetected: number;
    audioSyncDeltaMs: number;
  }>;
}
