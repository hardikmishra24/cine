import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Volume2,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import {
  createScriptVersionDoc,
  updateScriptVersionDoc,
} from '../lib/firestoreStore';
import { formatShortDuration } from '../lib/timecode';
import type {
  Project,
  PronunciationEntry,
  ResearchSource,
  ScriptParagraph,
  ScriptVersion,
} from '../types/cineforge';
import { StageProgressBanner, type StageSubStep } from './StageProgressBanner';

const SCRIPT_GEN_STEPS: StageSubStep[] = [
  { id: 'research', label: 'Synthesizing Research', detail: 'Grounding facts & chronology' },
  { id: 'cadence', label: 'Drafting Spoken Cadence', detail: 'Documentary narration flow' },
  { id: 'pronunciation', label: 'Pronunciation Guide', detail: 'Names, dates & technical terms' },
  { id: 'save', label: 'Saving Script Version', detail: 'Indexing editable segments' },
];

const SCRIPT_REGEN_STEPS: StageSubStep[] = [
  { id: 'context', label: 'Preserving Context', detail: 'Locking surrounding segments' },
  { id: 'rewrite', label: 'Rewriting Spoken Cadence', detail: 'Applying editorial revision note' },
  { id: 'update', label: 'Saving Segment Snapshot', detail: 'Updating script timeline' },
];

