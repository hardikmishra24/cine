import type {
  ArchivalAsset,
  NarrationSegment,
  NavSection,
  Project,
  RenderJob,
  ResearchSource,
  ScriptVersion,
  StoryboardBeat,
} from '../types/cineforge';

export type PipelineStepId =
  | 'research'
  | 'script'
  | 'voice'
  | 'assets'
  | 'storyboard'
  | 'motion'
  | 'render';

export interface PipelineStepState {
  stepNumber: number;
  id: PipelineStepId;
  label: string;
  shortLabel: string;
  subtitle: string;
  completed: boolean;
  unlocked: boolean;
  isCurrent: boolean;
  isBusy: boolean;
  status: 'completed' | 'current' | 'available' | 'locked';
  lockReason: string | null;
  readyCountLabel?: string;
}

export interface PipelineEvaluation {
  steps: PipelineStepState[];
  completedCount: number;
  progressPercent: number;
  currentStep: PipelineStepState | null;
  previousStep: PipelineStepState | null;
  nextStep: PipelineStepState | null;
  canApproveOrAdvance: boolean;
  advanceButtonLabel: string;
  footerHint: string;
}

export const PIPELINE_STEP_ORDER: PipelineStepId[] = [
  'research',
  'script',
  'voice',
  'storyboard',
  'assets',
  'motion',
  'render',
];

export function isPipelineStep(section: NavSection): section is PipelineStepId {
  return (PIPELINE_STEP_ORDER as string[]).includes(section);
}

export function isBeatVisuallyFulfilled(beat: StoryboardBeat): boolean {
  if (beat.fulfillmentStatus === 'fulfilled' || beat.fulfillmentStatus === 'fallback') {
    return true;
  }
  if (beat.sceneType === 'animated_map' && beat.mapSpec) return true;
  if (beat.sceneType === 'kinetic_title' && beat.onScreenText) return true;
  if (beat.sceneType === 'animated_rig' && beat.animatedRigSpec) return true;
  if (beat.sceneType === 'archival_video' && (beat.heroVideoUrl || beat.heroAssetUrl)) return true;
  if (beat.heroAssetUrl || beat.heroVideoUrl || beat.animatedRigSpec) return true;
  return false;
}

