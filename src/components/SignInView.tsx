import React, { useState } from 'react';
import { ArrowRight, Film, Loader2 } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { STUDIO_BACKDROPS } from '../types/cineforge';

export function SignInView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || 'Sign-in was cancelled or failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0D] text-[#F4F4F6] flex flex-col">
      <header className="h-16 px-8 border-b border-[#262933] flex items-center justify-between gap-8">
        <span className="font-display text-xl font-semibold tracking-tight text-[#F4F4F6] whitespace-nowrap shrink-0">
          CineForge
        </span>
        <div className="hidden md:flex items-center gap-6 text-xs text-[#989CA8]">
          <span>Voice First</span>
          <span aria-hidden="true">·</span>
          <span>Authentic Archives</span>
          <span aria-hidden="true">·</span>
          <span>Continuous Spatial Cinema</span>
        </div>
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <div className="lg:col-span-5 flex flex-col justify-center space-y-7">
          <div className="space-y-4">
            <p className="text-xs font-medium text-[#E5A03A] tracking-wide">
              Autonomous Documentary Production Suite
            </p>
            <h1 className="font-display text-4xl xl:text-5xl font-semibold tracking-tight text-[#F4F4F6] leading-[1.12]">
              From a single topic to a mastered documentary film.
            </h1>
            <p className="text-[15px] text-[#989CA8] leading-relaxed max-w-md">
              Research verified archives across Wikimedia Commons, the Library of Congress, and NASA.
              Direct human-grade neural voiceovers, synchronize every camera glide to the spoken word,
              and export verified broadcast MP4 deliverables.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={handleSignIn}
              disabled={loading}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3 text-sm font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              Continue with Google Account
            </button>
            {error && (
              <p className="text-xs text-[#EF4444] pt-1">{error}</p>
            )}
          </div>

          <div className="pt-6 border-t border-[#262933] grid grid-cols-3 gap-6">
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-[#F4F4F6]">10</div>
              <div className="text-xs text-[#989CA8] mt-0.5">Production Workspaces</div>
            </div>
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-[#F4F4F6]">3 Archives</div>
              <div className="text-xs text-[#989CA8] mt-0.5">Verified Public Photos</div>
            </div>
            <div>
              <div className="font-mono-tabular text-lg font-semibold text-[#F4F4F6]">H.264 MP4</div>
              <div className="text-xs text-[#989CA8] mt-0.5">FFmpeg Verified Export</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col justify-center gap-4">
          <div className="rounded-xl overflow-hidden border border-[#262933] bg-[#16171D]">
            <div className="px-4 py-3 border-b border-[#262933] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-[#E5A03A] shrink-0" />
                <span className="text-xs font-semibold text-[#F4F4F6]">
                  Rendered Sample Film · The Great Emu War (1932)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono-tabular text-[#989CA8]">
                <span>1280×720 · 30 FPS · 27.8s</span>
                <a
                  href="/demo/emu_war_demo.mp4"
                  download="CineForge_Great_Emu_War_1932.mp4"
                  className="text-[#E5A03A] hover:underline font-sans font-medium"
                >
                  Download MP4
                </a>
              </div>
            </div>
            <div className="bg-black aspect-video">
              <video
                src="/demo/emu_war_demo.mp4"
                poster={STUDIO_BACKDROPS.editSuite}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-[#111218]">
              <p className="text-xs text-[#989CA8]">
                Style: Historically · Animated Australia map, 1932 Wikimedia archival cutouts, kinetic captions & auto-ducked score
              </p>
              <span className="text-[11px] font-mono-tabular text-[#22C55E]">H.264 / AAC 48kHz · 3.35 MB</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
