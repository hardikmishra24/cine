import React, { useState } from 'react';
import { Archive, CheckCircle2, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { Project, WorldEnvironment } from '../types/cineforge';

interface ProjectSettingsViewProps {
  project: Project;
  providerStatus: {
    geminiConfigured: boolean;
    voiceProviders: { gemini: boolean; elevenlabs: boolean };
    archivalProviders: { wikimedia: boolean; libraryOfCongress: boolean; nasa: boolean };
    ffmpegAvailable: boolean;
  } | null;
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onToast: (msg: string) => void;
}

export function ProjectSettingsView({
  project,
  providerStatus,
  onUpdateProject,
  onDeleteProject,
  onToast,
}: ProjectSettingsViewProps) {
  const [title, setTitle] = useState(project.title);
  const [topic, setTopic] = useState(project.topic);
  const [language, setLanguage] = useState(project.language || 'English');
  const [narratorAccent, setNarratorAccent] = useState(project.narratorAccent || 'Neutral Documentary');
  const [targetDurationSec, setTargetDurationSec] = useState(project.targetDurationSec || 90);
  const [resolution, setResolution] = useState(project.resolution || '1920x1080');
  const [frameRate, setFrameRate] = useState(project.frameRate || 30);
  const [worldEnvironment, setWorldEnvironment] = useState<WorldEnvironment>(project.worldEnvironment || 'desk');
  const [visualStyle, setVisualStyle] = useState(project.visualStyle || '');
  const [researchPreferences, setResearchPreferences] = useState(project.researchPreferences || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ratio =
        resolution === '2560x1080' ? '21:9' : resolution === '3840x1646' ? '2.33:1' : '16:9';
      await onUpdateProject({
        title: title.trim() || project.title,
        topic: topic.trim(),
        language,
        narratorLanguage: language,
        narratorAccent,
        targetDurationSec,
        resolution,
        aspectRatio: ratio,
        frameRate,
        worldEnvironment,
        visualStyle,
        researchPreferences,
      });
      onToast('Project settings saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <p className="text-xs text-[#E5A03A] font-medium">Project Configuration & Studio Capabilities</p>
        <h1 className="font-display text-3xl font-semibold text-[#F4F4F6] mt-1">Project Settings</h1>
      </div>

      <form onSubmit={handleSave} className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Project Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-sm text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Language</label>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-sm text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#989CA8] mb-1">Documentary Topic / Brief</label>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-sm text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Narrator Accent</label>
            <input
              value={narratorAccent}
              onChange={(e) => setNarratorAccent(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Target Duration (sec)</label>
            <input
              type="number"
              min={20}
              max={600}
              value={targetDurationSec}
              onChange={(e) => setTargetDurationSec(Number(e.target.value) || 60)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Default Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6]"
            >
              <option value="1920x1080">1920 × 1080</option>
              <option value="2560x1080">2560 × 1080</option>
              <option value="3840x1646">3840 × 1646</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Default Frame Rate</label>
            <select
              value={frameRate}
              onChange={(e) => setFrameRate(Number(e.target.value))}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs font-mono-tabular text-[#F4F4F6]"
            >
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Continuous Visual World</label>
            <select
              value={worldEnvironment}
              onChange={(e) => setWorldEnvironment(e.target.value as WorldEnvironment)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
            >
              <option value="desk">Physical Archival Desk</option>
              <option value="map">Geographical Map</option>
              <option value="board">Investigation Board</option>
              <option value="archive">Document Archive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#989CA8] mb-1">Visual Style</label>
            <input
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
              className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#989CA8] mb-1">Research Priorities</label>
          <input
            value={researchPreferences}
            onChange={(e) => setResearchPreferences(e.target.value)}
            className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-3 py-2 text-xs text-[#F4F4F6]"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* Server-Managed Provider Capabilities (Read-Only, Zero Key Inputs) */}
      <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[#F4F4F6]">Connected Production Services</h2>
          <p className="text-xs text-[#989CA8] mt-0.5">
            All AI and encoder credentials are managed securely on the server via environment secrets.
          </p>
        </div>
        <div className="divide-y divide-[#262933] text-xs">
          {[
            {
              name: 'Gemini Research, Script & Transcription',
              ready: providerStatus?.geminiConfigured ?? true,
              detail: 'gemini-4-hydrogen (Search Grounding) · gemini-3.5-transcribe',
            },
            {
              name: 'Gemini Neural TTS (Primary Voice Engine)',
              ready: providerStatus?.voiceProviders?.gemini ?? true,
              detail: 'gemini-3.8-flash-tts / gemini-3.8-flash-lite-tts',
            },
            {
              name: 'ElevenLabs TTS (Optional Provider)',
              ready: providerStatus?.voiceProviders?.elevenlabs ?? false,
              detail: providerStatus?.voiceProviders?.elevenlabs
                ? 'Active via server ELEVENLABS_API_KEY secret'
                : 'Optional · Configure ELEVENLABS_API_KEY in Settings > Secrets to enable',
            },
            {
              name: 'Authentic Public-Domain Photo Archives',
              ready: true,
              detail: 'Wikimedia Commons · Library of Congress · NASA Image Library',
            },
            {
              name: 'Broadcast FFmpeg MP4 Encoder & QA Validator',
              ready: providerStatus?.ffmpegAvailable ?? true,
              detail: 'H.264 / AAC muxing, LUFS audio post-processing, ffprobe & blackdetect',
            },
          ].map((svc) => (
            <div key={svc.name} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-[#F4F4F6]">{svc.name}</div>
                <div className="text-[#989CA8] mt-0.5">{svc.detail}</div>
              </div>
              <span className={`inline-flex items-center gap-1.5 shrink-0 ${svc.ready ? 'text-[#22C55E]' : 'text-[#989CA8]'}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {svc.ready ? 'Ready' : 'Optional'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Lifecycle Controls */}
      <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[#F4F4F6]">Archive or Delete Project</h2>
          <p className="text-xs text-[#989CA8] mt-0.5">
            Archiving hides this documentary from Active Productions while preserving all scripts, narration, and assets.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() =>
              onUpdateProject({
                status: project.status === 'archived' ? 'in_production' : 'archived',
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] text-[#D4D6DC] rounded-lg whitespace-nowrap shrink-0"
          >
            {project.status === 'archived' ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            {project.status === 'archived' ? 'Restore Project' : 'Archive Project'}
          </button>

          {confirmDelete ? (
            <div className="inline-flex items-center gap-2">
              <button
                onClick={() => onDeleteProject(project.id)}
                className="px-3 py-2 text-xs font-semibold bg-[#EF4444] text-white rounded-lg"
              >
                Confirm Permanent Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-2 text-xs text-[#989CA8]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] hover:bg-[#EF4444]/20 rounded-lg whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
