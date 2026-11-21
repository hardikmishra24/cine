import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Sliders,
  Upload,
  Volume2,
} from 'lucide-react';
import { apiFetch, authedMediaUrl } from '../lib/apiClient';
import {
  replaceNarrationSegments,
  updateNarrationSegmentDoc,
} from '../lib/firestoreStore';
import { formatMsRange, formatShortDuration, formatTimecode } from '../lib/timecode';
import {
  NARRATION_PRESETS,
  type AudioPostProcessing,
  type NarrationPresetId,
  type NarrationSegment,
  type Project,
  type ScriptVersion,
  type VoiceProfile,
} from '../types/cineforge';
import { StageProgressBanner, type StageSubStep } from './StageProgressBanner';

const VOICE_FULL_STEPS: StageSubStep[] = [
  { id: 'profile', label: 'Locking Voice Profile', detail: 'Narrator cast & pacing' },
  { id: 'synth', label: 'Synthesizing Segments', detail: 'Neural TTS generation' },
  { id: 'dsp', label: 'Broadcast FFmpeg DSP', detail: 'Loudness, EQ & de-essing' },
  { id: 'align', label: 'Extracting Timestamps', detail: 'Word-level master timeline' },
];

const VOICE_SAMPLE_STEPS: StageSubStep[] = [
  { id: 'prep', label: 'Preparing Opening Lines', detail: 'Pronunciation & cadence cues' },
  { id: 'tts', label: 'Synthesizing Voice Sample', detail: 'Neural TTS audition take' },
  { id: 'dsp', label: 'Applying Broadcast DSP', detail: 'Target -16 LUFS mastering' },
];

const VOICE_UPLOAD_STEPS: StageSubStep[] = [
  { id: 'store', label: 'Preserving Original Audio', detail: 'Zero alteration to speaker voice' },
  { id: 'wave', label: 'Analyzing Waveform', detail: 'Detecting natural pauses & peaks' },
  { id: 'words', label: 'Extracting Word Timestamps', detail: 'Building Master Timeline' },
];