export function evaluatePipeline(params: {
  project: Project;
  sources: ResearchSource[];
  assets: ArchivalAsset[];
  activeScript: ScriptVersion | null;
  segments: NarrationSegment[];
  beats: StoryboardBeat[];
  renders: RenderJob[];
  motionReviewed: boolean;
  currentSection: NavSection;
  busyStepId: PipelineStepId | null;
  busyMessage?: string;
}): PipelineEvaluation {
  const {
    project,
    sources,
    assets,
    activeScript,
    segments,
    beats,
    renders,
    motionReviewed,
    currentSection,
    busyStepId,
    busyMessage,
  } = params;

  const readyApprovedAssets = assets.filter(
    (a) => a.approvalStatus === 'approved' && a.downloadStatus === 'ready'
  );
  const fulfilledBeatsCount = beats.filter(isBeatVisuallyFulfilled).length;
  const allBeatsFulfilled = beats.length > 0 && fulfilledBeatsCount === beats.length;
  const hasMasterAudio = Boolean(project.masterAudio?.audioUrl);
  const hasCompletedRender =
    project.renderStatus === 'completed' || renders.some((r) => r.status === 'completed');

  const step1Done = Boolean(project.researchApproved && project.visualDirectionApproved);
  const step2Done = Boolean(project.scriptApproved && (activeScript?.paragraphs?.length ?? 0) > 0);
  const step3Done = Boolean(project.voiceApproved && hasMasterAudio);
  const step4Done = Boolean(project.storyboardApproved && beats.length > 0);
  const step5Done =
    step4Done &&
    (Boolean(project.assetsApproved) ||
      allBeatsFulfilled ||
      (beats.length > 0 && readyApprovedAssets.length > 0 && fulfilledBeatsCount > 0));
  const step6Done =
    step5Done &&
    (motionReviewed ||
      project.activeStage === 'render' ||
      renders.length > 0 ||
      hasCompletedRender);
  const step7Done = hasCompletedRender;

  // Strict sequential locking (Storyboard-First -> Beat-Driven Media & Animation Studio)
  const step1Unlocked = true;
  const step2Unlocked = step1Done;
  const step3Unlocked = step2Unlocked && step2Done;
  const step4Unlocked = step3Unlocked && step3Done;
  const step5Unlocked = step4Unlocked && step4Done;
  const step6Unlocked = step5Unlocked && step5Done;
  const step7Unlocked = step6Unlocked && step6Done;

  const defs: Array<{
    stepNumber: number;
    id: PipelineStepId;
    label: string;
    shortLabel: string;
    subtitle: string;
    completed: boolean;
    unlocked: boolean;
    lockReason: string | null;
    readyCountLabel?: string;
  }> = [
    {
      stepNumber: 1,
      id: 'research',
      label: 'Research & Direction',
      shortLabel: 'Research',
      subtitle: 'Grounded facts, sources & visual world',
      completed: step1Done,
      unlocked: step1Unlocked,
      lockReason: null,
      readyCountLabel: sources.length > 0 ? `${sources.length} sources` : undefined,
    },
    {
      stepNumber: 2,
      id: 'script',
      label: 'Script Studio',
      shortLabel: 'Script',
      subtitle: 'Spoken documentary script & pronunciation',
      completed: step2Done,
      unlocked: step2Unlocked,
      lockReason: step2Unlocked
        ? null
        : 'Complete and approve Step 1 (Research & Direction) to unlock Script Studio.',
      readyCountLabel: activeScript ? `v${activeScript.versionNumber}` : undefined,
    },
    {
      stepNumber: 3,
      id: 'voice',
      label: 'Voice Studio',
      shortLabel: 'Voice',
      subtitle: 'Voice sample, neural narration & master timeline',
      completed: step3Done,
      unlocked: step3Unlocked,
      lockReason: step3Unlocked
        ? null
        : 'Approve your final documentary script in Step 2 to unlock Voice Studio.',
      readyCountLabel: segments.length > 0 ? `${segments.length} segs` : undefined,
    },
    {
      stepNumber: 4,
      id: 'storyboard',
      label: 'Storyboard',
      shortLabel: 'Storyboard',
      subtitle: 'Shot blueprint & narration-synced visual plan',
      completed: step4Done,
      unlocked: step4Unlocked,
      lockReason: step4Unlocked
        ? null
        : 'Lock your Master Narration Audio in Step 3 (Voice Studio) to unlock Storyboard.',
      readyCountLabel: beats.length > 0 ? `${beats.length} shots` : undefined,
    },
    {
      stepNumber: 5,
      id: 'assets',
      label: 'Media & Animation Studio',
      shortLabel: 'Media',
      subtitle: 'Unique 1-to-1 photos, video clips, rigs & maps',
      completed: step5Done,
      unlocked: step5Unlocked,
      lockReason: step5Unlocked
        ? null
        : 'Approve your Storyboard shot blueprint in Step 4 to unlock Media & Animation Studio.',
      readyCountLabel:
        beats.length > 0 ? `${fulfilledBeatsCount}/${beats.length}` : undefined,
    },
    {
      stepNumber: 6,
      id: 'motion',
      label: 'Motion Studio',
      shortLabel: 'Motion',
      subtitle: 'Continuous spatial camera & sound design',
      completed: step6Done,
      unlocked: step6Unlocked,
      lockReason: step6Unlocked
        ? null
        : 'Fulfill and approve your beat-matched visuals in Step 5 to unlock Motion Studio.',
    },
    {
      stepNumber: 7,
      id: 'render',
      label: 'Render & Export',
      shortLabel: 'Render',
      subtitle: 'H.264/AAC MP4 encoding & QA verification',
      completed: step7Done,
      unlocked: step7Unlocked,
      lockReason: step7Unlocked
        ? null
        : 'Review your continuous motion world in Step 6 and click Lock Motion to unlock Render.',
      readyCountLabel: renders.length > 0 ? `${renders.length}` : undefined,
    },
  ];

  const steps: PipelineStepState[] = defs.map((d) => {
    const isCurrent = currentSection === d.id;
    const isBusy = busyStepId === d.id;
    let status: PipelineStepState['status'];
    if (!d.unlocked) {
      status = 'locked';
    } else if (isCurrent) {
      status = 'current';
    } else if (d.completed) {
      status = 'completed';
    } else {
      status = 'available';
    }
    return { ...d, isCurrent, isBusy, status };
  });

  const completedCount = steps.filter((s) => s.completed).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  const currentIdx = steps.findIndex((s) => s.id === currentSection);
  const currentStep = currentIdx >= 0 ? steps[currentIdx] : null;
  const previousStep = currentIdx > 0 ? steps[currentIdx - 1] : null;
  const nextStep = currentIdx >= 0 && currentIdx < steps.length - 1 ? steps[currentIdx + 1] : null;

  let canApproveOrAdvance = false;
  let advanceButtonLabel = nextStep ? `Continue to ${nextStep.shortLabel}` : 'Complete';
  let footerHint = '';

  if (currentStep) {
    if (busyStepId === currentStep.id) {
      canApproveOrAdvance = false;
      footerHint = busyMessage || `Processing Step ${currentStep.stepNumber}: ${currentStep.label}...`;
    } else {
      switch (currentStep.id) {
        case 'research': {
          const hasResearch = Boolean(project.researchSummary && project.researchSummary.trim().length > 0);
          canApproveOrAdvance = hasResearch;
          advanceButtonLabel = step1Done
            ? 'Continue to Script Studio'
            : 'Approve Research & Continue';
          footerHint = step1Done
            ? 'Step 1 approved. Ready to move into Script Studio.'
            : hasResearch
            ? 'Review your research dossier and world direction, then approve to unlock Step 2.'
            : 'Run Autonomous Research above to gather verified citations and facts.';
          break;
        }
        case 'script': {
          const hasScript = Boolean(activeScript && activeScript.paragraphs.length > 0);
          canApproveOrAdvance = hasScript;
          advanceButtonLabel = step2Done
            ? 'Continue to Voice Studio'
            : 'Approve Script & Continue';
          footerHint = step2Done
            ? 'Final script approved. Ready for Voice Studio.'
            : hasScript
            ? 'Review or refine script paragraphs, then approve to unlock Step 3 (Voice).'
            : 'Generate or write your documentary script above to continue.';
          break;
        }
        case 'voice': {
          canApproveOrAdvance = step3Done;
          advanceButtonLabel = 'Continue to Storyboard';
          footerHint = step3Done
            ? 'Master Narration Audio locked with word timestamps. Storyboard is unlocked.'
            : 'Approve an opening voice sample and generate (or upload) your Master Audio Track to unlock Step 4.';
          break;
        }
        case 'storyboard': {
          const hasBeats = beats.length > 0;
          canApproveOrAdvance = hasBeats;
          advanceButtonLabel = step4Done
            ? 'Continue to Media & Animation Studio'
            : 'Approve Blueprint & Build Visuals';
          footerHint = step4Done
            ? `${beats.length} narration-synced shots approved. Step 5 will fulfill every beat 1-to-1 with zero repeats.`
            : hasBeats
            ? 'Review each shot card’s visual brief and planned medium, then approve to generate beat-matched visuals in Step 5.'
            : 'Generate your narration-synced Storyboard Shot Blueprint above to unlock Step 5.';
          break;
        }
        case 'assets': {
          canApproveOrAdvance = beats.length > 0 && fulfilledBeatsCount > 0;
          advanceButtonLabel = step5Done
            ? 'Continue to Motion Studio'
            : 'Approve Beat Visuals & Continue';
          footerHint = allBeatsFulfilled
            ? `All ${beats.length} storyboard beats fulfilled 1-to-1 with unique visuals. Ready for Motion Studio.`
            : fulfilledBeatsCount > 0
            ? `${fulfilledBeatsCount} of ${beats.length} beats fulfilled. Swap any individual shot or continue to Motion Studio.`
            : 'Fulfill your storyboard beats above to populate unique photos, video clips, animated rigs, and maps.';
          break;
        }
        case 'motion': {
          canApproveOrAdvance = beats.length > 0;
          advanceButtonLabel = step6Done
            ? 'Continue to Render & Export'
            : 'Lock Motion & Go to Render';
          footerHint = step6Done
            ? 'Motion world locked. Ready to encode and verify your MP4.'
            : 'Preview your continuous visual world and audio ducking, then lock motion to unlock Step 7 (Render).';
          break;
        }
        case 'render': {
          canApproveOrAdvance = false;
          advanceButtonLabel = hasCompletedRender ? 'Export Verified' : 'Render Final MP4 Above';
          footerHint = hasCompletedRender
            ? 'Final MP4 rendered and verified by automated QA. Download your deliverables above.'
            : 'Start the MP4 render above to encode H.264/AAC video and run automated quality assurance.';
          break;
        }
      }
    }
  }

  return {
    steps,
    completedCount,
    progressPercent,
    currentStep,
    previousStep,
    nextStep,
    canApproveOrAdvance,
    advanceButtonLabel,
    footerHint,
  };
}

export function getRecommendedActiveStep(evaluation: PipelineEvaluation): PipelineStepId {
  // Find the first unlocked step that is not yet completed, or fall back to the last unlocked step
  const firstIncompleteUnlocked = evaluation.steps.find((s) => s.unlocked && !s.completed);
  if (firstIncompleteUnlocked) return firstIncompleteUnlocked.id;
  const lastUnlocked = [...evaluation.steps].reverse().find((s) => s.unlocked);
  return lastUnlocked?.id ?? 'research';
}