interface ScriptStudioViewProps {
  project: Project;
  scripts: ScriptVersion[];
  sources: ResearchSource[];
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onNavigateVoice: () => void;
  onToast: (msg: string) => void;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

export function ScriptStudioView({
  project,
  scripts,
  sources,
  onUpdateProject,
  onNavigateVoice,
  onToast,
  onBusyChange,
}: ScriptStudioViewProps) {
  const activeScript = useMemo(
    () => scripts.find((s) => s.isActive) || scripts[0] || null,
    [scripts]
  );

  const [generating, setGenerating] = useState(false);
  const [regenParaId, setRegenParaId] = useState<string | null>(null);
  const [activeSubStep, setActiveSubStep] = useState(0);
  const [phasePercent, setPhasePercent] = useState(14);
  const [phaseMessage, setPhaseMessage] = useState('');
  const [regenNotes, setRegenNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!generating && !regenParaId) {
      onBusyChange?.(false);
      return;
    }
    onBusyChange?.(
      true,
      phaseMessage ||
        (generating
          ? 'Drafting grounded documentary script with Gemini...'
          : 'Regenerating selected narration paragraph...')
    );
  }, [generating, regenParaId, phaseMessage, onBusyChange]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  const handleCancelGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setGenerating(false);
    setRegenParaId(null);
    setActiveSubStep(0);
    setPhasePercent(14);
    setPhaseMessage('');
  };

  const [draftParagraphs, setDraftParagraphs] = useState<ScriptParagraph[] | null>(null);
  const [draftPronunciation, setDraftPronunciation] = useState<PronunciationEntry[] | null>(null);
  const [newTerm, setNewTerm] = useState('');
  const [newPhonetic, setNewPhonetic] = useState('');

  const paragraphs = draftParagraphs ?? activeScript?.paragraphs ?? [];
  const pronunciationGuide = draftPronunciation ?? activeScript?.pronunciationGuide ?? [];

  const totalWords = useMemo(
    () => paragraphs.reduce((acc, p) => acc + p.text.split(/\s+/).filter(Boolean).length, 0),
    [paragraphs]
  );
  const estimatedSec = useMemo(
    () => Math.max(0, Math.round((totalWords / 138) * 60)),
    [totalWords]
  );

  const handleGenerateFullScript = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    setError(null);
    setActiveSubStep(0);
    setPhasePercent(16);
    setPhaseMessage('Synthesizing verified research dossier and factual chronology...');

    // Honest pacing: stay inside sub-step 1 ("Drafting Spoken Cadence") and cap at 64%
    // until Gemini actually responds — never claim "Saving Script Version" prematurely.
    let progressTimer: number | null = null;
    const step1Timer = window.setTimeout(() => {
      setActiveSubStep(1);
      setPhasePercent(32);
      setPhaseMessage('Drafting spoken documentary narration segments with Gemini...');
      progressTimer = window.setInterval(() => {
        setPhasePercent((prev) => (prev < 64 ? prev + 2 : prev));
      }, 1500);
    }, 1600);

    try {
      const existingText =
        paragraphs.length > 0 ? paragraphs.map((p) => p.text).join('\n\n') : undefined;
      const result = await apiFetch<{
        paragraphs: ScriptParagraph[];
        pronunciationGuide: PronunciationEntry[];
        wordCount: number;
        estimatedDurationSec: number;
      }>('/api/script/generate', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          projectId: project.id,
          topic: project.topic || project.title,
          existingScript: project.inputMode === 'script' ? existingText : undefined,
          researchSummary: project.researchSummary,
          entities: project.researchEntities,
          targetDurationSec: project.targetDurationSec || 90,
          language: project.language || 'English',
          narrationStyle: project.voiceCharacter,
        }),
      });

      window.clearTimeout(step1Timer);
      if (progressTimer !== null) window.clearInterval(progressTimer);

      setActiveSubStep(2);
      setPhasePercent(78);
      setPhaseMessage(
        `Drafted ${result.paragraphs.length} narration segments and ${result.pronunciationGuide.length} pronunciation cues...`
      );

      const nextVer = scripts.reduce((m, s) => Math.max(m, s.versionNumber || 0), 0) + 1;
      setActiveSubStep(3);
      setPhasePercent(92);
      setPhaseMessage(`Saving Script v${nextVer} (${result.wordCount} words) to project workspace...`);

      await createScriptVersionDoc(
        project.id,
        {
          versionNumber: nextVer,
          label: `Draft v${nextVer} · Gemini Documentary Script`,
          isActive: true,
          isApproved: false,
          wordCount: result.wordCount,
          estimatedDurationSec: result.estimatedDurationSec,
          paragraphs: result.paragraphs,
          pronunciationGuide: result.pronunciationGuide,
        },
        scripts
      );
      setDraftParagraphs(null);
      setDraftPronunciation(null);
      await onUpdateProject({ scriptApproved: false, activeStage: 'script' });
      setPhasePercent(100);
      onToast(`Generated Script v${nextVer} (${result.wordCount} words).`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        onToast('Script generation cancelled.');
      } else {
        setError(err?.message || 'Script generation failed. Please retry.');
      }
    } finally {
      window.clearTimeout(step1Timer);
      if (progressTimer !== null) window.clearInterval(progressTimer);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setGenerating(false);
    }
  };

  const handleRegenerateParagraph = async (para: ScriptParagraph, index: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRegenParaId(para.id);
    setError(null);
    setActiveSubStep(0);
    setPhasePercent(20);
    setPhaseMessage(`Locking surrounding segments around "${para.heading}"...`);

    let progressTimer: number | null = null;
    const step1Timer = window.setTimeout(() => {
      setActiveSubStep(1);
      setPhasePercent(40);
      setPhaseMessage(`Rewriting "${para.heading}" spoken cadence with Gemini...`);
      progressTimer = window.setInterval(() => {
        setPhasePercent((prev) => (prev < 68 ? prev + 3 : prev));
      }, 1200);
    }, 1000);

    try {
      const surrounding = paragraphs
        .map((p, i) => `[${i + 1}. ${p.heading}] ${p.text}`)
        .join('\n\n');
      const res = await apiFetch<{ paragraph: ScriptParagraph }>('/api/script/regenerate-paragraph', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          topic: project.topic || project.title,
          paragraph: para,
          surroundingContext: surrounding,
          instruction: regenNotes[para.id] || 'Tighten spoken cadence and documentary clarity.',
          language: project.language || 'English',
        }),
      });

      window.clearTimeout(step1Timer);
      if (progressTimer !== null) window.clearInterval(progressTimer);

      setActiveSubStep(2);
      setPhasePercent(90);
      setPhaseMessage(`Saving updated "${para.heading}" segment...`);

      const updated = paragraphs.map((p, i) => (i === index ? res.paragraph : p));
      setDraftParagraphs(updated);
      if (activeScript) {
        const wc = updated.reduce((a, p) => a + p.text.split(/\s+/).filter(Boolean).length, 0);
        await updateScriptVersionDoc(project.id, activeScript.id, {
          paragraphs: updated,
          wordCount: wc,
          estimatedDurationSec: Math.round((wc / 138) * 60),
          isApproved: false,
        });
        setDraftParagraphs(null);
      }
      setPhasePercent(100);
      onToast(`Regenerated "${para.heading}" without altering other segments.`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        onToast('Paragraph revision cancelled.');
      } else {
        setError(err?.message || 'Could not regenerate paragraph.');
      }
    } finally {
      window.clearTimeout(step1Timer);
      if (progressTimer !== null) window.clearInterval(progressTimer);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRegenParaId(null);
    }
  };

  const handleSaveSnapshot = async (approve = false) => {
    if (paragraphs.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (activeScript) {
        await updateScriptVersionDoc(project.id, activeScript.id, {
          paragraphs,
          pronunciationGuide,
          wordCount: totalWords,
          estimatedDurationSec: estimatedSec,
          isApproved: approve ? true : activeScript.isApproved,
        });
      } else {
        await createScriptVersionDoc(
          project.id,
          {
            versionNumber: 1,
            label: 'Manual Documentary Script v1',
            isActive: true,
            isApproved: approve,
            wordCount: totalWords,
            estimatedDurationSec: estimatedSec,
            paragraphs,
            pronunciationGuide,
          },
          scripts
        );
      }
      setDraftParagraphs(null);
      setDraftPronunciation(null);
      if (approve) {
        await onUpdateProject({ scriptApproved: true, activeStage: 'voice' });
        onToast('Final script approved. Voice Studio is unlocked.');
      } else {
        onToast('Script edits saved.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save script.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNewVersionSnapshot = async () => {
    if (paragraphs.length === 0) return;
    setSaving(true);
    try {
      const nextVer = scripts.reduce((m, s) => Math.max(m, s.versionNumber || 0), 0) + 1;
      await createScriptVersionDoc(
        project.id,
        {
          versionNumber: nextVer,
          label: `Snapshot v${nextVer}`,
          isActive: true,
          isApproved: false,
          wordCount: totalWords,
          estimatedDurationSec: estimatedSec,
          paragraphs,
          pronunciationGuide,
        },
        scripts
      );
      setDraftParagraphs(null);
      setDraftPronunciation(null);
      onToast(`Saved Version ${nextVer} snapshot.`);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreVersion = async (target: ScriptVersion) => {
    setSaving(true);
    try {
      for (const s of scripts) {
        if (s.id === target.id) {
          await updateScriptVersionDoc(project.id, s.id, { isActive: true });
        } else if (s.isActive) {
          await updateScriptVersionDoc(project.id, s.id, { isActive: false });
        }
      }
      setDraftParagraphs(null);
      setDraftPronunciation(null);
      onToast(`Restored Script v${target.versionNumber}.`);
    } finally {
      setSaving(false);
    }
  };

  const updateParagraphField = (idx: number, field: keyof ScriptParagraph, value: string) => {
    const next = paragraphs.map((p, i) => {
      if (i !== idx) return p;
      const updated = { ...p, [field]: value };
      if (field === 'text') {
        const w = value.split(/\s+/).filter(Boolean).length;
        updated.estimatedSec = Math.max(3, Math.round((w / 138) * 60));
      }
      return updated;
    });
    setDraftParagraphs(next);
  };

  const addParagraph = () => {
    const next: ScriptParagraph[] = [
      ...paragraphs,
      {
        id: `para_${Date.now().toString(36)}`,
        heading: `Segment ${paragraphs.length + 1}`,
        text: '',
        estimatedSec: 5,
      },
    ];
    setDraftParagraphs(next);
  };

  const removeParagraph = (idx: number) => {
    setDraftParagraphs(paragraphs.filter((_, i) => i !== idx));
  };

  const addPronunciation = () => {
    if (!newTerm.trim() || !newPhonetic.trim()) return;
    setDraftPronunciation([
      ...pronunciationGuide,
      { term: newTerm.trim(), phonetic: newPhonetic.trim() },
    ]);
    setNewTerm('');
    setNewPhonetic('');
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-[#E5A03A] font-medium">Step 02 of 07 · Documentary Script & Narration Segments</p>
          <h1 className="font-display text-3xl font-semibold text-[#F4F4F6]">Script Studio</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#989CA8]">
            <span className="font-mono-tabular">{totalWords} words</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{paragraphs.length} narration segments</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">Est. {formatShortDuration(estimatedSec)} spoken</span>
            {project.scriptApproved && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#22C55E] font-medium">Approved for Voiceover</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={handleGenerateFullScript}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#16171D] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {paragraphs.length > 0 ? 'Write New Draft' : 'Generate Documentary Script'}
          </button>

          {paragraphs.length > 0 && (
            <>
              <button
                onClick={() => handleSaveSnapshot(false)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#16171D] border border-[#262933] hover:border-[#3A3F4E] text-[#D4D6DC] rounded-lg whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                Save
              </button>
              <button
                onClick={() => handleSaveSnapshot(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approve Final Script
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {(generating || regenParaId) && (
          <StageProgressBanner
            stepNumber={2}
            title={
              generating
                ? 'Drafting Grounded Documentary Script'
                : 'Refining Selected Narration Paragraph'
            }
            statusMessage={
              phaseMessage ||
              (generating
                ? 'Synthesizing verified research into spoken documentary segments and pronunciation rules...'
                : 'Rewriting paragraph cadence while preserving surrounding narration context...')
            }
            subSteps={generating ? SCRIPT_GEN_STEPS : SCRIPT_REGEN_STEPS}
            activeSubStepIndex={activeSubStep}
            progressPercent={phasePercent}
            onCancel={handleCancelGeneration}
          />
        )}
      </AnimatePresence>

      {error && !generating && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="text-xs text-[#F4F4F6] leading-relaxed">{error}</div>
          </div>
          <button
            onClick={handleGenerateFullScript}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry Script Generation
          </button>
        </div>
      )}

      {paragraphs.length === 0 && !generating ? (
        <div className="bg-[#16171D] border border-[#262933] rounded-xl p-12 text-center space-y-4">
          <FileText className="w-8 h-8 text-[#E5A03A] mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-xl text-[#F4F4F6]">No documentary script drafted yet</h2>
            <p className="text-sm text-[#989CA8] max-w-md mx-auto">
              Generate a grounded spoken documentary script from your research dossier, or add segments manually.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleGenerateFullScript}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254]"
            >
              Generate Script with Gemini
            </button>
            <button
              onClick={addParagraph}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#1E2028] border border-[#262933] text-[#F4F4F6] rounded-lg hover:border-[#3A3F4E]"
            >
              <Plus className="w-4 h-4" />
              Write Manually
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Paragraph-Level Editor (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            {paragraphs.map((para, idx) => (
              <div
                key={para.id}
                className="bg-[#16171D] border border-[#262933] rounded-xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="font-mono-tabular text-xs text-[#E5A03A] shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <input
                      value={para.heading}
                      onChange={(e) => updateParagraphField(idx, 'heading', e.target.value)}
                      className="bg-transparent text-sm font-semibold text-[#F4F4F6] focus:outline-none border-b border-transparent focus:border-[#E5A03A] flex-1 min-w-[140px]"
                    />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#989CA8] font-mono-tabular shrink-0">
                    <span>{para.text.split(/\s+/).filter(Boolean).length}w</span>
                    <span>~{para.estimatedSec}s</span>
                    <button
                      onClick={() => removeParagraph(idx)}
                      className="text-[#6B7080] hover:text-[#EF4444] transition-colors"
                      title="Remove segment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={para.text}
                  onChange={(e) => updateParagraphField(idx, 'text', e.target.value)}
                  placeholder="Spoken documentary narration for this segment..."
                  className="w-full bg-[#0B0B0D] border border-[#262933] rounded-lg px-4 py-3 text-[15px] text-[#F4F4F6] leading-relaxed focus:outline-none focus:border-[#E5A03A]"
                />

                {(para.researchRef || para.visualCue) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#989CA8]">
                    {para.researchRef && <span>Fact basis: {para.researchRef}</span>}
                    {para.visualCue && <span>Suggested archive: {para.visualCue}</span>}
                  </div>
                )}

                {/* Per-paragraph targeted regeneration bar */}
                <div className="pt-2 border-t border-[#262933] flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={regenNotes[para.id] || ''}
                    onChange={(e) => setRegenNotes((prev) => ({ ...prev, [para.id]: e.target.value }))}
                    placeholder="Optional revision note for this paragraph only (e.g., make opening sentence crisper)..."
                    className="flex-1 bg-[#0B0B0D] border border-[#262933] rounded-md px-3 py-1.5 text-xs text-[#D4D6DC] placeholder-[#6B7080] focus:outline-none focus:border-[#E5A03A]"
                  />
                  <button
                    onClick={() => handleRegenerateParagraph(para, idx)}
                    disabled={regenParaId === para.id}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1E2028] border border-[#262933] hover:border-[#E5A03A] text-[#F4F4F6] rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    {regenParaId === para.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Regenerate Paragraph
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={addParagraph}
              className="w-full py-3 border border-dashed border-[#262933] hover:border-[#E5A03A] rounded-xl text-xs font-medium text-[#989CA8] hover:text-[#F4F4F6] inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Narration Segment
            </button>
          </div>

          {/* Right Sidebar (4 cols): Pronunciation Guide, Version History, Citations */}
          <div className="lg:col-span-4 space-y-6">
            {/* Pronunciation Guide */}
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Pronunciation Guidance</h2>
                <Volume2 className="w-4 h-4 text-[#E5A03A]" />
              </div>
              <p className="text-xs text-[#989CA8]">
                Names, dates, and technical terms automatically guide Voice Studio synthesis.
              </p>

              <div className="space-y-2 max-h-56 overflow-y-auto">
                {pronunciationGuide.length === 0 ? (
                  <p className="text-xs text-[#6B7080]">No specialized terms added yet.</p>
                ) : (
                  pronunciationGuide.map((entry, idx) => (
                    <div
                      key={`${entry.term}-${idx}`}
                      className="flex items-center justify-between gap-2 py-2 border-b border-[#262933] last:border-b-0 text-xs"
                    >
                      <div>
                        <span className="font-medium text-[#F4F4F6]">{entry.term}</span>
                        <span className="text-[#989CA8] mx-1.5">→</span>
                        <span className="font-mono-tabular text-[#E5A03A]">{entry.phonetic}</span>
                      </div>
                      <button
                        onClick={() =>
                          setDraftPronunciation(pronunciationGuide.filter((_, i) => i !== idx))
                        }
                        className="text-[#6B7080] hover:text-[#EF4444]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Term / Name"
                  className="bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
                />
                <input
                  value={newPhonetic}
                  onChange={(e) => setNewPhonetic(e.target.value)}
                  placeholder="Phonetic guide"
                  className="bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6] focus:outline-none focus:border-[#E5A03A]"
                />
              </div>
              <button
                onClick={addPronunciation}
                className="w-full py-1.5 text-xs font-medium bg-[#1E2028] border border-[#262933] hover:border-[#E5A03A] text-[#D4D6DC] rounded-md"
              >
                Add Pronunciation Rule
              </button>
            </section>

            {/* Script Version History */}
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Script Version History</h2>
                <button
                  onClick={handleCreateNewVersionSnapshot}
                  disabled={saving}
                  className="text-xs text-[#E5A03A] hover:text-[#F0B254] whitespace-nowrap shrink-0"
                >
                  + Snapshot
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {scripts
                  .slice()
                  .sort((a, b) => b.versionNumber - a.versionNumber)
                  .map((ver) => (
                    <div
                      key={ver.id}
                      className={`p-3 rounded-lg border flex items-center justify-between gap-2 ${
                        ver.isActive
                          ? 'bg-[#1E2028] border-[#E5A03A]/60'
                          : 'bg-[#0B0B0D] border-[#262933]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#F4F4F6] truncate">
                          v{ver.versionNumber} · {ver.label || 'Draft'}
                        </div>
                        <div className="text-[11px] text-[#989CA8] font-mono-tabular">
                          {ver.wordCount} words {ver.isApproved ? '· Approved' : ''}
                        </div>
                      </div>
                      {!ver.isActive && (
                        <button
                          onClick={() => handleRestoreVersion(ver)}
                          className="text-xs text-[#E5A03A] hover:underline whitespace-nowrap shrink-0"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </section>

            {/* Linked Research References */}
            <section className="bg-[#16171D] border border-[#262933] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#F4F4F6]">Research References</h2>
                <BookOpen className="w-4 h-4 text-[#989CA8]" />
              </div>
              <div className="space-y-2 max-h-44 overflow-y-auto text-xs">
                {sources.length === 0 ? (
                  <p className="text-[#6B7080]">Run Research Studio to attach citations.</p>
                ) : (
                  sources.map((s) => (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[#D4D6DC] hover:text-[#E5A03A] truncate"
                    >
                      {s.title} ({s.publisher})
                    </a>
                  ))
                )}
              </div>

              {project.scriptApproved && (
                <button
                  onClick={onNavigateVoice}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254]"
                >
                  Continue to Voice Studio
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
