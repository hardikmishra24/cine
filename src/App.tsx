import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Check,
  Clapperboard,
  FileText,
  Film,
  FolderKanban,
  Images,
  Layers,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  Menu,
  Mic,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetLibraryView } from './components/AssetLibraryView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MotionStudioView } from './components/MotionStudioView';
import { NewProjectWizard } from './components/NewProjectWizard';
import { GuidedStepFooter, TopHorizontalStepper } from './components/ProductionStepper';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { RenderQueueView } from './components/RenderQueueView';
import { ResearchStudioView } from './components/ResearchStudioView';
import { ScriptStudioView } from './components/ScriptStudioView';
import { SignInView } from './components/SignInView';
import { StoryboardView } from './components/StoryboardView';
import { VoiceStudioView } from './components/VoiceStudioView';
import { apiFetch } from './lib/apiClient';
import {
  auth,
  getAuthToken,
  signOutUser,
  testFirestoreConnection,
} from './lib/firebase';
import {
  createProjectDoc,
  createScriptVersionDoc,
  deleteProjectDoc,
  duplicateProjectDoc,
  replaceNarrationSegments,
  saveAssetsBatch,
  saveResearchSources,
  subscribeProjectSubcollection,
  subscribeUserProjects,
  updateAssetDoc,
  updateProjectDoc,
  updateScriptVersionDoc,
  upsertUserProfile,
} from './lib/firestoreStore';
import {
  evaluatePipeline,
  isBeatVisuallyFulfilled,
  isPipelineStep,
  type PipelineStepId,
  type PipelineStepState,
} from './lib/pipelineSteps';
import { formatShortDuration } from './lib/timecode';
import type {
  ArchivalAsset,
  NarrationSegment,
  NavSection,
  Project,
  RenderJob,
  ResearchSource,
  ScriptParagraph,
  ScriptVersion,
  StoryboardBeat,
  UploadedReference,
} from './types/cineforge';

interface ProviderStatus {
  geminiConfigured: boolean;
  voiceProviders: { gemini: boolean; elevenlabs: boolean };
  archivalProviders: { wikimedia: boolean; libraryOfCongress: boolean; nasa: boolean };
  ffmpegAvailable: boolean;
}

const SECTION_META: Record<
  NavSection,
  { label: string; shortLabel: string; requiresProject: boolean }
> = {
  dashboard: { label: 'Dashboard', shortLabel: 'Dashboard', requiresProject: false },
  new_project: { label: 'New Project', shortLabel: 'New Project', requiresProject: false },
  research: { label: 'Research Studio', shortLabel: 'Research Studio', requiresProject: true },
  script: { label: 'Script Studio', shortLabel: 'Script Studio', requiresProject: true },
  voice: { label: 'Voice Studio', shortLabel: 'Voice Studio', requiresProject: true },
  storyboard: { label: 'Storyboard', shortLabel: 'Storyboard', requiresProject: true },
  assets: { label: 'Media & Animation Studio', shortLabel: 'Media', requiresProject: true },
  motion: { label: 'Motion Studio', shortLabel: 'Motion Studio', requiresProject: true },
  render: { label: 'Render Queue', shortLabel: 'Render Queue', requiresProject: true },
  settings: { label: 'Project Settings', shortLabel: 'Project Settings', requiresProject: true },
};

function parseRawScriptToParagraphs(raw: string): ScriptParagraph[] {
  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  const safeBlocks = blocks.length > 0 ? blocks : [raw.trim()];
  return safeBlocks.map((text, idx) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      id: `p_${idx + 1}`,
      heading: idx === 0 ? 'Opening' : `Section ${idx + 1}`,
      text,
      estimatedSec: Math.max(4, Math.round((words / 145) * 60)),
    };
  });
}