interface VoiceStudioViewProps {
  project: Project;
  activeScript: ScriptVersion | null;
  segments: NarrationSegment[];
  elevenLabsConfigured: boolean;
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onNavigateStoryboard: () => void;
  onToast: (msg: string) => void;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

const VOICE_CAST: Array<{ name: VoiceProfile['voiceName']; gender: 'male' | 'female'; character: string }> = [
  { name: 'Charon', gender: 'male', character: 'Deep, grounded documentary baritone' },
  { name: 'Fenrir', gender: 'male', character: 'Resonant, warm archival storyteller' },
  { name: 'Puck', gender: 'male', character: 'Crisp, articulate investigative journalist' },
  { name: 'Kore', gender: 'female', character: 'Clear, composed authoritative narrator' },
  { name: 'Zephyr', gender: 'female', character: 'Reflective, intimate documentary warmth' },
];

export function VoiceStudioView({
  project,
  activeScript,
  segments,
  elevenLabsConfigured,
  onUpdateProject,
  onNavigateStoryboard,
  onToast,
  onBusyChange,
}: VoiceStudioViewProps) {
  const defaultProfile: VoiceProfile = project.voiceProfile || {
    provider: 'gemini',
    voiceName: 'Charon',
    gender: 'male',
    language: project.narratorLanguage || 'English',
    regionalAccent: project.narratorAccent || 'Neutral Documentary',
    vocalDepth: 'baritone',
    speakingSpeed: 0.96,
    emotionalCharacter: NARRATION_PRESETS.investigative.description,
    narrationStyle: NARRATION_PRESETS.investigative.label,
    preset: 'investigative',
    approved: false,
  };

  const defaultPost: AudioPostProcessing = project.audioPostProcessing || {
    loudnessNormalization: true,
    targetLufs: -16,
    warmEq: true,
    gentleCompression: true,
    deEsser: true,
    noiseReduction: true,
  };

  const [profile, setProfile] = useState<VoiceProfile>(defaultProfile);
  const [post, setPost] = useState<AudioPostProcessing>(defaultPost);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [samplePlayUrl, setSamplePlayUrl] = useState<string>('');
  const [generatingAll, setGeneratingAll] = useState(false);
  const [synthProgress, setSynthProgress] = useState<{ current: number; total: number } | null>(null);
  const [generatingSegId, setGeneratingSegId] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [uploadingVo, setUploadingVo] = useState(false);
  const [subStepTicker, setSubStepTicker] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isAnyVoiceBusy =
    sampleLoading || generatingAll || assembling || uploadingVo || Boolean(generatingSegId);

  useEffect(() => {
    if (!isAnyVoiceBusy) {
      setSubStepTicker(0);
      onBusyChange?.(false);
      return;
    }
    const msg = generatingAll && synthProgress
      ? `Synthesizing narration segment ${synthProgress.current} of ${synthProgress.total}...`
      : assembling
      ? 'Assembling Master WAV & extracting word timestamps...'
      : sampleLoading
      ? 'Synthesizing opening voice audition sample...'
      : uploadingVo
      ? 'Analyzing uploaded voiceover & extracting timestamps...'
      : 'Regenerating narration segment retake...';
    onBusyChange?.(true, msg);
  }, [
    isAnyVoiceBusy,
    generatingAll,
    synthProgress,
    assembling,
    sampleLoading,
    uploadingVo,
    onBusyChange,
  ]);

  useEffect(() => {
    if (!sampleLoading && !uploadingVo && !generatingSegId) {
      setSubStepTicker(0);
      return;
    }
    setSubStepTicker(0);
    const id = window.setInterval(() => {
      setSubStepTicker((prev) => (prev < 1 ? prev + 1 : prev));
    }, 2200);
    return () => window.clearInterval(id);
  }, [sampleLoading, uploadingVo, generatingSegId]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  // Master waveform player state
  const masterAudioRef = useRef<HTMLAudioElement | null>(null);
  const [masterPlayUrl, setMasterPlayUrl] = useState<string>('');
  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const [masterTimeMs, setMasterTimeMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [expandedSegId, setExpandedSegId] = useState<string | null>(null);
  const [pronHints, setPronHints] = useState<Record<string, string>>({});

  useEffect(() => {
    if (project.voiceProfile?.sampleAudioUrl) {
      authedMediaUrl(project.voiceProfile.sampleAudioUrl).then(setSamplePlayUrl).catch(() => {});
    }
  }, [project.voiceProfile?.sampleAudioUrl]);

  useEffect(() => {
    if (project.masterAudio?.audioUrl) {
      authedMediaUrl(project.masterAudio.audioUrl).then(setMasterPlayUrl).catch(() => {});
    } else {
      setMasterPlayUrl('');
    }
  }, [project.masterAudio?.audioUrl]);

  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => a.orderIndex - b.orderIndex),
    [segments]
  );

  const openingText = useMemo(() => {
    if (activeScript?.paragraphs?.[0]?.text) return activeScript.paragraphs[0].text;
    if (sortedSegments[0]?.text) return sortedSegments[0].text;
    return `In the quiet archives of ${project.title || 'modern history'}, a single photograph reveals how events unfolded far differently than most remember.`;
  }, [activeScript, sortedSegments, project.title]);

  const globalPronHint = useMemo(() => {
    if (!activeScript?.pronunciationGuide?.length) return '';
    return activeScript.pronunciationGuide.map((p) => `${p.term} (${p.phonetic})`).join('; ');
  }, [activeScript]);

  const applyPreset = (presetId: NarrationPresetId) => {
    const p = NARRATION_PRESETS[presetId];
    setProfile((prev) => ({
      ...prev,
      preset: presetId,
      narrationStyle: p.label,
      emotionalCharacter: p.description,
      speakingSpeed: p.defaultSpeed,
      vocalDepth: p.defaultDepth,
      voiceName: prev.gender === 'female' ? (presetId === 'reflective' ? 'Zephyr' : 'Kore') : p.recommendedVoice,
      approved: false,
    }));
  };

  const handleGenerateSample = async () => {
    setSampleLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ audioUrl: string; durationMs: number; providerUsed: string }>('/api/voice/sample', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          text: openingText,
          voiceProfile: profile,
          pronunciationHint: globalPronHint,
          postProcessing: post,
        }),
      });
      const updatedProfile: VoiceProfile = {
        ...profile,
        sampleAudioUrl: res.audioUrl,
        sampleText: openingText.slice(0, 320),
        approved: false,
      };
      setProfile(updatedProfile);
      await onUpdateProject({
        voiceProfile: updatedProfile,
        audioPostProcessing: post,
      });
      const resolved = await authedMediaUrl(res.audioUrl);
      setSamplePlayUrl(resolved);
      onToast(`Voice sample ready (${(res.durationMs / 1000).toFixed(1)}s via ${res.providerUsed.toUpperCase()} TTS).`);
    } catch (err: any) {
      setError(err?.message || 'Voice sample generation failed.');
    } finally {
      setSampleLoading(false);
    }
  };

  const handleApproveVoiceProfile = async () => {
    const approvedProfile: VoiceProfile = { ...profile, approved: true };
    setProfile(approvedProfile);
    await onUpdateProject({
      voiceProfile: approvedProfile,
      audioPostProcessing: post,
    });
    onToast('Voice profile approved. Ready to synthesize full documentary narration.');
  };

  const handleGenerateFullNarration = async () => {
    const sourceParagraphs = activeScript?.paragraphs || [];
    if (sourceParagraphs.length === 0) {
      setError('Please generate and approve your script in Script Studio first.');
      return;
    }

    setGeneratingAll(true);
    setSynthProgress({ current: 1, total: sourceParagraphs.length });
    setError(null);
    try {
      const generatedRecords: Array<
        Omit<NarrationSegment, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>
      > = [];

      for (let i = 0; i < sourceParagraphs.length; i++) {
        setSynthProgress({ current: i + 1, total: sourceParagraphs.length });
        const para = sourceParagraphs[i];
        const res = await apiFetch<{
          audioUrl: string;
          durationMs: number;
          wordTimestamps: any[];
          pauseMarkers: any[];
        }>('/api/voice/generate-segment', {
          method: 'POST',
          body: JSON.stringify({
            projectId: project.id,
            segmentIndex: i,
            text: para.text,
            voiceProfile: { ...profile, approved: true },
            pronunciationHint: globalPronHint,
            postProcessing: post,
          }),
        });

        generatedRecords.push({
          orderIndex: i,
          text: para.text,
          pronunciationHint: globalPronHint,
          audioUrl: res.audioUrl,
          durationMs: res.durationMs,
          status: 'generated',
          wordTimestamps: res.wordTimestamps,
          pauseMarkers: res.pauseMarkers,
          version: 1,
        });
      }

      const savedSegments = await replaceNarrationSegments(
        project.id,
        generatedRecords,
        segments.map((s) => s.id)
      );

      // Immediately assemble Master Audio & extract accurate global timeline timestamps
      await assembleAndAnalyzeMaster(savedSegments);
      onToast(`Synthesized all ${savedSegments.length} segments and built Master Audio Timeline.`);
    } catch (err: any) {
      setError(err?.message || 'Full narration synthesis failed.');
    } finally {
      setGeneratingAll(false);
      setSynthProgress(null);
    }
  };

  const assembleAndAnalyzeMaster = async (segsToAssemble: NarrationSegment[]) => {
    setAssembling(true);
    setError(null);
    try {
      const res = await apiFetch<{
        masterAudio: Project['masterAudio'];
        analyzedSegments: Array<{
          orderIndex: number;
          startMs: number;
          endMs: number;
          durationMs: number;
          wordTimestamps: any[];
          pauseMarkers: any[];
        }>;
      }>('/api/voice/assemble-master', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          segments: segsToAssemble.map((s) => ({
            id: s.id,
            orderIndex: s.orderIndex,
            text: s.text,
            audioUrl: s.audioUrl,
            durationMs: s.durationMs,
          })),
        }),
      });

      // Update each segment with exact master-timeline global word timestamps
      for (let i = 0; i < segsToAssemble.length; i++) {
        const analyzed = res.analyzedSegments[i];
        if (analyzed) {
          await updateNarrationSegmentDoc(project.id, segsToAssemble[i].id, {
            durationMs: analyzed.durationMs,
            wordTimestamps: analyzed.wordTimestamps,
            pauseMarkers: analyzed.pauseMarkers,
            status: 'approved',
          });
        }
      }

      await onUpdateProject({
        masterAudio: res.masterAudio,
        narrationDurationSec: Math.round((res.masterAudio?.durationMs || 0) / 1000),
        voiceApproved: true,
        voiceProfile: { ...profile, approved: true },
        audioPostProcessing: post,
        activeStage: 'assets',
      });
    } catch (err: any) {
      setError(err?.message || 'Master audio assembly failed.');
    } finally {
      setAssembling(false);
    }
  };

  const handleRegenerateSingleSegment = async (seg: NarrationSegment) => {
    setGeneratingSegId(seg.id);
    setError(null);
    try {
      const hint = pronHints[seg.id] || seg.pronunciationHint || globalPronHint;
      const res = await apiFetch<{
        audioUrl: string;
        durationMs: number;
        wordTimestamps: any[];
        pauseMarkers: any[];
      }>('/api/voice/generate-segment', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          segmentIndex: seg.orderIndex,
          text: seg.text,
          voiceProfile: profile,
          pronunciationHint: hint,
          postProcessing: post,
        }),
      });

      await updateNarrationSegmentDoc(project.id, seg.id, {
        audioUrl: res.audioUrl,
        durationMs: res.durationMs,
        pronunciationHint: hint,
        wordTimestamps: res.wordTimestamps,
        pauseMarkers: res.pauseMarkers,
        version: (seg.version || 1) + 1,
        status: 'generated',
      });

      const updatedList = sortedSegments.map((s) =>
        s.id === seg.id ? { ...s, audioUrl: res.audioUrl, durationMs: res.durationMs } : s
      );
      if (updatedList.every((s) => Boolean(s.audioUrl))) {
        await assembleAndAnalyzeMaster(updatedList);
      }
      onToast(`Regenerated Segment ${seg.orderIndex + 1} without replacing other approved segments.`);
    } catch (err: any) {
      setError(err?.message || 'Segment regeneration failed.');
    } finally {
      setGeneratingSegId(null);
    }
  };

  const handleUploadExistingVoiceover = async (file: File) => {
    setUploadingVo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('projectId', project.id);
      form.append('audio', file);
      const res = await apiFetch<{
        masterAudio: Project['masterAudio'];
        transcript: string;
        analyzedSegments: Array<{
          orderIndex: number;
          text: string;
          startMs: number;
          endMs: number;
          durationMs: number;
          wordTimestamps: any[];
          pauseMarkers: any[];
        }>;
      }>('/api/audio/upload-and-analyze', {
        method: 'POST',
        body: form,
      });

      await replaceNarrationSegments(
        project.id,
        res.analyzedSegments.map((s) => ({
          orderIndex: s.orderIndex,
          text: s.text,
          audioUrl: res.masterAudio?.audioUrl,
          durationMs: s.durationMs,
          status: 'uploaded',
          wordTimestamps: s.wordTimestamps,
          pauseMarkers: s.pauseMarkers,
          version: 1,
        })),
        segments.map((s) => s.id)
      );

      await onUpdateProject({
        masterAudio: res.masterAudio,
        narrationDurationSec: Math.round((res.masterAudio?.durationMs || 0) / 1000),
        voiceApproved: true,
        activeStage: 'assets',
      });
      onToast('Uploaded voiceover preserved and analyzed into word-level Master Timeline.');
    } catch (err: any) {
      setError(err?.message || 'Voiceover upload and transcription failed.');
    } finally {
      setUploadingVo(false);
    }
  };

  const toggleMasterPlay = () => {
    const el = masterAudioRef.current;
    if (!el) return;
    if (isPlayingMaster) {
      el.pause();
      setIsPlayingMaster(false);
    } else {
      el.playbackRate = playbackRate;
      el.volume = volume;
      el.play().catch(() => {});
      setIsPlayingMaster(true);
    }
  };

  const seekMaster = (ms: number) => {
    const el = masterAudioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setMasterTimeMs(ms);
  };

  const playSegmentPreview = async (seg: NarrationSegment) => {
    if (!seg.audioUrl) return;
    const url = await authedMediaUrl(seg.audioUrl);
    const audio = new Audio(url);
    audio.volume = volume;
    audio.playbackRate = playbackRate;
    audio.play().catch(() => {});
  };

  const handleDownloadMaster = async () => {
    if (!project.masterAudio?.audioUrl) return;
    const url = await authedMediaUrl(project.masterAudio.audioUrl, true);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_narration.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const peaks = project.masterAudio?.waveformPeaks || [];
  const totalMasterMs = project.masterAudio?.durationMs || 0;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-[#E5A03A] font-medium">
            Step 03 of 07 · Voice First · Neural Narration & Master Audio Timeline
          </p>
          <h1 className="font-display text-3xl font-semibold text-[#F4F4F6]">Voice Studio</h1>
          <p className="text-sm text-[#989CA8]">
            The approved voiceover is the timing master for the entire documentary. Audition a sample, approve your narrator, and extract exact word timestamps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-[#16171D] border border-[#262933] hover:border-[#E5A03A] text-[#D4D6DC] rounded-lg cursor-pointer whitespace-nowrap shrink-0">
            {uploadingVo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload Voiceover Audio
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadExistingVoiceover(f);
              }}
            />
          </label>

          {project.masterAudio && (
            <button
              onClick={onNavigateStoryboard}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] whitespace-nowrap shrink-0"
            >
              Continue to Storyboard
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isAnyVoiceBusy && (
          <StageProgressBanner
            stepNumber={3}
            title={
              generatingAll || assembling
                ? 'Synthesizing Complete Documentary Narration'
                : sampleLoading
                ? 'Generating Opening Voice Audition Sample'
                : uploadingVo
                ? 'Analyzing Uploaded Voiceover Recording'
                : 'Regenerating Targeted Narration Segment'
            }
            statusMessage={
              generatingAll && synthProgress
                ? `Synthesizing segment ${synthProgress.current} of ${synthProgress.total} with ${profile.voiceName} (${profile.narrationStyle})...`
                : assembling
                ? 'Assembling Master WAV track, measuring waveform peaks, and locking word-level timestamps...'
                : sampleLoading
                ? `Auditioning ${profile.voiceName} narrator on opening paragraph with broadcast EQ...`
                : uploadingVo
                ? 'Preserving original speaker audio while extracting accurate word timestamps...'
                : 'Re-synthesizing segment retake and synchronizing global timeline...'
            }
            subSteps={
              generatingAll || assembling
                ? VOICE_FULL_STEPS
                : uploadingVo
                ? VOICE_UPLOAD_STEPS
                : VOICE_SAMPLE_STEPS
            }
            activeSubStepIndex={
              assembling
                ? 3
                : generatingAll
                ? synthProgress && synthProgress.current > 1
                  ? 1
                  : 1
                : subStepTicker
            }
            progressPercent={
              generatingAll && synthProgress
                ? Math.round(12 + ((synthProgress.current - 0.35) / Math.max(1, synthProgress.total)) * 62)
                : assembling
                ? 88
                : undefined
            }
          />
        )}
      </AnimatePresence>

      {error && (
        <div className="p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      {/* Top Grid: Voice Selection & Documentary Presets + Opening Sample Gate */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Voice Engine, Presets & Parameters */}
        <section className="lg:col-span-7 bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F4F4F6]">Narrator Configuration & Documentary Presets</h2>
            <span className="text-xs text-[#989CA8]">
              Engine: {profile.provider === 'elevenlabs' && elevenLabsConfigured ? 'ElevenLabs' : 'Gemini 3.8 Neural TTS'}
            </span>
          </div>

          {/* 7 Documentary Presets */}
          <div className="space-y-2">
            <div className="text-xs text-[#989CA8]">Documentary Narration Style Preset</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(Object.entries(NARRATION_PRESETS) as Array<[NarrationPresetId, (typeof NARRATION_PRESETS)[NarrationPresetId]]>).map(
                ([id, item]) => {
                  const active = profile.preset === id;
                  return (
                    <button
                      key={id}
                      onClick={() => applyPreset(id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        active
                          ? 'bg-[#1E2028] border-[#E5A03A]'
                          : 'bg-[#0B0B0D] border-[#262933] hover:border-[#3A3F4E]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#F4F4F6]">{item.label}</div>
                      <div className="text-[11px] text-[#989CA8] mt-0.5 line-clamp-1">{item.description}</div>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Voice Cast + Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#262933]">
            <div>
              <label className="block text-xs text-[#989CA8] mb-1">TTS Provider</label>
              <select
                value={profile.provider}
                onChange={(e) => setProfile({ ...profile, provider: e.target.value as 'gemini' | 'elevenlabs', approved: false })}
                className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
              >
                <option value="gemini">Gemini Neural TTS (Primary)</option>
                <option value="elevenlabs" disabled={!elevenLabsConfigured}>
                  ElevenLabs {elevenLabsConfigured ? '(Active)' : '(Optional · Server Secret)'}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#989CA8] mb-1">Neural Voice Cast</label>
              <select
                value={profile.voiceName}
                onChange={(e) => {
                  const chosen = VOICE_CAST.find((v) => v.name === e.target.value);
                  setProfile({
                    ...profile,
                    voiceName: e.target.value as VoiceProfile['voiceName'],
                    gender: chosen?.gender || profile.gender,
                    approved: false,
                  });
                }}
                className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
              >
                {VOICE_CAST.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.gender}) · {v.character.slice(0, 26)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#989CA8] mb-1">Vocal Depth</label>
              <select
                value={profile.vocalDepth}
                onChange={(e) => setProfile({ ...profile, vocalDepth: e.target.value as VoiceProfile['vocalDepth'], approved: false })}
                className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
              >
                <option value="deep">Deep Resonant</option>
                <option value="baritone">Grounded Baritone</option>
                <option value="warm">Warm Close-Mic</option>
                <option value="medium">Balanced Midrange</option>
                <option value="crisp">Crisp Journalistic</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#989CA8] mb-1">Language</label>
              <input
                value={profile.language}
                onChange={(e) => setProfile({ ...profile, language: e.target.value, approved: false })}
                className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#989CA8] mb-1">Regional Accent</label>
              <input
                value={profile.regionalAccent}
                onChange={(e) => setProfile({ ...profile, regionalAccent: e.target.value, approved: false })}
                className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#989CA8] mb-1">
                Speaking Speed (<span className="font-mono-tabular">{profile.speakingSpeed.toFixed(2)}x</span>)
              </label>
              <input
                type="range"
                min={0.82}
                max={1.15}
                step={0.02}
                value={profile.speakingSpeed}
                onChange={(e) => setProfile({ ...profile, speakingSpeed: Number(e.target.value), approved: false })}
                className="w-full accent-[#E5A03A] mt-2"
              />
            </div>
          </div>

          {/* Audio Post-Processing DSP Chain */}
          <div className="pt-4 border-t border-[#262933] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F4F6]">
                <Sliders className="w-3.5 h-3.5 text-[#E5A03A]" />
                Broadcast Audio Post-Processing (FFmpeg DSP Chain)
              </div>
              <span className="font-mono-tabular text-[11px] text-[#989CA8]">
                Target {post.targetLufs} LUFS
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              {(
                [
                  { key: 'loudnessNormalization', label: 'Loudness Normalization' },
                  { key: 'warmEq', label: 'Warm Documentary EQ' },
                  { key: 'gentleCompression', label: 'Gentle Compression' },
                  { key: 'deEsser', label: 'Natural De-Essing' },
                  { key: 'noiseReduction', label: 'Sub-75Hz Noise Floor' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-[#0B0B0D] border border-[#262933] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(post[opt.key])}
                    onChange={(e) => setPost({ ...post, [opt.key]: e.target.checked })}
                    className="accent-[#E5A03A]"
                  />
                  <span className="text-[#D4D6DC]">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Right 5 cols: Voice Preview & Approval Gate */}
        <section className="lg:col-span-5 bg-[#16171D] border border-[#262933] rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#F4F4F6]">Step 1 · Voice Audition & Approval</h2>
              <Mic className="w-4 h-4 text-[#E5A03A]" />
            </div>
            <p className="text-xs text-[#989CA8] leading-relaxed">
              Generate an opening-paragraph sample first. Audition the vocal cadence, warmth, and pronunciation before synthesizing the complete documentary narration.
            </p>
            <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-[#262933] text-xs text-[#D4D6DC] leading-relaxed max-h-32 overflow-y-auto">
              "{openingText}"
            </div>

            {samplePlayUrl && (
              <div className="p-3.5 rounded-lg bg-[#0B0B0D] border border-[#262933] space-y-2">
                <div className="text-[11px] text-[#989CA8]">Generated Opening Sample (AI-synthesized narration)</div>
                <audio controls src={samplePlayUrl} className="w-full h-9" />
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-3 border-t border-[#262933]">
            <button
              onClick={handleGenerateSample}
              disabled={sampleLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1E2028] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-lg transition-colors disabled:opacity-60"
            >
              {sampleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4 text-[#E5A03A]" />}
              {samplePlayUrl ? 'Generate Alternative Voice Sample' : 'Generate Opening Voice Sample'}
            </button>

            <button
              onClick={handleApproveVoiceProfile}
              disabled={!samplePlayUrl}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
                profile.approved
                  ? 'border-[#22C55E]/50 bg-[#22C55E]/10 text-[#22C55E]'
                  : 'border-[#E5A03A] text-[#E5A03A] hover:bg-[#E5A03A]/10'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {profile.approved ? 'Voice Profile Approved' : 'Approve Voice Profile'}
            </button>

            <button
              onClick={handleGenerateFullNarration}
              disabled={generatingAll || !profile.approved || !activeScript?.paragraphs?.length}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors disabled:opacity-40"
            >
              {generatingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Synthesizing Full Narration & Extracting Timestamps...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4" />
                  Generate Complete Narration & Master Timeline
                </>
              )}
            </button>
          </div>
        </section>
      </div>

      {/* Master Audio Waveform & Analysis Timeline */}
      {project.masterAudio && (
        <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F4F4F6]">
                Master Narration Timeline {project.masterAudio.isUploadedOriginal ? '(Preserved Original Voiceover)' : '(Assembled Master WAV)'}
              </h2>
              <div className="flex items-center gap-2 text-xs text-[#989CA8] font-mono-tabular mt-0.5">
                <span>Duration {formatShortDuration(totalMasterMs / 1000)}</span>
                <span aria-hidden="true">·</span>
                <span>{(project.masterAudio.sampleRate / 1000).toFixed(1)} kHz PCM</span>
                <span aria-hidden="true">·</span>
                <span>{sortedSegments.length} timed segments</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={toggleMasterPlay}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] whitespace-nowrap shrink-0"
              >
                {isPlayingMaster ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlayingMaster ? 'Pause' : 'Play Master'}
              </button>

              <span className="font-mono-tabular text-xs text-[#F4F4F6] bg-[#0B0B0D] border border-[#262933] px-2.5 py-1.5 rounded">
                {formatTimecode(masterTimeMs, project.frameRate || 30)}
              </span>

              <select
                value={playbackRate}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  setPlaybackRate(r);
                  if (masterAudioRef.current) masterAudioRef.current.playbackRate = r;
                }}
                className="bg-[#0B0B0D] border border-[#262933] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#D4D6DC]"
                title="Playback speed"
              >
                <option value={0.85}>0.85x</option>
                <option value={1.0}>1.0x</option>
                <option value={1.15}>1.15x</option>
                <option value={1.35}>1.35x</option>
              </select>

              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (masterAudioRef.current) masterAudioRef.current.volume = v;
                }}
                className="w-20 accent-[#E5A03A]"
                title="Volume"
              />

              <button
                onClick={handleDownloadMaster}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] text-[#D4D6DC] rounded-lg whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                WAV
              </button>
            </div>
          </div>

          {masterPlayUrl && (
            <audio
              ref={masterAudioRef}
              src={masterPlayUrl}
              onTimeUpdate={(e) => setMasterTimeMs(Math.round(e.currentTarget.currentTime * 1000))}
              onEnded={() => setIsPlayingMaster(false)}
              className="hidden"
            />
          )}

          {/* Interactive Waveform Visualization */}
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekMaster(Math.round(ratio * totalMasterMs));
            }}
            className="relative h-24 bg-[#0B0B0D] border border-[#262933] rounded-lg px-2 flex items-center gap-[2px] cursor-pointer overflow-hidden"
          >
            {(peaks.length > 0 ? peaks : Array.from({ length: 120 }, () => 0.35)).map((amp, i, arr) => {
              const frac = i / Math.max(1, arr.length);
              const played = totalMasterMs > 0 && frac <= masterTimeMs / totalMasterMs;
              const hPct = Math.max(10, Math.round(amp * 88));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${
                    played ? 'bg-[#E5A03A]' : 'bg-[#363B4A]'
                  }`}
                  style={{ height: `${hPct}%` }}
                />
              );
            })}
            {/* Playhead Needle */}
            {totalMasterMs > 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#F4F4F6] pointer-events-none"
                style={{ left: `${Math.min(100, (masterTimeMs / totalMasterMs) * 100)}%` }}
              />
            )}
          </div>
        </section>
      )}

      {/* Individual Narration Segments + Word-Level Timestamp Inspector */}
      {sortedSegments.length > 0 && (
        <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F4F4F6]">
              Narration Segments & Extracted Word Timestamps
            </h2>
            {!project.masterAudio?.isUploadedOriginal && sortedSegments.every((s) => Boolean(s.audioUrl)) && (
              <button
                onClick={() => assembleAndAnalyzeMaster(sortedSegments)}
                disabled={assembling}
                className="text-xs text-[#E5A03A] hover:text-[#F0B254] inline-flex items-center gap-1.5"
              >
                {assembling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Re-Assemble Master WAV
              </button>
            )}
          </div>

          <div className="divide-y divide-[#262933]">
            {sortedSegments.map((seg) => {
              const firstWord = seg.wordTimestamps?.[0];
              const lastWord = seg.wordTimestamps?.[seg.wordTimestamps.length - 1];
              const rangeLabel =
                firstWord && lastWord
                  ? formatMsRange(firstWord.startMs, lastWord.endMs)
                  : `${(seg.durationMs / 1000).toFixed(1)}s`;
              const isExpanded = expandedSegId === seg.id;

              return (
                <div key={seg.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => playSegmentPreview(seg)}
                        disabled={!seg.audioUrl}
                        className="w-8 h-8 rounded-lg bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] flex items-center justify-center text-[#E5A03A] shrink-0 disabled:opacity-40"
                        title="Play segment take"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <div>
                        <div className="text-xs font-semibold text-[#F4F4F6]">
                          Segment {String(seg.orderIndex + 1).padStart(2, '0')}
                          <span className="font-mono-tabular font-normal text-[#989CA8] ml-2">
                            {rangeLabel}
                          </span>
                          <span className="font-normal text-[#989CA8] ml-2">
                            · v{seg.version || 1} · {seg.wordTimestamps?.length || 0} words · {seg.pauseMarkers?.length || 0} pauses
                          </span>
                        </div>
                        <p className="text-xs text-[#D4D6DC] mt-1 leading-relaxed">{seg.text}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setExpandedSegId(isExpanded ? null : seg.id)}
                        className="px-2.5 py-1.5 text-[11px] text-[#989CA8] hover:text-[#F4F4F6] bg-[#0B0B0D] border border-[#262933] rounded-md whitespace-nowrap shrink-0"
                      >
                        {isExpanded ? 'Hide Timestamps' : 'Word Timestamps'}
                      </button>
                      {!project.masterAudio?.isUploadedOriginal && (
                        <button
                          onClick={() => handleRegenerateSingleSegment(seg)}
                          disabled={generatingSegId === seg.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-[#1E2028] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-md whitespace-nowrap shrink-0"
                        >
                          {generatingSegId === seg.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Regenerate
                        </button>
                      )}
                    </div>
                  </div>

                  {!project.masterAudio?.isUploadedOriginal && (
                    <input
                      value={pronHints[seg.id] ?? seg.pronunciationHint ?? ''}
                      onChange={(e) => setPronHints((p) => ({ ...p, [seg.id]: e.target.value }))}
                      placeholder="Pronunciation override for this segment only (e.g., Voyager = VOY-uh-jer)..."
                      className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-3 py-1.5 text-[11px] text-[#D4D6DC] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A]"
                    />
                  )}

                  {isExpanded && seg.wordTimestamps && seg.wordTimestamps.length > 0 && (
                    <div className="p-3 bg-[#0B0B0D] border border-[#262933] rounded-lg flex flex-wrap gap-1.5">
                      {seg.wordTimestamps.map((w, wi) => (
                        <button
                          key={wi}
                          onClick={() => seekMaster(w.startMs)}
                          className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                            w.emphasis
                              ? 'bg-[#E5A03A]/15 text-[#E5A03A] border border-[#E5A03A]/30'
                              : 'bg-[#16171D] text-[#D4D6DC] hover:bg-[#1E2028]'
                          }`}
                          title={`${(w.startMs / 1000).toFixed(2)}s – ${(w.endMs / 1000).toFixed(2)}s`}
                        >
                          {w.word}{' '}
                          <span className="font-mono-tabular text-[10px] text-[#7D8291]">
                            {(w.startMs / 1000).toFixed(1)}s
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
