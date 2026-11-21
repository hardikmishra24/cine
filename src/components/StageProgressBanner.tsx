import { Check, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

export interface StageSubStep {
  id: string;
  label: string;
  detail?: string;
}

interface StageProgressBannerProps {
  stepNumber: number;
  title: string;
  statusMessage?: string;
  subSteps: StageSubStep[];
  activeSubStepIndex: number;
  progressPercent?: number;
  onCancel?: () => void;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function StageProgressBanner({
  stepNumber,
  title,
  statusMessage,
  subSteps,
  activeSubStepIndex,
  progressPercent,
  onCancel,
}: StageProgressBannerProps) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    setElapsedSec(0);
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [title]);

  const computedPercent =
    typeof progressPercent === 'number'
      ? Math.max(4, Math.min(100, Math.round(progressPercent)))
      : Math.max(
          8,
          Math.min(
            96,
            Math.round(((activeSubStepIndex + 0.55) / Math.max(1, subSteps.length)) * 100)
          )
        );

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="bg-[#16171D] border border-[#E5A03A]/45 rounded-xl p-5 space-y-4 overflow-hidden"
      role="status"
      aria-live="polite"
    >
      {/* Top Row: Step Identity, Live Status, Percentage & Elapsed Timer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#E5A03A]/15 border border-[#E5A03A]/40 flex items-center justify-center shrink-0 mt-0.5">
            <Loader2 className="w-4 h-4 text-[#E5A03A] animate-spin" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#E5A03A] font-medium">
              <span className="font-mono tabular-nums">
                Step {String(stepNumber).padStart(2, '0')}
              </span>
              <span aria-hidden="true">·</span>
              <span>Processing</span>
            </div>
            <h3 className="text-sm font-semibold text-[#F3F4F6] mt-0.5 truncate">{title}</h3>
            {statusMessage && (
              <p className="text-xs text-[#989CA8] mt-0.5 leading-relaxed">{statusMessage}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono tabular-nums text-xs shrink-0 pl-11 sm:pl-0">
          <span className="text-[#E5A03A] font-semibold">{computedPercent}%</span>
          <span className="text-[#262933]" aria-hidden="true">
            ·
          </span>
          <span className="text-[#989CA8]">{formatElapsed(elapsedSec)}</span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#262933] bg-[#0B0B0D] text-[11px] font-sans font-medium text-[#989CA8] hover:text-[#F4F4F6] hover:border-[#EF4444]/60 transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Animated Progress Track with Traveling Shimmer */}
      <div className="relative h-2 w-full rounded-full bg-[#0B0B0D] border border-[#262933] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-[#C47E1E] via-[#E5A03A] to-[#F3C06B] origin-left relative overflow-hidden"
          initial={{ scaleX: 0.05 }}
          animate={{ scaleX: computedPercent / 100 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-0 w-28 bg-gradient-to-r from-transparent via-white/35 to-transparent"
            initial={{ x: '-120%' }}
            animate={{ x: '460%' }}
            transition={{
              repeat: Infinity,
              duration: 1.6,
              ease: 'linear',
            }}
          />
        </motion.div>
      </div>

      {/* Live Sub-Steps Checklist */}
      {subSteps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
          {subSteps.map((sub, idx) => {
            const isDone = idx < activeSubStepIndex;
            const isActive = idx === activeSubStepIndex;
            return (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0.6 }}
                animate={{ opacity: isDone || isActive ? 1 : 0.55 }}
                transition={{ duration: 0.2 }}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-[#1D1F28] border-[#E5A03A]/50'
                    : isDone
                    ? 'bg-[#0F1015] border-[#34D399]/30'
                    : 'bg-[#0B0B0D]/60 border-[#262933]/70'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <div className="w-4 h-4 rounded-full bg-[#34D399]/15 border border-[#34D399]/50 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-[#34D399]" />
                    </div>
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 text-[#E5A03A] animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-[#3A3F50] flex items-center justify-center font-mono text-[9px] text-[#6B7280] tabular-nums">
                      {idx + 1}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div
                    className={`text-xs font-medium leading-snug ${
                      isActive
                        ? 'text-[#F3F4F6]'
                        : isDone
                        ? 'text-[#D1D5DB]'
                        : 'text-[#6B7280]'
                    }`}
                  >
                    {sub.label}
                  </div>
                  {sub.detail && (
                    <div className="text-[11px] text-[#989CA8] mt-0.5 line-clamp-1">
                      {sub.detail}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
