import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  Edit3,
  Film,
  FolderOpen,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { formatShortDuration } from '../lib/timecode';
import { STUDIO_BACKDROPS, type Project, type ProjectStatus } from '../types/cineforge';
import { AuthImage } from './AuthImage';

interface DashboardViewProps {
  projects: Project[];
  loading: boolean;
  onNewProject: () => void;
  onOpenProject: (project: Project) => void;
  onRenameProject: (projectId: string, newTitle: string) => Promise<void>;
  onDuplicateProject: (project: Project) => Promise<void>;
  onToggleArchive: (project: Project) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  in_production: 'In Production',
  rendered: 'Completed',
  archived: 'Archived',
};

export function DashboardView({
  projects,
  loading,
  onNewProject,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onToggleArchive,
  onDeleteProject,
}: DashboardViewProps) {
  const [filter, setFilter] = useState<'all' | 'draft' | 'in_production' | 'rendered' | 'archived'>('all');
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showSampleRender, setShowSampleRender] = useState(true);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filter === 'all' && p.status === 'archived') return false;
      if (filter !== 'all' && p.status !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          (p.topic || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projects, filter, search]);

  const counts = useMemo(() => {
    const active = projects.filter((p) => p.status !== 'archived').length;
    const completed = projects.filter((p) => p.status === 'rendered').length;
    const drafts = projects.filter((p) => p.status === 'draft').length;
    const totalSec = projects.reduce((acc, p) => acc + (p.narrationDurationSec || 0), 0);
    return { active, completed, drafts, totalSec };
  }, [projects]);

  const formatUpdated = (ts: any) => {
    if (!ts) return 'Just now';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleConfirmRename = async (projectId: string) => {
    if (!renameValue.trim()) return;
    setBusyId(projectId);
    try {
      await onRenameProject(projectId, renameValue.trim());
      setRenamingId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Studio Overview Strip */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#F4F4F6]">
            Production Desk
          </h1>
          <p className="text-sm text-[#989CA8]">
            Resume an active documentary, inspect archival cuts, or launch a new autonomous production.
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Documentary Project
        </button>
      </div>

      {/* Key Production Totals (Clean horizontal metrics strip with hairline dividers) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-[#262933] divide-y lg:divide-y-0 lg:divide-x divide-[#262933]">
        <div className="py-4 lg:pr-6">
          <div className="text-xs text-[#989CA8]">Active Productions</div>
          <div className="font-mono-tabular text-2xl font-semibold text-[#F4F4F6] mt-1">
            {counts.active}
          </div>
        </div>
        <div className="py-4 lg:px-6">
          <div className="text-xs text-[#989CA8]">Completed Films</div>
          <div className="font-mono-tabular text-2xl font-semibold text-[#22C55E] mt-1">
            {counts.completed}
          </div>
        </div>
        <div className="py-4 lg:px-6">
          <div className="text-xs text-[#989CA8]">Draft Projects</div>
          <div className="font-mono-tabular text-2xl font-semibold text-[#E5A03A] mt-1">
            {counts.drafts}
          </div>
        </div>
        <div className="py-4 lg:pl-6">
          <div className="text-xs text-[#989CA8]">Mastered Narration</div>
          <div className="font-mono-tabular text-2xl font-semibold text-[#F4F4F6] mt-1">
            {formatShortDuration(counts.totalSec)}
          </div>
        </div>
      </div>

      {/* Verified Sample Render Showcase (Full 7-Step E2E Output) */}
      <div className="bg-[#16171D] border border-[#262933] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#262933] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Play className="w-4 h-4 text-[#E5A03A] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#F4F4F6] truncate">
                Verified Pipeline Render: The Great Emu War (1932)
              </div>
              <div className="text-xs text-[#989CA8]">
                Historically Preset · 1280×720 @ 30 FPS · 27.84s · H.264 / AAC 48kHz · Auto-ducked score &amp; 6 SFX
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/demo/emu_war_demo.mp4"
              download="CineForge_Great_Emu_War_1932.mp4"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#E5A03A]" />
              Download MP4 (3.35 MB)
            </a>
            <button
              type="button"
              onClick={() => setShowSampleRender((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-[#989CA8] hover:text-[#F4F4F6] border border-[#262933] rounded-lg transition-colors whitespace-nowrap"
            >
              {showSampleRender ? 'Hide Player' : 'Watch Video'}
            </button>
          </div>
        </div>
        {showSampleRender && (
          <div className="grid grid-cols-1 lg:grid-cols-12 bg-[#0E0F14]">
            <div className="lg:col-span-8 bg-black aspect-video">
              <video
                src="/demo/emu_war_demo.mp4"
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="lg:col-span-4 p-5 border-t lg:border-t-0 lg:border-l border-[#262933] flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#E5A03A]">
                  End-to-End QA Summary
                </div>
                <div className="space-y-2 text-xs text-[#989CA8]">
                  <div className="flex justify-between gap-2 border-b border-[#262933]/60 pb-1.5">
                    <span>Scenes Rendered</span>
                    <span className="font-mono-tabular text-[#F4F4F6]">6 beats (4.63s avg)</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-[#262933]/60 pb-1.5">
                    <span>Scene Variety</span>
                    <span className="text-[#F4F4F6] text-right">Title, Cutouts, Map, Diagram</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-[#262933]/60 pb-1.5">
                    <span>Black Frames</span>
                    <span className="font-mono-tabular text-[#22C55E]">0 detected</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-[#262933]/60 pb-1.5">
                    <span>A/V Sync Delta</span>
                    <span className="font-mono-tabular text-[#22C55E]">59 ms</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Audio Mix</span>
                    <span className="font-mono-tabular text-[#F4F4F6]">-14.87 dBFS · peak 0.71</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-[#989CA8] leading-relaxed">
                Generated end-to-end with live Wikimedia Commons archival photos, animated Australia cartography, word-highlighted kinetic captions, and Broadcast DSP audio mastering.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Filter Tabs + Live Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-[#16171D] border border-[#262933] rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: 'All Active' },
              { id: 'in_production', label: 'In Production' },
              { id: 'rendered', label: 'Completed' },
              { id: 'draft', label: 'Drafts' },
              { id: 'archived', label: 'Archived' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-[#262933] text-[#F4F4F6]'
                  : 'text-[#989CA8] hover:text-[#F4F4F6]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#6B7080] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects or topics..."
            className="w-full bg-[#16171D] border border-[#262933] rounded-lg pl-9 pr-3 py-2 text-xs text-[#F4F4F6] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A]"
          />
        </div>
      </div>

      {/* Project Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-[#16171D] border border-[#262933] rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-video bg-[#1E2028]" />
              <div className="p-5 space-y-3">
                <div className="h-5 bg-[#1E2028] rounded w-3/4" />
                <div className="h-3 bg-[#1E2028] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#16171D] border border-[#262933] rounded-xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-[#1E2028] border border-[#262933] flex items-center justify-center mx-auto text-[#E5A03A]">
            <Film className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-xl font-medium text-[#F4F4F6]">
              {projects.length === 0 ? 'No documentaries created yet' : 'No matching productions'}
            </h3>
            <p className="text-sm text-[#989CA8] max-w-md mx-auto">
              Start from a historical topic, paste an existing script, or upload a recorded voiceover.
              CineForge preserves every approved asset, narration take, and storyboard beat automatically.
            </p>
          </div>
          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Create Your First Documentary
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((project) => {
            const isRenaming = renamingId === project.id;
            const isConfirmDelete = confirmDeleteId === project.id;
            const isBusy = busyId === project.id;

            return (
              <div
                key={project.id}
                className="group bg-[#16171D] border border-[#262933] hover:border-[#3A3F4E] rounded-xl overflow-hidden flex flex-col transition-colors"
              >
                <button
                  onClick={() => onOpenProject(project)}
                  className="relative aspect-video w-full overflow-hidden bg-[#101115] text-left focus:outline-none"
                >
                  <AuthImage
                    src={project.thumbnailUrl || STUDIO_BACKDROPS.archivalDesk}
                    alt={project.title}
                    fallbackTitle={project.title}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D]/85 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-[11px] text-[#D4D6DC]">
                    <span className="font-mono-tabular">
                      {project.resolution || '1920x1080'} · {project.frameRate || 30} fps
                    </span>
                    <span className="font-mono-tabular">
                      {formatShortDuration(project.narrationDurationSec || project.targetDurationSec || 0)}
                    </span>
                  </div>
                </button>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    {isRenaming ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleConfirmRename(project.id)}
                          autoFocus
                          className="flex-1 bg-[#0B0B0D] border border-[#E5A03A] rounded px-2.5 py-1 text-sm text-[#F4F4F6] focus:outline-none"
                        />
                        <button
                          onClick={() => handleConfirmRename(project.id)}
                          disabled={isBusy}
                          className="p-1.5 text-[#22C55E] hover:bg-[#1E2028] rounded"
                          title="Save title"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setRenamingId(null)}
                          className="p-1.5 text-[#989CA8] hover:bg-[#1E2028] rounded"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onOpenProject(project)}
                        className="text-left block w-full"
                      >
                        <h3 className="font-display text-lg font-medium text-[#F4F4F6] group-hover:text-[#E5A03A] transition-colors truncate">
                          {project.title}
                        </h3>
                      </button>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#989CA8]">
                      <span
                        className={
                          project.status === 'rendered'
                            ? 'text-[#22C55E] font-medium'
                            : project.status === 'in_production'
                            ? 'text-[#E5A03A] font-medium'
                            : 'text-[#989CA8]'
                        }
                      >
                        {STATUS_LABELS[project.status]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Render: {project.renderStatus === 'completed' ? 'Exported MP4' : project.renderStatus === 'rendering' ? 'In Queue' : 'Pending'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{formatUpdated(project.updatedAt)}</span>
                    </div>

                    {project.topic && (
                      <p className="text-xs text-[#7D8291] line-clamp-2 leading-relaxed">
                        {project.topic}
                      </p>
                    )}
                  </div>

                  {/* Actions Row */}
                  <div className="pt-3 border-t border-[#262933] flex items-center justify-between gap-2">
                    <button
                      onClick={() => onOpenProject(project)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E5A03A] hover:text-[#F0B254] transition-colors whitespace-nowrap shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open Studio
                    </button>

                    {isConfirmDelete ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#EF4444]">Delete?</span>
                        <button
                          onClick={async () => {
                            setBusyId(project.id);
                            try {
                              await onDeleteProject(project.id);
                              setConfirmDeleteId(null);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          disabled={isBusy}
                          className="px-2 py-1 text-[11px] font-medium bg-[#EF4444] text-white rounded hover:bg-red-600"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[11px] text-[#989CA8] hover:text-[#F4F4F6]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setRenamingId(project.id);
                            setRenameValue(project.title);
                          }}
                          className="p-1.5 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded transition-colors"
                          title="Rename project"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            setBusyId(project.id);
                            try {
                              await onDuplicateProject(project);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          disabled={isBusy}
                          className="p-1.5 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded transition-colors"
                          title="Duplicate project"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            setBusyId(project.id);
                            try {
                              await onToggleArchive(project);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          disabled={isBusy}
                          className="p-1.5 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded transition-colors"
                          title={project.status === 'archived' ? 'Restore from archive' : 'Archive project'}
                        >
                          {project.status === 'archived' ? (
                            <RotateCcw className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(project.id)}
                          className="p-1.5 text-[#989CA8] hover:text-[#EF4444] hover:bg-[#1E2028] rounded transition-colors"
                          title="Delete project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
