import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  ExternalLink,
  Globe,
  Loader2,
  Map,
  RefreshCw,
} from 'lucide-react';
import type {
  ArchivalAsset,
  Project,
  ResearchSource,
  WorldEnvironment,
} from '../types/cineforge';
import { AnimatePresence } from 'motion/react';
import { AuthImage } from './AuthImage';
import { StageProgressBanner, type StageSubStep } from './StageProgressBanner';

const RESEARCH_SUB_STEPS: StageSubStep[] = [
  { id: 'ground', label: 'Grounding Facts & Citations', detail: 'Google Search Grounding' },
  { id: 'entities', label: 'Entities & World Direction', detail: 'Chronology & color grade' },
  { id: 'archives', label: 'Querying Public Archives', detail: 'Wikimedia, LOC & NASA' },
  { id: 'index', label: 'Saving Verified Dossier', detail: 'Indexing citations & media' },
];

function resolveResearchSubStep(progressText: string, progressPercent?: number): number {
  const lower = progressText.toLowerCase();
  if (lower.includes('saving') || lower.includes('finaliz') || lower.includes('complet')) return 3;
  if (lower.includes('wikimedia') || lower.includes('archive') || lower.includes('photo') || lower.includes('nasa') || lower.includes('library of congress')) return 2;
  if (lower.includes('direction') || lower.includes('visual') || lower.includes('entit')) return 1;
  if (typeof progressPercent === 'number') {
    if (progressPercent >= 85) return 3;
    if (progressPercent >= 55) return 2;
    if (progressPercent >= 30) return 1;
  }
  return 0;
}

interface ResearchStudioViewProps {
  project: Project;
  sources: ResearchSource[];
  assets: ArchivalAsset[];
  isRunningResearch: boolean;
  progressText: string;
  progressPercent?: number;
  researchError?: string | null;
  onRunResearch: () => Promise<void>;
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onNavigate: (section: 'script' | 'assets') => void;
}

const WORLD_OPTIONS: Array<{ id: WorldEnvironment; label: string; desc: string }> = [
  { id: 'desk', label: 'Physical Archival Desk', desc: 'Dark walnut & slate surface with tungsten lighting and gelatin prints.' },
  { id: 'map', label: 'Geographical Map', desc: 'Cartographic obsidian terrain with dashed travel routes and animated location circles.' },
  { id: 'board', label: 'Investigation Board', desc: 'Connected archival clippings pinned with taut amber evidence lines.' },
  { id: 'archive', label: 'Document Archive', desc: 'Museum flat-file cabinet lighting with unfolding historical records.' },
];