function CineForgeStudio() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('cineforge_active_project');
    } catch {
      return null;
    }
  });
  const [navSection, setNavSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Active project subcollections
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [assets, setAssets] = useState<ArchivalAsset[]>([]);
  const [scripts, setScripts] = useState<ScriptVersion[]>([]);
  const [segments, setSegments] = useState<NarrationSegment[]>([]);
  const [beats, setBeats] = useState<StoryboardBeat[]>([]);
  const [renders, setRenders] = useState<RenderJob[]>([]);

  // Live studio state
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [isRunningResearch, setIsRunningResearch] = useState(false);
  const [researchProgressText, setResearchProgressText] = useState('');
  const [researchProgressPct, setResearchProgressPct] = useState<number | undefined>(undefined);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<{ id: PipelineStepId; message: string } | null>(null);
  const [motionReviewedProjects, setMotionReviewedProjects] = useState<Record<string, boolean>>({});
  const [advancingStep, setAdvancingStep] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const reportBusyForStep = useCallback(
    (stepId: PipelineStepId, busy: boolean, message?: string) => {
      setBusyStep((prev) => {
        if (busy) {
          return { id: stepId, message: message || `Processing ${stepId}...` };
        }
        return prev?.id === stepId ? null : prev;
      });
    },
    []
  );

  const handleScriptBusy = useCallback(
    (busy: boolean, message?: string) => reportBusyForStep('script', busy, message),
    [reportBusyForStep]
  );
  const handleVoiceBusy = useCallback(
    (busy: boolean, message?: string) => reportBusyForStep('voice', busy, message),
    [reportBusyForStep]
  );
  const handleAssetsBusy = useCallback(
    (busy: boolean, message?: string) => reportBusyForStep('assets', busy, message),
    [reportBusyForStep]
  );
  const handleStoryboardBusy = useCallback(
    (busy: boolean, message?: string) => reportBusyForStep('storyboard', busy, message),
    [reportBusyForStep]
  );
  const handleRenderBusy = useCallback(
    (busy: boolean, message?: string) => reportBusyForStep('render', busy, message),
    [reportBusyForStep]
  );

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 4200);
  }, []);

  // Verify Firestore connectivity on boot & track Firebase Auth state
  useEffect(() => {
    void testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        try {
          await upsertUserProfile();
        } catch (err) {
          console.error('User profile sync warning:', err);
        }
        try {
          const status = await apiFetch<ProviderStatus>('/api/providers/status');
          setProviderStatus(status);
        } catch (err) {
          console.error('Provider status check warning:', err);
        }
      } else {
        setProjects([]);
        setProjectsLoading(false);
        setActiveProjectId(null);
        setNavSection('dashboard');
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to signed-in user's projects
  useEffect(() => {
    if (!user) return;
    setProjectsLoading(true);
    const unsub = subscribeUserProjects(user.uid, (list) => {
      setProjects(list);
      setProjectsLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Persist activeProjectId in sessionStorage
  useEffect(() => {
    try {
      if (activeProjectId) {
        sessionStorage.setItem('cineforge_active_project', activeProjectId);
      } else {
        sessionStorage.removeItem('cineforge_active_project');
      }
    } catch {
      // ignore storage restrictions
    }
  }, [activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  // If the stored activeProjectId no longer exists after projects load, clear it
  useEffect(() => {
    if (!projectsLoading && activeProjectId && !activeProject) {
      setActiveProjectId(null);
      if (SECTION_META[navSection].requiresProject) {
        setNavSection('dashboard');
      }
    }
  }, [projectsLoading, activeProjectId, activeProject, navSection]);

  // Subscribe to all 6 Firestore subcollections for the active project
  useEffect(() => {
    if (!user || !activeProjectId) {
      setSources([]);
      setAssets([]);
      setScripts([]);
      setSegments([]);
      setBeats([]);
      setRenders([]);
      return;
    }

    const unsubSources = subscribeProjectSubcollection<ResearchSource>(
      activeProjectId,
      user.uid,
      'sources',
      setSources,
      (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );

    const unsubAssets = subscribeProjectSubcollection<ArchivalAsset>(
      activeProjectId,
      user.uid,
      'assets',
      setAssets,
      (a, b) => {
        const rank = (s: ArchivalAsset['approvalStatus']) =>
          s === 'approved' ? 0 : s === 'pending' ? 1 : 2;
        const diff = rank(a.approvalStatus) - rank(b.approvalStatus);
        if (diff !== 0) return diff;
        return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      }
    );

    const unsubScripts = subscribeProjectSubcollection<ScriptVersion>(
      activeProjectId,
      user.uid,
      'scripts',
      setScripts,
      (a, b) => b.versionNumber - a.versionNumber
    );

    const unsubSegments = subscribeProjectSubcollection<NarrationSegment>(
      activeProjectId,
      user.uid,
      'segments',
      setSegments,
      (a, b) => a.orderIndex - b.orderIndex
    );

    const unsubBeats = subscribeProjectSubcollection<StoryboardBeat>(
      activeProjectId,
      user.uid,
      'beats',
      setBeats,
      (a, b) => a.orderIndex - b.orderIndex
    );

    const unsubRenders = subscribeProjectSubcollection<RenderJob>(
      activeProjectId,
      user.uid,
      'renders',
      setRenders,
      (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );

    return () => {
      unsubSources();
      unsubAssets();
      unsubScripts();
      unsubSegments();
      unsubBeats();
      unsubRenders();
    };
  }, [user, activeProjectId]);

  // Subscribe to real-time SSE project events for active project
  useEffect(() => {
    if (!user || !activeProjectId) return;
    let es: EventSource | null = null;
    let cancelled = false;

    getAuthToken()
      .then((token) => {
        if (cancelled) return;
        es = new EventSource(
          `/api/events/${encodeURIComponent(activeProjectId)}?token=${encodeURIComponent(token)}`
        );
        es.addEventListener('progress', (ev) => {
          try {
            const payload = JSON.parse((ev as MessageEvent).data);
            if (payload?.stage) {
              setResearchProgressText(String(payload.stage));
            }
            if (typeof payload?.progress === 'number') {
              setResearchProgressPct(payload.progress);
            }
          } catch {
            // ignore malformed event
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [user, activeProjectId]);

  const activeScript = useMemo(
    () => scripts.find((s) => s.isActive) ?? scripts[0] ?? null,
    [scripts]
  );

  // Update active project helper
  const handleUpdateActiveProject = useCallback(
    async (patch: Partial<Project>) => {
      if (!activeProject) return;
      await updateProjectDoc(activeProject.id, patch);
    },
    [activeProject]
  );

  // Autonomous Research + Archival Photo Discovery
  const runResearchForProject = useCallback(
    async (
      proj: Project,
      options?: { scriptContext?: string; references?: UploadedReference[] }
    ) => {
      setIsRunningResearch(true);
      setResearchError(null);
      setResearchProgressPct(10);
      setResearchProgressText('Initializing Gemini Search Grounding & archival verification...');
      try {
        const refs = options?.references ?? proj.uploadedReferences ?? [];
        const referenceTexts = refs
          .map((r) => r.extractedText)
          .filter((t): t is string => Boolean(t && t.trim()));

        const scriptCtx =
          options?.scriptContext ??
          (activeScript
            ? activeScript.paragraphs.map((p) => p.text).join('\n\n')
            : undefined);

        const res = await apiFetch<{
          summary: string;
          entities: Project['researchEntities'];
          sources: Array<Omit<ResearchSource, 'id' | 'ownerId' | 'projectId' | 'createdAt'>>;
          visualDirection: Project['visualDirection'];
          assets: Array<Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>;
        }>('/api/research', {
          method: 'POST',
          body: JSON.stringify({
            projectId: proj.id,
            topic: proj.topic || proj.title,
            scriptContext: scriptCtx,
            language: proj.language || 'English',
            researchPreferences: proj.researchPreferences || '',
            referenceTexts,
          }),
        });

        if (Array.isArray(res.sources) && res.sources.length > 0) {
          await saveResearchSources(proj.id, res.sources);
        }

        let firstReadyImage: string | undefined;
        if (Array.isArray(res.assets) && res.assets.length > 0) {
          const savedAssets = await saveAssetsBatch(proj.id, res.assets);
          firstReadyImage = savedAssets.find(
            (a) => a.downloadStatus === 'ready' && a.imageUrl
          )?.imageUrl;
        }

        // Action 2 keys only (strictly compliant with firestore.rules)
        await updateProjectDoc(proj.id, {
          researchSummary: res.summary,
          researchEntities: res.entities,
          visualDirection: res.visualDirection,
          worldEnvironment: res.visualDirection?.worldEnvironment || proj.worldEnvironment,
          ...(firstReadyImage && !proj.thumbnailUrl ? { thumbnailUrl: firstReadyImage } : {}),
          status: proj.status === 'draft' ? 'in_production' : proj.status,
          activeStage: 'research',
        });

        showToast(
          `Research complete: ${res.sources?.length || 0} verified sources and ${res.assets?.length || 0} archival records indexed.`
        );
      } catch (err: any) {
        const msg = err?.message || 'Autonomous research encountered an error.';
        setResearchError(msg);
        showToast(msg);
      } finally {
        setIsRunningResearch(false);
        setResearchProgressText('');
        setResearchProgressPct(undefined);
      }
    },
    [activeScript, showToast]
  );

  // Create Project Orchestration (Modes A, B, C)
  const handleCreateProject = useCallback(
    async (params: {
      projectData: Omit<Project, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;
      suppliedScript?: string;
      voiceoverFile?: File | null;
      referenceFiles: File[];
      autoStartPipeline: boolean;
    }) => {
      const created = await createProjectDoc(params.projectData);
      setActiveProjectId(created.id);

      // 1. Upload any reference files (PDFs, text briefs, reference photos)
      const uploadedRefs: UploadedReference[] = [];
      const uploadedImageAssets: Array<
        Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>
      > = [];

      for (const file of params.referenceFiles) {
        try {
          const fd = new FormData();
          fd.append('projectId', created.id);
          fd.append('file', file);
          const uploaded = await apiFetch<UploadedReference>('/api/uploads/reference', {
            method: 'POST',
            body: fd,
          });
          uploadedRefs.push(uploaded);
          if (file.type.startsWith('image/')) {
            uploadedImageAssets.push({
              title: file.name.replace(/\.[^.]+$/, ''),
              description: 'User-supplied reference photograph attached during project setup.',
              sourceProvider: 'upload',
              imageUrl: uploaded.url,
              thumbnailUrl: uploaded.url,
              creator: 'User Upload',
              license: 'Project Reference',
              category: 'reference',
              approvalStatus: 'approved',
              downloadStatus: 'ready',
            });
          }
        } catch (err: any) {
          showToast(`Reference upload skipped (${file.name}): ${err?.message || 'failed'}`);
        }
      }

      if (uploadedRefs.length > 0) {
        // Action 1 keys only
        await updateProjectDoc(created.id, {
          uploadedReferences: uploadedRefs,
          ...(uploadedImageAssets[0]?.imageUrl
            ? { thumbnailUrl: uploadedImageAssets[0].imageUrl }
            : {}),
        });
      }
      if (uploadedImageAssets.length > 0) {
        await saveAssetsBatch(created.id, uploadedImageAssets);
      }

      let scriptContextForResearch: string | undefined;

      // 2. Mode B: Save supplied script as Version 1
      if (params.projectData.inputMode === 'script' && params.suppliedScript?.trim()) {
        const paragraphs = parseRawScriptToParagraphs(params.suppliedScript);
        const wordCount = paragraphs.reduce(
          (sum, p) => sum + p.text.split(/\s+/).filter(Boolean).length,
          0
        );
        const estimatedDurationSec = paragraphs.reduce((sum, p) => sum + p.estimatedSec, 0);
        await createScriptVersionDoc(
          created.id,
          {
            versionNumber: 1,
            label: 'Supplied Script (v1)',
            isActive: true,
            isApproved: false,
            wordCount,
            estimatedDurationSec,
            paragraphs,
            pronunciationGuide: [],
          },
          []
        );
        scriptContextForResearch = params.suppliedScript.trim();
      }

      // 3. Mode C: Upload & Analyze existing voiceover recording (never alters speaker voice)
      if (params.projectData.inputMode === 'voiceover' && params.voiceoverFile) {
        showToast('Analyzing uploaded voiceover recording & extracting word timestamps...');
        const fd = new FormData();
        fd.append('projectId', created.id);
        fd.append('audio', params.voiceoverFile);
        const analysis = await apiFetch<{
          masterAudio: NonNullable<Project['masterAudio']>;
          transcript: string;
          analyzedSegments: Array<{
            orderIndex: number;
            text: string;
            durationMs: number;
            wordTimestamps: NarrationSegment['wordTimestamps'];
            pauseMarkers: NarrationSegment['pauseMarkers'];
          }>;
        }>('/api/audio/upload-and-analyze', {
          method: 'POST',
          body: fd,
        });

        await replaceNarrationSegments(
          created.id,
          analysis.analyzedSegments.map((seg, idx) => ({
            orderIndex: idx,
            text: seg.text,
            audioUrl: analysis.masterAudio.audioUrl,
            durationMs: seg.durationMs,
            status: 'uploaded',
            wordTimestamps: seg.wordTimestamps || [],
            pauseMarkers: seg.pauseMarkers || [],
            version: 1,
          })),
          []
        );

        if (analysis.transcript?.trim()) {
          const paragraphs = parseRawScriptToParagraphs(analysis.transcript);
          const wordCount = paragraphs.reduce(
            (sum, p) => sum + p.text.split(/\s+/).filter(Boolean).length,
            0
          );
          await createScriptVersionDoc(
            created.id,
            {
              versionNumber: 1,
              label: 'Transcribed Voiceover (Locked)',
              isActive: true,
              isApproved: true,
              wordCount,
              estimatedDurationSec: Math.round(analysis.masterAudio.durationMs / 1000),
              paragraphs,
              pronunciationGuide: [],
            },
            []
          );
          scriptContextForResearch = analysis.transcript.trim();
        }

        // Action 3 keys only
        await updateProjectDoc(created.id, {
          masterAudio: analysis.masterAudio,
          narrationDurationSec: Math.round(analysis.masterAudio.durationMs / 1000),
          voiceApproved: true,
          scriptApproved: true,
          status: 'in_production',
          activeStage: 'research',
        });
      }

      // 4. Route cleanly into Step 01 (Research) to honor strict step-by-step gating
      setNavSection('research');
      if (params.autoStartPipeline) {
        showToast(`Created "${created.title}". Starting Step 1: Autonomous Research & Archival Discovery.`);
        void runResearchForProject(
          { ...created, uploadedReferences: uploadedRefs },
          { scriptContext: scriptContextForResearch, references: uploadedRefs }
        );
      } else {
        showToast(`Created "${created.title}". Complete Step 1 (Research & Visual Direction) to unlock the pipeline.`);
      }
    },
    [runResearchForProject, showToast]
  );

  // Strict 7-step production pipeline evaluation
  const effectiveBusyStepId: PipelineStepId | null = isRunningResearch
    ? 'research'
    : busyStep?.id ?? null;
  const effectiveBusyMessage = isRunningResearch
    ? researchProgressText || 'Running autonomous research & archival discovery...'
    : busyStep?.message;

  const pipelineEval = useMemo(() => {
    if (!activeProject) return null;
    return evaluatePipeline({
      project: activeProject,
      sources,
      assets,
      activeScript,
      segments,
      beats,
      renders,
      motionReviewed: Boolean(motionReviewedProjects[activeProject.id]),
      currentSection: navSection,
      busyStepId: effectiveBusyStepId,
      busyMessage: effectiveBusyMessage,
    });
  }, [
    activeProject,
    sources,
    assets,
    activeScript,
    segments,
    beats,
    renders,
    motionReviewedProjects,
    navSection,
    effectiveBusyStepId,
    effectiveBusyMessage,
  ]);

  // Dashboard project actions
  const handleOpenProject = useCallback((project: Project) => {
    setActiveProjectId(project.id);
    // Honor strict gating immediately based on project approval flags
    if (!project.researchApproved || !project.visualDirectionApproved) {
      setNavSection('research');
    } else if (!project.scriptApproved) {
      setNavSection('script');
    } else if (!project.voiceApproved || !project.masterAudio?.audioUrl) {
      setNavSection('voice');
    } else if (!project.storyboardApproved) {
      setNavSection('storyboard');
    } else if (!project.assetsApproved && project.activeStage !== 'motion' && project.activeStage !== 'render' && project.renderStatus !== 'completed') {
      setNavSection('assets');
    } else if (project.activeStage === 'render' || project.renderStatus === 'completed') {
      setNavSection('render');
    } else {
      setNavSection('motion');
    }
    setMobileMenuOpen(false);
  }, []);

  const handleRenameProject = useCallback(
    async (projectId: string, newTitle: string) => {
      await updateProjectDoc(projectId, { title: newTitle });
      showToast(`Project renamed to "${newTitle}".`);
    },
    [showToast]
  );

  const handleDuplicateProject = useCallback(
    async (project: Project) => {
      const copy = await duplicateProjectDoc(project);
      showToast(`Duplicated "${project.title}" as "${copy.title}".`);
    },
    [showToast]
  );

  const handleToggleArchive = useCallback(
    async (project: Project) => {
      const nextStatus = project.status === 'archived' ? 'in_production' : 'archived';
      await updateProjectDoc(project.id, { status: nextStatus });
      showToast(
        nextStatus === 'archived'
          ? `Archived "${project.title}".`
          : `Restored "${project.title}" to active studio.`
      );
    },
    [showToast]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      await deleteProjectDoc(projectId);
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
        setNavSection('dashboard');
      }
      showToast('Project permanently deleted.');
    },
    [activeProjectId, showToast]
  );

  const navigateTo = useCallback(
    (section: NavSection) => {
      if (SECTION_META[section].requiresProject && !activeProject) {
        showToast('Select or create a documentary project first.');
        setNavSection('dashboard');
        return;
      }
      if (isPipelineStep(section) && pipelineEval) {
        const target = pipelineEval.steps.find((s) => s.id === section);
        if (target && !target.unlocked) {
          showToast(
            target.lockReason || `Complete Step ${target.stepNumber - 1} to unlock ${target.label}.`
          );
          return;
        }
      }
      setNavSection(section);
      setMobileMenuOpen(false);
    },
    [activeProject, pipelineEval, showToast]
  );

  const handleSelectPipelineStep = useCallback(
    (step: PipelineStepState) => {
      if (!step.unlocked) {
        showToast(
          step.lockReason || `Complete Step ${step.stepNumber - 1} to unlock ${step.label}.`
        );
        return;
      }
      setNavSection(step.id);
      setMobileMenuOpen(false);
    },
    [showToast]
  );

  const handleGoPreviousStep = useCallback(() => {
    if (pipelineEval?.previousStep) {
      setNavSection(pipelineEval.previousStep.id);
    }
  }, [pipelineEval]);

  const handleApproveAndContinue = useCallback(async () => {
    if (!activeProject || !pipelineEval?.currentStep || !pipelineEval.nextStep) return;
    if (!pipelineEval.canApproveOrAdvance) {
      showToast(pipelineEval.footerHint);
      return;
    }

    const currentId = pipelineEval.currentStep.id;
    const nextId = pipelineEval.nextStep.id;

    setAdvancingStep(true);
    try {
      if (currentId === 'research') {
        if (!activeProject.researchApproved || !activeProject.visualDirectionApproved) {
          // Action 2 keys only
          await updateProjectDoc(activeProject.id, {
            researchApproved: true,
            visualDirectionApproved: true,
            activeStage: 'script',
          });
          showToast('Step 1 approved. Script Studio is now unlocked.');
        }
        setNavSection('script');
      } else if (currentId === 'script') {
        if (!activeProject.scriptApproved) {
          if (activeScript) {
            await updateScriptVersionDoc(activeProject.id, activeScript.id, { isApproved: true });
          }
          // Action 3 keys only
          await updateProjectDoc(activeProject.id, {
            scriptApproved: true,
            activeStage: 'voice',
          });
          showToast('Step 2 approved. Voice Studio is now unlocked.');
        }
        setNavSection('voice');
      } else if (currentId === 'voice') {
        await updateProjectDoc(activeProject.id, { activeStage: 'storyboard' });
        setNavSection('storyboard');
      } else if (currentId === 'storyboard') {
        if (!activeProject.storyboardApproved) {
          await updateProjectDoc(activeProject.id, {
            storyboardApproved: true,
            activeStage: 'assets',
          });
          showToast('Step 4 Storyboard blueprint locked. Media & Animation Studio is now unlocked.');
        } else {
          await updateProjectDoc(activeProject.id, { activeStage: 'assets' });
        }
        setNavSection('assets');
      } else if (currentId === 'assets') {
        const unapprovedReady = assets.filter(
          (a) => a.downloadStatus === 'ready' && a.approvalStatus === 'pending'
        );
        if (unapprovedReady.length > 0) {
          await Promise.all(
            unapprovedReady.map((a) =>
              updateAssetDoc(activeProject.id, a.id, { approvalStatus: 'approved' })
            )
          );
        }
        await updateProjectDoc(activeProject.id, {
          assetsApproved: true,
          activeStage: 'motion',
        });
        showToast('Step 5 beat visuals approved. Motion Studio is now unlocked.');
        setNavSection('motion');
      } else if (currentId === 'motion') {
        setMotionReviewedProjects((prev) => ({ ...prev, [activeProject.id]: true }));
        // Action 3 keys only
        await updateProjectDoc(activeProject.id, { activeStage: 'render' });
        showToast('Motion world locked. Render & Export is now unlocked.');
        setNavSection('render');
      } else {
        setNavSection(nextId);
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not advance to the next step.');
    } finally {
      setAdvancingStep(false);
    }
  }, [activeProject, activeScript, assets, pipelineEval, showToast]);

  // Auth loading state
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0B0B0D] text-[#F3F4F6] flex flex-col items-center justify-center gap-4">
        <div className="w-11 h-11 rounded-md bg-[#E5A03A]/15 border border-[#E5A03A]/40 flex items-center justify-center">
          <Film className="w-5 h-5 text-[#E5A03A]" />
        </div>
        <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E5A03A]" />
          Loading CineForge Studio...
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInView />;
  }

  const fulfilledBeatCount = beats.filter(isBeatVisuallyFulfilled).length;

  const stepIconMap: Record<PipelineStepId, typeof Search> = {
    research: Search,
    script: FileText,
    voice: Mic,
    storyboard: Layers,
    assets: Images,
    motion: Clapperboard,
    render: Film,
  };

  const stepMetaMap: Record<PipelineStepId, string | undefined> = {
    research: sources.length > 0 ? `${sources.length}` : undefined,
    script: activeScript ? `v${activeScript.versionNumber}` : undefined,
    voice:
      activeProject && activeProject.narrationDurationSec > 0
        ? formatShortDuration(activeProject.narrationDurationSec)
        : undefined,
    storyboard: beats.length > 0 ? `${beats.length}` : undefined,
    assets: beats.length > 0 ? `${fulfilledBeatCount}/${beats.length}` : assets.length > 0 ? `${assets.length}` : undefined,
    motion: undefined,
    render: renders.length > 0 ? `${renders.length}` : undefined,
  };

  const pipelineNavItems: Array<{
    id: PipelineStepId;
    stepNumber: number;
    label: string;
    icon: typeof Search;
    done: boolean;
    unlocked: boolean;
    isBusy: boolean;
    lockReason: string | null;
    meta?: string;
  }> = pipelineEval
    ? pipelineEval.steps.map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        label: SECTION_META[s.id].label,
        icon: stepIconMap[s.id],
        done: s.completed,
        unlocked: s.unlocked,
        isBusy: s.isBusy,
        lockReason: s.lockReason,
        meta: stepMetaMap[s.id],
      }))
    : (['research', 'script', 'voice', 'storyboard', 'assets', 'motion', 'render'] as PipelineStepId[]).map(
        (id, idx) => ({
          id,
          stepNumber: idx + 1,
          label: SECTION_META[id].label,
          icon: stepIconMap[id],
          done: false,
          unlocked: false,
          isBusy: false,
          lockReason: 'Open a project first.',
          meta: undefined,
        })
      );

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Studio Brand */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-[#262933] shrink-0">
        <button
          onClick={() => navigateTo('dashboard')}
          className="flex items-center gap-2.5 text-left group"
        >
          <div className="w-7 h-7 rounded bg-[#E5A03A] text-[#0B0B0D] flex items-center justify-center shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <div className="font-display text-base leading-none text-[#F3F4F6] tracking-tight">
              CineForge
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#6B7280] mt-0.5">
              Documentary Studio
            </div>
          </div>
        </button>
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-[#9CA3AF] hover:text-[#F3F4F6]"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Studio Root */}
        <div>
          <div className="px-2.5 mb-2 text-[10px] uppercase tracking-[0.14em] text-[#6B7280] font-medium">
            Studio
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => navigateTo('dashboard')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] transition-colors ${
                navSection === 'dashboard'
                  ? 'bg-[#1D1F28] text-[#F3F4F6] font-medium'
                  : 'text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#16171D]'
              }`}
            >
              <LayoutGrid
                className={`w-4 h-4 shrink-0 ${
                  navSection === 'dashboard' ? 'text-[#E5A03A]' : 'text-[#6B7280]'
                }`}
              />
              <span className="truncate">Dashboard</span>
              <span className="ml-auto font-mono text-[11px] text-[#6B7280]">
                {projects.filter((p) => p.status !== 'archived').length}
              </span>
            </button>
            <button
              onClick={() => navigateTo('new_project')}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] transition-colors ${
                navSection === 'new_project'
                  ? 'bg-[#1D1F28] text-[#F3F4F6] font-medium'
                  : 'text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#16171D]'
              }`}
            >
              <Plus
                className={`w-4 h-4 shrink-0 ${
                  navSection === 'new_project' ? 'text-[#E5A03A]' : 'text-[#6B7280]'
                }`}
              />
              <span className="truncate">New Project</span>
            </button>
          </div>
        </div>

        {/* Active Production Pipeline */}
        <div>
          <div className="px-2.5 mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#6B7280] font-medium">
              Production Suite
            </span>
          </div>

          {activeProject ? (
            <div className="mx-1 mb-3 px-2.5 py-2 rounded bg-[#16171D] border border-[#262933]">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#E5A03A]">
                <FolderKanban className="w-3 h-3 shrink-0" />
                Active Production
              </div>
              <div className="text-xs font-medium text-[#F3F4F6] truncate mt-1">
                {activeProject.title}
              </div>
              <div className="font-mono text-[10px] text-[#6B7280] mt-0.5">
                {activeProject.aspectRatio} · {activeProject.resolution} · {activeProject.frameRate}fps
              </div>
            </div>
          ) : (
            <div className="mx-1 mb-3 px-2.5 py-2 rounded border border-dashed border-[#262933] text-[11px] text-[#6B7280]">
              Open a project from Dashboard to enter production workspaces.
            </div>
          )}

          <div className="space-y-0.5">
            {pipelineNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = navSection === item.id;
              const noProject = !activeProject;
              const locked = !noProject && !item.unlocked;
              return (
                <button
                  key={item.id}
                  onClick={() => navigateTo(item.id)}
                  disabled={noProject}
                  title={locked ? item.lockReason || 'Locked step' : `Step ${item.stepNumber}: ${item.label}`}
                  aria-disabled={noProject || locked}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded text-[13px] transition-colors ${
                    isActive
                      ? 'bg-[#1D1F28] text-[#F3F4F6] font-medium'
                      : noProject || locked
                      ? 'text-[#6B7280]/55 cursor-not-allowed hover:bg-[#14151B]'
                      : 'text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#16171D]'
                  }`}
                >
                  <span
                    className={`font-mono tabular-nums text-[10px] w-4 shrink-0 ${
                      isActive
                        ? 'text-[#E5A03A] font-semibold'
                        : item.done
                        ? 'text-[#34D399]'
                        : 'text-[#4B5563]'
                    }`}
                  >
                    {String(item.stepNumber).padStart(2, '0')}
                  </span>
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive
                        ? 'text-[#E5A03A]'
                        : noProject || locked
                        ? 'text-[#6B7280]/40'
                        : 'text-[#6B7280]'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    {item.meta && !locked && (
                      <span className="font-mono tabular-nums text-[10px] text-[#6B7280]">{item.meta}</span>
                    )}
                    {item.isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#E5A03A] animate-spin" />
                    ) : locked ? (
                      <Lock className="w-3 h-3 text-[#4B5563]" />
                    ) : item.done ? (
                      <Check className="w-3.5 h-3.5 text-[#34D399]" />
                    ) : null}
                  </span>
                </button>
              );
            })}

            <div className="pt-2 mt-2 border-t border-[#262933]/70">
              <button
                onClick={() => navigateTo('settings')}
                disabled={!activeProject}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] transition-colors ${
                  navSection === 'settings'
                    ? 'bg-[#1D1F28] text-[#F3F4F6] font-medium'
                    : !activeProject
                    ? 'text-[#6B7280]/50 cursor-not-allowed'
                    : 'text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#16171D]'
                }`}
              >
                <Settings
                  className={`w-4 h-4 shrink-0 ${
                    navSection === 'settings'
                      ? 'text-[#E5A03A]'
                      : !activeProject
                      ? 'text-[#6B7280]/40'
                      : 'text-[#6B7280]'
                  }`}
                />
                <span className="truncate">Project Settings</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Account Footer */}
      <div className="p-3 border-t border-[#262933] shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'Producer'}
              className="w-7 h-7 rounded-full object-cover border border-[#262933] shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#1D1F28] border border-[#262933] flex items-center justify-center text-xs font-medium text-[#E5A03A] shrink-0">
              {(user.displayName || user.email || 'P')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-[#F3F4F6] truncate">
              {user.displayName || 'Producer'}
            </div>
            <div className="text-[11px] text-[#6B7280] truncate">{user.email}</div>
          </div>
          <button
            onClick={() => void signOutUser()}
            title="Sign out"
            className="p-1.5 rounded text-[#6B7280] hover:text-[#F3F4F6] hover:bg-[#1D1F28] transition-colors shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F3F4F6] flex">
      {/* Desktop Left Navigation Rail */}
      <aside className="hidden lg:flex w-[244px] shrink-0 flex-col bg-[#101116] border-r border-[#262933] sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-[264px] max-w-[85vw] bg-[#101116] border-r border-[#262933] h-full">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* 3-Zone Top Bar */}
        <header className="h-14 sticky top-0 z-30 bg-[#0B0B0D]/90 backdrop-blur-md border-b border-[#262933] px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0">
          {/* Zone 1: Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#16171D]"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-[#6B7280] hidden sm:inline">CineForge</span>
              <span className="text-[#262933] hidden sm:inline">/</span>
              {activeProject && SECTION_META[navSection].requiresProject ? (
                <>
                  <span className="text-[#9CA3AF] truncate max-w-[180px] md:max-w-[260px]">
                    {activeProject.title}
                  </span>
                  <span className="text-[#262933]">/</span>
                </>
              ) : null}
              <span className="text-[#F3F4F6] font-medium whitespace-nowrap">
                {SECTION_META[navSection].label}
              </span>
            </div>
          </div>

          {/* Zone 2: Quiet Production Spec / Philosophy Readout */}
          <div className="hidden xl:flex items-center gap-2.5 text-[11px] text-[#6B7280] font-mono">
            {activeProject && SECTION_META[navSection].requiresProject ? (
              <>
                <span>{activeProject.inputMode.toUpperCase()}</span>
                <span>·</span>
                <span>{activeProject.resolution}</span>
                <span>·</span>
                <span>{activeProject.frameRate}fps</span>
                <span>·</span>
                <span>
                  {activeProject.narrationDurationSec > 0
                    ? formatShortDuration(activeProject.narrationDurationSec)
                    : formatShortDuration(activeProject.targetDurationSec)}
                </span>
              </>
            ) : (
              <span className="tracking-wider uppercase">
                Voice First · Story Second · Visuals Third
              </span>
            )}
          </div>

          {/* Zone 3: Contextual Primary Action & Live Processing Readout */}
          <div className="flex items-center gap-3 shrink-0">
            {effectiveBusyStepId && (
              <div className="hidden md:flex items-center gap-2 text-xs text-[#E5A03A]">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate max-w-[240px]">
                  {effectiveBusyMessage || 'Processing active step...'}
                </span>
              </div>
            )}

            {navSection === 'dashboard' ? (
              <button
                onClick={() => navigateTo('new_project')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#E5A03A] hover:bg-[#EEB255] text-[#0B0B0D] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                New Project
              </button>
            ) : activeProject &&
              pipelineEval &&
              navSection !== 'render' &&
              navSection !== 'new_project' &&
              pipelineEval.steps.find((s) => s.id === 'render')?.unlocked ? (
              <button
                onClick={() => navigateTo('render')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#262933] hover:border-[#3A3F50] bg-[#16171D] text-[#F3F4F6] text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Film className="w-3.5 h-3.5 text-[#E5A03A] shrink-0" />
                Render Queue
              </button>
            ) : null}
          </div>
        </header>

        {/* Top Horizontal 7-Step Production Stepper (Active Project) */}
        {activeProject &&
          pipelineEval &&
          (isPipelineStep(navSection) || navSection === 'settings') && (
            <TopHorizontalStepper
              evaluation={pipelineEval}
              onSelectStep={handleSelectPipelineStep}
            />
          )}

        {/* Workspace View Body + Guided Step Footer */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeProject?.id ?? 'none'}-${navSection}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {navSection === 'dashboard' && (
                  <DashboardView
                    projects={projects}
                    loading={projectsLoading}
                    onNewProject={() => navigateTo('new_project')}
                    onOpenProject={handleOpenProject}
                    onRenameProject={handleRenameProject}
                    onDuplicateProject={handleDuplicateProject}
                    onToggleArchive={handleToggleArchive}
                    onDeleteProject={handleDeleteProject}
                  />
                )}

                {navSection === 'new_project' && (
                  <NewProjectWizard
                    onCreateProject={handleCreateProject}
                    onCancel={() => navigateTo(activeProject ? 'research' : 'dashboard')}
                  />
                )}

                {navSection === 'research' && activeProject && (
                  <ResearchStudioView
                    project={activeProject}
                    sources={sources}
                    assets={assets}
                    isRunningResearch={isRunningResearch}
                    progressText={researchProgressText}
                    progressPercent={researchProgressPct}
                    researchError={researchError}
                    onRunResearch={() => runResearchForProject(activeProject)}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigate={(sec) => {
                      if (sec === 'script' && pipelineEval?.canApproveOrAdvance) {
                        void handleApproveAndContinue();
                      } else {
                        navigateTo(sec);
                      }
                    }}
                  />
                )}

                {navSection === 'script' && activeProject && (
                  <ScriptStudioView
                    project={activeProject}
                    scripts={scripts}
                    sources={sources}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigateVoice={() => setNavSection('voice')}
                    onToast={showToast}
                    onBusyChange={handleScriptBusy}
                  />
                )}

                {navSection === 'voice' && activeProject && (
                  <VoiceStudioView
                    project={activeProject}
                    activeScript={activeScript}
                    segments={segments}
                    elevenLabsConfigured={Boolean(providerStatus?.voiceProviders?.elevenlabs)}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigateStoryboard={() => navigateTo('storyboard')}
                    onToast={showToast}
                    onBusyChange={handleVoiceBusy}
                  />
                )}

                {navSection === 'storyboard' && activeProject && (
                  <StoryboardView
                    project={activeProject}
                    segments={segments}
                    assets={assets}
                    beats={beats}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigateAssets={() => setNavSection('assets')}
                    onToast={showToast}
                    onBusyChange={handleStoryboardBusy}
                  />
                )}

                {navSection === 'assets' && activeProject && (
                  <AssetLibraryView
                    project={activeProject}
                    activeScript={activeScript}
                    assets={assets}
                    beats={beats}
                    segments={segments}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigateMotion={() => setNavSection('motion')}
                    onToast={showToast}
                    onBusyChange={handleAssetsBusy}
                  />
                )}

                {navSection === 'motion' && activeProject && (
                  <MotionStudioView
                    project={activeProject}
                    beats={beats}
                    segments={segments}
                    assets={assets}
                    onUpdateProject={handleUpdateActiveProject}
                    onNavigateRender={() => {
                      setMotionReviewedProjects((prev) => ({ ...prev, [activeProject.id]: true }));
                      void handleUpdateActiveProject({ activeStage: 'render' });
                      setNavSection('render');
                    }}
                  />
                )}

                {navSection === 'render' && activeProject && (
                  <RenderQueueView
                    project={activeProject}
                    beats={beats}
                    assets={assets}
                    sources={sources}
                    activeScript={activeScript}
                    renders={renders}
                    onUpdateProject={handleUpdateActiveProject}
                    onToast={showToast}
                    onBusyChange={handleRenderBusy}
                  />
                )}

                {navSection === 'settings' && activeProject && (
                  <ProjectSettingsView
                    project={activeProject}
                    providerStatus={providerStatus}
                    onUpdateProject={handleUpdateActiveProject}
                    onDeleteProject={handleDeleteProject}
                    onToast={showToast}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {activeProject && pipelineEval && isPipelineStep(navSection) && (
            <GuidedStepFooter
              evaluation={pipelineEval}
              advancing={advancingStep}
              onGoPrevious={handleGoPreviousStep}
              onApproveAndContinue={handleApproveAndContinue}
            />
          )}
        </main>
      </div>

      {/* Non-Blocking Toast Banner */}
      {toastMessage && (
        <div
          className={`fixed right-5 z-50 max-w-md bg-[#16171D] border border-[#E5A03A]/40 shadow-2xl rounded-md px-4 py-3 flex items-center gap-3 ${
            activeProject && isPipelineStep(navSection) ? 'bottom-20' : 'bottom-5'
          }`}
        >
          <Sparkles className="w-4 h-4 text-[#E5A03A] shrink-0" />
          <p className="text-xs text-[#F3F4F6] leading-relaxed">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="text-[#6B7280] hover:text-[#F3F4F6] shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CineForgeStudio />
    </ErrorBoundary>
  );
}
