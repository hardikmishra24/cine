import { ArrowLeft, ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { PipelineEvaluation, PipelineStepId, PipelineStepState } from '../lib/pipelineSteps';

interface TopHorizontalStepperProps {
  evaluation: PipelineEvaluation;
  onSelectStep: (step: PipelineStepState) => void;
}

export function TopHorizontalStepper({
  evaluation,
  onSelectStep,
}: TopHorizontalStepperProps) {
  const [shakingId, setShakingId] = useState<PipelineStepId | null>(null);

  const handleClick = (step: PipelineStepState) => {
    if (!step.unlocked) {
      setShakingId(step.id);
      window.setTimeout(() => setShakingId(null), 380);
    }
    onSelectStep(step);
  };

  return (
    <div className="bg-[#0E0F14] border-b border-[#262933] px-4 lg:px-6 py-3 shrink-0">
      <div className="max-w-7xl mx-auto space-y-2.5">
        {/* Progress Header Line */}
        <div className="flex items-center justify-between gap-4 text-[11px]">
          <div className="flex items-center gap-2 text-[#989CA8] min-w-0">
            {evaluation.currentStep ? (
              <>
                <span className="font-mono tabular-nums text-[#E5A03A] font-medium whitespace-nowrap shrink-0">
                  Step {evaluation.currentStep.stepNumber} of {evaluation.steps.length}
                </span>
                <span aria-hidden="true" className="text-[#262933]">
                  ·
                </span>
                <span className="text-[#F3F4F6] font-medium truncate">
                  {evaluation.currentStep.label}
                </span>
                <span aria-hidden="true" className="hidden md:inline text-[#262933]">
                  —
                </span>
                <span className="hidden md:inline text-[#6B7280] truncate">
                  {evaluation.currentStep.subtitle}
                </span>
              </>
            ) : (
              <span className="text-[#989CA8]">Production Pipeline Overview</span>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono tabular-nums text-[#989CA8] whitespace-nowrap shrink-0">
            <span>
              {evaluation.completedCount}/{evaluation.steps.length} approved
            </span>
            <span aria-hidden="true" className="text-[#262933]">
              ·
            </span>
            <span className="text-[#E5A03A]">{evaluation.progressPercent}%</span>
          </div>
        </div>

        {/* Continuous Stepper Progress Track + 7 Numbered Steps */}
        <div className="relative overflow-x-auto pb-1">
          <div className="min-w-[680px]">
            {/* Background & Active Progress Bar Line */}
            <div className="h-[2px] w-full bg-[#1E2029] rounded-full overflow-hidden mb-2.5">
              <motion.div
                className="h-full bg-gradient-to-r from-[#34D399] via-[#E5A03A] to-[#F3C06B] origin-left"
                initial={false}
                animate={{
                  scaleX: Math.max(
                    0.04,
                    evaluation.currentStep
                      ? Math.max(
                          evaluation.completedCount / evaluation.steps.length,
                          (evaluation.currentStep.stepNumber - 0.35) / evaluation.steps.length
                        )
                      : evaluation.completedCount / evaluation.steps.length
                  ),
                }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>

            {/* 7 Step Buttons */}
            <div className="grid grid-cols-7 gap-1.5">
              {evaluation.steps.map((step) => {
                const isShaking = shakingId === step.id;
                return (
                  <motion.button
                    key={step.id}
                    type="button"
                    onClick={() => handleClick(step)}
                    animate={isShaking ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
                    transition={{ duration: 0.32 }}
                    title={step.lockReason || `${step.stepNumber}. ${step.label}`}
                    aria-current={step.isCurrent ? 'step' : undefined}
                    aria-disabled={!step.unlocked}
                    className={`relative group flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors overflow-hidden ${
                      step.isCurrent
                        ? 'bg-[#1A1C24] border-[#E5A03A]/70 text-[#F3F4F6]'
                        : step.completed
                        ? 'bg-[#12141B] border-[#262933] hover:border-[#34D399]/50 text-[#E5E7EB]'
                        : step.unlocked
                        ? 'bg-[#12141B] border-[#262933] hover:border-[#E5A03A]/50 text-[#D1D5DB]'
                        : 'bg-[#0B0B0D]/60 border-[#1C1E26] text-[#6B7280] cursor-not-allowed'
                    }`}
                  >
                    {/* Animated shimmer underline on the actively processing step */}
                    {step.isBusy && (
                      <motion.div
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-[2px] bg-[#E5A03A]/30 overflow-hidden"
                      >
                        <motion.div
                          className="h-full w-1/2 bg-[#E5A03A]"
                          initial={{ x: '-100%' }}
                          animate={{ x: '220%' }}
                          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                        />
                      </motion.div>
                    )}

                    {/* Node Indicator */}
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-mono text-[10px] tabular-nums transition-colors ${
                        step.isBusy
                          ? 'bg-[#E5A03A]/20 border border-[#E5A03A] text-[#E5A03A]'
                          : step.isCurrent
                          ? 'bg-[#E5A03A] text-[#0B0B0D] font-bold'
                          : step.completed
                          ? 'bg-[#34D399]/15 border border-[#34D399]/60 text-[#34D399]'
                          : step.unlocked
                          ? 'bg-[#1D1F28] border border-[#3A3F50] text-[#D1D5DB]'
                          : 'bg-[#121319] border border-[#262933] text-[#4B5563]'
                      }`}
                    >
                      {step.isBusy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : step.completed && !step.isCurrent ? (
                        <Check className="w-3 h-3" />
                      ) : !step.unlocked ? (
                        <Lock className="w-2.5 h-2.5" />
                      ) : (
                        step.stepNumber
                      )}
                    </div>

                    {/* Label */}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium leading-tight truncate whitespace-nowrap">
                        {step.shortLabel}
                      </div>
                      <div className="text-[10px] leading-tight truncate text-[#6B7280] mt-0.5">
                        {step.isBusy
                          ? 'Working...'
                          : step.isCurrent
                          ? 'Current'
                          : step.completed
                          ? 'Approved'
                          : step.unlocked
                          ? 'Ready'
                          : 'Locked'}
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GuidedStepFooterProps {
  evaluation: PipelineEvaluation;
  advancing: boolean;
  onGoPrevious: () => void;
  onApproveAndContinue: () => void;
}

export function GuidedStepFooter({
  evaluation,
  advancing,
  onGoPrevious,
  onApproveAndContinue,
}: GuidedStepFooterProps) {
  const { currentStep, previousStep, nextStep, canApproveOrAdvance, advanceButtonLabel, footerHint } =
    evaluation;

  if (!currentStep) return null;

  return (
    <footer className="sticky bottom-0 z-20 bg-[#0E0F14]/95 backdrop-blur-md border-t border-[#262933] px-4 lg:px-8 py-3 shrink-0">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Previous Step */}
        <div className="flex items-center gap-3 shrink-0">
          {previousStep ? (
            <button
              type="button"
              onClick={onGoPrevious}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#262933] hover:border-[#3A3F50] bg-[#16171D] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              Step {previousStep.stepNumber}: {previousStep.shortLabel}
            </button>
          ) : (
            <div className="font-mono tabular-nums text-[11px] text-[#6B7280] whitespace-nowrap">
              Step 01 of 07
            </div>
          )}
        </div>

        {/* Center: Current Step Guidance / Active Status */}
        <div className="flex items-center gap-2 text-xs text-[#989CA8] min-w-0 sm:justify-center flex-1">
          {currentStep.isBusy && (
            <Loader2 className="w-3.5 h-3.5 text-[#E5A03A] animate-spin shrink-0" />
          )}
          <span className="truncate">{footerHint}</span>
        </div>

        {/* Right: Primary Approve & Continue Action */}
        {nextStep && (
          <div className="flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={onApproveAndContinue}
              disabled={!canApproveOrAdvance || advancing || currentStep.isBusy}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                canApproveOrAdvance && !advancing && !currentStep.isBusy
                  ? 'bg-[#E5A03A] hover:bg-[#EEB255] text-[#0B0B0D]'
                  : 'bg-[#1A1C24] border border-[#262933] text-[#6B7280] cursor-not-allowed'
              }`}
            >
              {advancing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : !canApproveOrAdvance ? (
                <Lock className="w-3.5 h-3.5 shrink-0" />
              ) : null}
              <span>{advanceButtonLabel}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
