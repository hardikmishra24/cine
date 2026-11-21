import React, { useState } from 'react';
import {
  ArrowRight,
  Compass,
  FileAudio,
  FileText,
  Loader2,
  Mic,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  NARRATION_PRESETS,
  VIDEO_STYLE_PRESETS,
  type InputMode,
  type NarrationPresetId,
  type Project,
  type UploadedReference,
  type VideoStylePresetId,
  type WorldEnvironment,
} from '../types/cineforge';

interface NewProjectWizardProps {
  onCreateProject: (params: {
    projectData: Omit<Project, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;
    suppliedScript?: string;
    voiceoverFile?: File | null;
    referenceFiles: File[];
    autoStartPipeline: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

const SAMPLE_TOPICS = [
  'The 1977 Voyager Golden Record: How Humanity Curated a Message for Deep Space',
  'The 1911 Theft of the Mona Lisa from the Louvre',
  'Operation Mincemeat: The World War II Deception That Reshaped the Mediterranean',
];

export function NewProjectWizard({ onCreateProject, onCancel }: NewProjectWizardProps) {
  const [mode, setMode] = useState<InputMode>('topic');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [suppliedScript, setSuppliedScript] = useState('');
  const [voiceoverFile, setVoiceoverFile] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);

  // Configuration
  const [language, setLanguage] = useState('English');
  const [narratorLanguage, setNarratorLanguage] = useState('English');
  const [narratorAccent, setNarratorAccent] = useState('Neutral Atlantic / Documentary');
  const [preset, setPreset] = useState<NarrationPresetId>('investigative');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [targetDurationSec, setTargetDurationSec] = useState(60);
  const [resolution, setResolution] = useState('1920x1080');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [frameRate, setFrameRate] = useState(30);
  const [worldEnvironment, setWorldEnvironment] = useState<WorldEnvironment>('desk');
  const [videoStylePreset, setVideoStylePreset] = useState<VideoStylePresetId>('historically');
  const [visualStyle, setVisualStyle] = useState(VIDEO_STYLE_PRESETS.historically.label);
  const [researchPreferences, setResearchPreferences] = useState(
    'Prioritize government archives, museum collections, historical newspapers, and public-domain photography.'
  );
  const [autoStartPipeline, setAutoStartPipeline] = useState(true);

  const handleSelectStylePreset = (presetId: VideoStylePresetId) => {
    const info = VIDEO_STYLE_PRESETS[presetId];
    setVideoStylePreset(presetId);
    setWorldEnvironment(info.defaultWorld);
    setVisualStyle(info.label);
  };

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolutionChange = (val: string) => {
    setResolution(val);
    if (val === '1920x1080') setAspectRatio('16:9');
    else if (val === '2560x1080') setAspectRatio('21:9');
    else if (val === '3840x1646') setAspectRatio('2.33:1');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const derivedTitle =
      title.trim() ||
      (mode === 'topic'
        ? topic.trim().slice(0, 72)
        : mode === 'script'
        ? suppliedScript.trim().split('\n')[0]?.slice(0, 72)
        : voiceoverFile?.name.replace(/\.[^.]+$/, '') || 'Voiceover Documentary');

    if (!derivedTitle) {
      setError('Please enter a project title or topic to begin.');
      return;
    }
    if (mode === 'topic' && !topic.trim()) {
      setError('Please describe the documentary topic for autonomous research.');
      return;
    }
    if (mode === 'script' && suppliedScript.trim().length < 25) {
      setError('Please paste a documentary script (at least one paragraph).');
      return;
    }
    if (mode === 'voiceover' && !voiceoverFile) {
      setError('Please upload an existing narration audio file (WAV, MP3, M4A, or WebM).');
      return;
    }

    const presetInfo = NARRATION_PRESETS[preset];
    const voiceName = gender === 'female' ? (preset === 'reflective' ? 'Zephyr' : 'Kore') : presetInfo.recommendedVoice;

    setSubmitting(true);
    try {
      await onCreateProject({
        projectData: {
          title: derivedTitle,
          inputMode: mode,
          topic: topic.trim() || derivedTitle,
          language,
          narratorLanguage,
          narratorAccent,
          voiceCharacter: presetInfo.label,
          targetDurationSec,
          aspectRatio,
          resolution,
          frameRate,
          visualStyle,
          worldEnvironment,
          videoStylePreset,
          status: 'in_production',
          activeStage: mode === 'voiceover' ? 'voice' : 'research',
          narrationDurationSec: 0,
          renderStatus: 'idle',
          researchApproved: false,
          visualDirectionApproved: false,
          scriptApproved: false,
          voiceApproved: mode === 'voiceover',
          storyboardApproved: false,
          researchPreferences,
          voiceProfile: {
            provider: 'gemini',
            voiceName,
            gender,
            language: narratorLanguage,
            regionalAccent: narratorAccent,
            vocalDepth: presetInfo.defaultDepth,
            speakingSpeed: presetInfo.defaultSpeed,
            emotionalCharacter: presetInfo.description,
            narrationStyle: presetInfo.label,
            preset,
            approved: mode === 'voiceover',
          },
          audioPostProcessing: {
            loudnessNormalization: true,
            targetLufs: -16,
            warmEq: true,
            gentleCompression: true,
            deEsser: true,
            noiseReduction: true,
          },
          audioMixer: {
            voiceVolume: 1.0,
            musicVolume: 0.24,
            sfxVolume: 0.48,
            autoDucking: true,
            duckingDepthDb: 10,
            ambientBed: VIDEO_STYLE_PRESETS[videoStylePreset].defaultAmbientBed,
          },
          uploadedReferences: [] as UploadedReference[],
        },
        suppliedScript: mode === 'script' ? suppliedScript.trim() : undefined,
        voiceoverFile: mode === 'voiceover' ? voiceoverFile : null,
        referenceFiles,
        autoStartPipeline,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not initialize documentary project.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 lg:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#F4F4F6]">
            New Documentary Production
          </h1>
          <p className="text-sm text-[#989CA8] mt-1">
            Choose your starting material. CineForge autonomously researches verified facts, sources authentic photographs, and builds the complete production around your approved voiceover.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-[#989CA8] hover:text-[#F4F4F6] border border-[#262933] rounded-lg whitespace-nowrap shrink-0"
        >
          Back to Desk
        </button>
      </div>

      {/* Mode A / Mode B / Mode C Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            id: 'topic' as const,
            title: 'Mode A · Topic Production',
            desc: 'Enter only a subject. CineForge researches archives, writes the script, collects real photos, and narrates.',
            icon: Compass,
          },
          {
            id: 'script' as const,
            title: 'Mode B · Script Production',
            desc: 'Supply an existing script. CineForge refines spoken rhythm, verifies facts, and collects archival visuals.',
            icon: FileText,
          },
          {
            id: 'voiceover' as const,
            title: 'Mode C · Existing Voiceover',
            desc: 'Upload your recorded narration. CineForge preserves your voice, extracts exact timestamps, and directs visuals.',
            icon: Mic,
          },
        ].map((item) => {
          const Icon = item.icon;
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`text-left p-5 rounded-xl border transition-colors ${
                active
                  ? 'bg-[#1E2028] border-[#E5A03A]'
                  : 'bg-[#16171D] border-[#262933] hover:border-[#3A3F4E]'
              }`}
            >
              <Icon className={`w-5 h-5 mb-3 ${active ? 'text-[#E5A03A]' : 'text-[#989CA8]'}`} />
              <div className="text-sm font-semibold text-[#F4F4F6]">{item.title}</div>
              <p className="text-xs text-[#989CA8] mt-1.5 leading-relaxed">{item.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Primary Input Section */}
      <div className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-[#D4D6DC] mb-1.5">
              Project Title
            </label>
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., The Golden Record Beyond Neptune"
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3.5 py-2.5 text-sm text-[#F4F4F6] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#D4D6DC] mb-1.5">
              Documentary Subject / Research Focus
            </label>
            <input
              type="text"
              maxLength={4000}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Historical event, investigation, biography, or scientific milestone"
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3.5 py-2.5 text-sm text-[#F4F4F6] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
        </div>

        {mode === 'topic' && (
          <div className="space-y-2">
            <div className="text-xs text-[#989CA8]">Quick historical briefs:</div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_TOPICS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setTopic(sample);
                    if (!title) setTitle(sample.split(':')[0]);
                  }}
                  className="text-left text-xs px-3 py-1.5 bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] rounded-lg text-[#D4D6DC] transition-colors"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'script' && (
          <div>
            <label className="block text-xs font-medium text-[#D4D6DC] mb-1.5">
              Documentary Script (Factual meaning will be preserved strictly)
            </label>
            <textarea
              rows={7}
              value={suppliedScript}
              onChange={(e) => setSuppliedScript(e.target.value)}
              placeholder="Paste your documentary script here. Separate paragraphs will map cleanly to narration segments..."
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3.5 py-3 text-sm text-[#F4F4F6] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A] leading-relaxed"
            />
          </div>
        )}

        {mode === 'voiceover' && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#D4D6DC]">
              Upload Existing Narration Audio (WAV, MP3, M4A, WebM)
            </label>
            <label className="flex flex-col items-center justify-center border border-dashed border-[#3A3F4E] hover:border-[#E5A03A] rounded-xl p-6 bg-[#0B0B0D] cursor-pointer transition-colors">
              <FileAudio className="w-6 h-6 text-[#E5A03A] mb-2" />
              <span className="text-sm text-[#F4F4F6] font-medium">
                {voiceoverFile ? voiceoverFile.name : 'Select recorded narration audio file'}
              </span>
              <span className="text-xs text-[#989CA8] mt-1">
                {voiceoverFile
                  ? `${(voiceoverFile.size / (1024 * 1024)).toFixed(2)} MB · Original voice will be preserved`
                  : 'CineForge will transcribe and extract exact speech timestamps automatically'}
              </span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => setVoiceoverFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        )}

        {/* Optional Reference Material Uploads */}
        <div className="pt-2 border-t border-[#262933] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#D4D6DC]">
              Optional Reference Uploads (Images, PDFs, Text Notes — never required)
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-[#E5A03A] hover:text-[#F0B254] cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Attach Files
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setReferenceFiles((prev) => [...prev, ...files].slice(0, 8));
                }}
              />
            </label>
          </div>
          {referenceFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {referenceFiles.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-[#0B0B0D] border border-[#262933] rounded-md text-xs text-[#D4D6DC]"
                >
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setReferenceFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-[#989CA8] hover:text-[#EF4444]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Visual Storytelling Style Preset Picker */}
      <div className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#F4F4F6]">
              Visual Storytelling Style Preset
            </h2>
            <p className="text-xs text-[#989CA8] mt-0.5">
              Sets the illustration art direction, animated map theme, kinetic typography, transition pacing (3–5s beats), and musical score.
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-[#E5A03A] shrink-0">
            {VIDEO_STYLE_PRESETS[videoStylePreset].referenceChannel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(Object.keys(VIDEO_STYLE_PRESETS) as VideoStylePresetId[]).map((id) => {
            const p = VIDEO_STYLE_PRESETS[id];
            const active = videoStylePreset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelectStylePreset(id)}
                className={`text-left p-4 rounded-xl border transition-colors flex flex-col justify-between gap-3 ${
                  active
                    ? 'bg-[#1E2028] border-[#E5A03A]'
                    : 'bg-[#0F1015] border-[#262933] hover:border-[#3A3F4E]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#F4F4F6]">{p.label}</span>
                    <span className="text-[10px] font-mono-tabular text-[#989CA8]">{p.referenceChannel}</span>
                  </div>
                  <p className="text-[11px] text-[#989CA8] leading-relaxed">{p.shortDesc}</p>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {[p.palette.bg, p.palette.surface, p.palette.accent, p.palette.secondaryAccent].map((hex, i) => (
                    <span
                      key={i}
                      className="h-2.5 flex-1 rounded-sm border border-white/10"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Voice, Visual World & Technical Specs */}
      <div className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#F4F4F6]">
          Voice, Visual World & Mastering Specs
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Documentary Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as NarrationPresetId)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              {Object.entries(NARRATION_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Narrator Voice</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'male' | 'female')}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              <option value="male">Male Narrator</option>
              <option value="female">Female Narrator</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Language & Accent</label>
            <input
              type="text"
              maxLength={120}
              value={narratorAccent}
              onChange={(e) => setNarratorAccent(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Script Language</label>
            <input
              type="text"
              maxLength={60}
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setNarratorLanguage(e.target.value);
              }}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Target Duration (sec)</label>
            <select
              value={targetDurationSec}
              onChange={(e) => setTargetDurationSec(Number(e.target.value))}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              <option value={45}>45 seconds (Brief)</option>
              <option value={60}>60 seconds (Featurette)</option>
              <option value={90}>90 seconds (Standard)</option>
              <option value={150}>150 seconds (Deep Dive)</option>
              <option value={240}>240 seconds (Mini-Doc)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Master Resolution</label>
            <select
              value={resolution}
              onChange={(e) => handleResolutionChange(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              <option value="1920x1080">1920 × 1080 (16:9 HD)</option>
              <option value="2560x1080">2560 × 1080 (21:9 Cinema)</option>
              <option value="3840x1646">3840 × 1646 (4K Scope)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Frame Rate</label>
            <select
              value={frameRate}
              onChange={(e) => setFrameRate(Number(e.target.value))}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              <option value={24}>24 FPS (Cinema)</option>
              <option value={30}>30 FPS (Broadcast)</option>
              <option value={60}>60 FPS (Smooth)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Continuous Visual World</label>
            <select
              value={worldEnvironment}
              onChange={(e) => setWorldEnvironment(e.target.value as WorldEnvironment)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            >
              <option value="desk">Physical Archival Desk</option>
              <option value="map">Geographical Cartography Map</option>
              <option value="board">Investigative Evidence Board</option>
              <option value="archive">Museum Document Archive</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Visual Direction Notes</label>
            <input
              type="text"
              maxLength={500}
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Archival Research Priorities</label>
            <input
              type="text"
              maxLength={4000}
              value={researchPreferences}
              onChange={(e) => setResearchPreferences(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-xs text-[#EF4444]">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <label className="inline-flex items-center gap-2.5 text-xs text-[#D4D6DC] cursor-pointer">
          <input
            type="checkbox"
            checked={autoStartPipeline}
            onChange={(e) => setAutoStartPipeline(e.target.checked)}
            className="accent-[#E5A03A] w-4 h-4 rounded"
          />
          {mode === 'voiceover'
            ? 'Immediately analyze uploaded voiceover and extract timestamps'
            : 'Immediately launch autonomous web research and archival photo discovery'}
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Initializing Production...
            </>
          ) : (
            <>
              Create & Enter Studio
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