export function ResearchStudioView({
  project,
  sources,
  assets,
  isRunningResearch,
  progressText,
  progressPercent,
  researchError,
  onRunResearch,
  onUpdateProject,
  onNavigate,
}: ResearchStudioViewProps) {
  const [saving, setSaving] = useState(false);

  const readyPhotos = assets.filter((a) => a.downloadStatus === 'ready' && a.imageUrl);
  const gapNotices = assets.filter((a) => a.downloadStatus === 'unavailable');
  const activeSubStep = resolveResearchSubStep(progressText, progressPercent);

  const handleApproveDirection = async () => {
    setSaving(true);
    try {
      await onUpdateProject({
        researchApproved: true,
        visualDirectionApproved: true,
        activeStage: 'script',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-[#E5A03A] font-medium">Step 01 of 07 · Autonomous Research & Visual Direction</p>
          <h1 className="font-display text-3xl font-semibold text-[#F4F4F6]">Research Studio</h1>
          <p className="text-sm text-[#989CA8]">
            Verified internet grounding paired with authentic public-domain photography from Wikimedia Commons, the Library of Congress, and NASA.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onRunResearch}
            disabled={isRunningResearch}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {isRunningResearch ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {project.researchSummary ? 'Refresh Autonomous Research' : 'Run Autonomous Research'}
          </button>

          {project.researchSummary && (
            <button
              onClick={handleApproveDirection}
              disabled={saving}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                project.visualDirectionApproved
                  ? 'border-[#22C55E]/50 text-[#22C55E] bg-[#22C55E]/10'
                  : 'border-[#262933] text-[#F4F4F6] bg-[#16171D] hover:border-[#E5A03A]'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {project.visualDirectionApproved ? 'Research & Direction Approved' : 'Approve Visual Direction'}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isRunningResearch && (
          <StageProgressBanner
            stepNumber={1}
            title="Autonomous Research & Archival Discovery"
            statusMessage={
              progressText ||
              'Searching grounded sources, verifying dates and figures, and querying archival photo collections...'
            }
            subSteps={RESEARCH_SUB_STEPS}
            activeSubStepIndex={activeSubStep}
            progressPercent={progressPercent}
          />
        )}
      </AnimatePresence>

      {researchError && !isRunningResearch && (
        <div className="p-4 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="text-xs text-[#F4F4F6] leading-relaxed">{researchError}</div>
          </div>
          <button
            onClick={onRunResearch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#16171D] border border-[#EF4444]/40 text-[#F4F4F6] hover:border-[#E5A03A] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry Research
          </button>
        </div>
      )}

      {!project.researchSummary && !isRunningResearch ? (
        <div className="bg-[#16171D] border border-[#262933] rounded-xl p-12 text-center space-y-4">
          <Compass className="w-8 h-8 text-[#E5A03A] mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-xl text-[#F4F4F6]">Ready to investigate "{project.topic}"</h2>
            <p className="text-sm text-[#989CA8] max-w-lg mx-auto">
              CineForge will run Google Search Grounding to verify dates, people, and institutional citations, define a unified cinematic world direction, and pull authentic public-domain photographs with full license attribution.
            </p>
          </div>
          <button
            onClick={onRunResearch}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors"
          >
            <Globe className="w-4 h-4" />
            Launch Autonomous Research
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 7 cols: Research Dossier + Entities + Citations */}
          <div className="lg:col-span-7 space-y-6">
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Verified Research Dossier</h2>
                <span className="text-xs text-[#989CA8] font-mono-tabular">
                  {sources.length} citations · {readyPhotos.length} archival items
                </span>
              </div>
              <div className="text-sm text-[#D4D6DC] leading-7 whitespace-pre-line">
                {project.researchSummary}
              </div>
            </section>

            {/* Extracted Historical Entities */}
            {project.researchEntities && (
              <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Verified Entities & Chronology</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                  {(
                    [
                      { key: 'people', label: 'Key Figures' },
                      { key: 'organizations', label: 'Institutions & Organizations' },
                      { key: 'dates', label: 'Verified Dates' },
                      { key: 'locations', label: 'Locations' },
                      { key: 'events', label: 'Pivotal Events' },
                    ] as const
                  ).map(({ key, label }) => {
                    const list = project.researchEntities?.[key] || [];
                    if (list.length === 0) return null;
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="text-[#989CA8] font-medium">{label}</div>
                        <div className="text-[#F4F4F6] leading-relaxed">
                          {list.join(' · ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Verified Grounding Citations */}
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Primary Sources & Grounding Links</h2>
                <BookOpen className="w-4 h-4 text-[#989CA8]" />
              </div>
              {sources.length === 0 ? (
                <p className="text-xs text-[#989CA8]">
                  No external web grounding links were returned for this query.
                </p>
              ) : (
                <div className="divide-y divide-[#262933]">
                  {sources.map((src) => (
                    <div key={src.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-0.5">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-[#F4F4F6] hover:text-[#E5A03A] transition-colors inline-flex items-center gap-1.5"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#989CA8]" />
                        </a>
                        <div className="text-xs text-[#989CA8]">
                          <span>{src.publisher || 'Verified Archive'}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{src.sourceType || 'Reference'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right 5 cols: Visual Direction + World Selector + Archival Preview */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Cinematic Visual World Direction</h2>
                <Map className="w-4 h-4 text-[#E5A03A]" />
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {WORLD_OPTIONS.map((opt) => {
                  const selected = project.worldEnvironment === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => onUpdateProject({ worldEnvironment: opt.id })}
                      className={`text-left p-3.5 rounded-lg border transition-colors ${
                        selected
                          ? 'bg-[#1E2028] border-[#E5A03A]'
                          : 'bg-[#0B0B0D] border-[#262933] hover:border-[#3A3F4E]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#F4F4F6]">{opt.label}</div>
                      <div className="text-[11px] text-[#989CA8] mt-0.5">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>

              {project.visualDirection && (
                <div className="space-y-3 pt-2 border-t border-[#262933] text-xs">
                  <div>
                    <div className="text-[#989CA8] mb-0.5">Cinematography & Camera Language</div>
                    <p className="text-[#D4D6DC] leading-relaxed">
                      {project.visualDirection.cinematographyNotes}
                    </p>
                  </div>
                  <div>
                    <div className="text-[#989CA8] mb-0.5">Lighting & Atmosphere</div>
                    <p className="text-[#D4D6DC] leading-relaxed">
                      {project.visualDirection.lightingStyle}
                    </p>
                  </div>
                  <div>
                    <div className="text-[#989CA8] mb-0.5">Typography System</div>
                    <p className="text-[#D4D6DC] leading-relaxed">
                      {project.visualDirection.typographyStyle}
                    </p>
                  </div>
                  {project.visualDirection.colorPalette?.length > 0 && (
                    <div>
                      <div className="text-[#989CA8] mb-1.5">Color Grade Palette</div>
                      <div className="flex items-center gap-2">
                        {project.visualDirection.colorPalette.map((hex, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span
                              className="w-5 h-5 rounded border border-[#262933] inline-block"
                              style={{ backgroundColor: hex }}
                            />
                            <span className="font-mono-tabular text-[11px] text-[#989CA8]">{hex}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Collected Authentic Photographs Preview */}
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Collected Archival Media</h2>
                <button
                  onClick={() => onNavigate('assets')}
                  className="text-xs text-[#E5A03A] hover:text-[#F0B254] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  Open Media Studio
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {readyPhotos.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {readyPhotos.slice(0, 4).map((asset) => (
                    <div key={asset.id} className="space-y-1.5">
                      <div className="aspect-[4/3] rounded-lg overflow-hidden border border-[#262933] bg-[#0B0B0D]">
                        <AuthImage
                          src={asset.thumbnailUrl || asset.imageUrl}
                          alt={asset.title}
                          fallbackTitle={asset.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-[11px] text-[#D4D6DC] truncate">{asset.title}</div>
                      <div className="text-[10px] text-[#989CA8] truncate">
                        {asset.sourceProvider.toUpperCase()} · {asset.license || 'Archival'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#989CA8]">
                  After locking your Storyboard blueprint in Step 4, Step 5 automatically fulfills every beat 1-to-1 with unique archival photos, public video clips, animated rigs, and maps.
                </p>
              )}

              {gapNotices.length > 0 && (
                <div className="pt-3 border-t border-[#262933] text-xs text-[#E5A03A]">
                  {gapNotices.length} subject(s) had no verified public-domain photo and will be fulfilled with custom animated vector rigs in Step 5.
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={() => onNavigate('script')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1E2028] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-lg transition-colors"
                >
                  Proceed to Script Studio
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
