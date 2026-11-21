import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Eye,
  Film,
  Layers,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
} from 'lucide-react';
import { authedMediaUrl } from '../lib/apiClient';
import { updateBeatDoc } from '../lib/firestoreStore';
import { getActiveBeatAtTime, renderWorldFrame } from '../lib/motionWorldEngine';
import { DocumentarySoundEngine } from '../lib/soundDesignEngine';
import { formatTimecode } from '../lib/timecode';
import { preloadBeatImages, preloadBeatVideos } from '../lib/videoExportEngine';
import { MAP_REGIONS } from '../lib/worldMapData';
import {
  VIDEO_STYLE_PRESETS,
  type ArchivalAsset,
  type AudioMixerSettings,
  type BeatSceneType,
  type CameraMotionType,
  type MapRegionId,
  type NarrationSegment,
  type Project,
  type SfxCueType,
  type StoryboardBeat,
  type VideoStylePresetId,
  type WorldEnvironment,
} from '../types/cineforge';

interface MotionStudioViewProps {
  project: Project;
  beats: StoryboardBeat[];
  segments: NarrationSegment[];
  assets: ArchivalAsset[];
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onNavigateRender: () => void;
}

export function MotionStudioView({
  project,
  beats,
  segments,
  assets,
  onUpdateProject,
  onNavigateRender,
}: MotionStudioViewProps) {
  const sortedBeats = useMemo(
    () => [...beats].sort((a, b) => a.orderIndex - b.orderIndex),
    [beats]
  );
  const usableAssets = useMemo(
    () =>
      assets.filter(
        (a) =>
          a.approvalStatus !== 'rejected' &&
          a.downloadStatus === 'ready' &&
          (Boolean(a.imageUrl) || (a.category === 'animated_rig' && Boolean(a.animatedRigSpec)))
      ),
    [assets]
  );

  const totalDurationMs = useMemo(() => {
    const lastBeat = sortedBeats.length > 0 ? Math.max(...sortedBeats.map((b) => b.endMs)) : 0;
    return Math.max(4000, project.masterAudio?.durationMs || lastBeat || 15000);
  }, [project.masterAudio?.durationMs, sortedBeats]);

  const defaultMixer: AudioMixerSettings = project.audioMixer || {
    voiceVolume: 1.0,
    musicVolume: 0.24,
    sfxVolume: 0.45,
    autoDucking: true,
    duckingDepthDb: 11,
    ambientBed: 'obsidian_drone',
  };

  const [mixer, setMixer] = useState<AudioMixerSettings>(defaultMixer);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [showSafeGuides, setShowSafeGuides] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'beat' | 'audio'>('beat');
  const [masterAudioUrl, setMasterAudioUrl] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const deskTextureRef = useRef<HTMLImageElement | null>(null);
  const soundEngineRef = useRef<DocumentarySoundEngine | null>(null);
  const lastTriggeredBeatRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartWallRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);

  useEffect(() => {
    soundEngineRef.current = new DocumentarySoundEngine();
    return () => {
      soundEngineRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (project.masterAudio?.audioUrl) {
      authedMediaUrl(project.masterAudio.audioUrl).then(setMasterAudioUrl).catch(() => {});
    }
  }, [project.masterAudio?.audioUrl]);

  // Preload all archival beat images & public video clips via CORS-safe proxy
  useEffect(() => {
    let active = true;
    Promise.all([preloadBeatImages(sortedBeats), preloadBeatVideos(sortedBeats)]).then(
      ([{ images, deskTexture }, videos]) => {
        if (!active) return;
        imagesRef.current = images;
        videosRef.current = videos;
        deskTextureRef.current = deskTexture;
        drawCanvasAt(currentTimeMs);
      }
    );
    return () => {
      active = false;
    };
  }, [sortedBeats]);

  const activeAtPlayhead = useMemo(
    () => getActiveBeatAtTime(sortedBeats, currentTimeMs),
    [sortedBeats, currentTimeMs]
  );

  const selectedBeat = useMemo(
    () =>
      sortedBeats.find((b) => b.id === selectedBeatId) ||
      activeAtPlayhead.beat ||
      sortedBeats[0] ||
      null,
    [sortedBeats, selectedBeatId, activeAtPlayhead.beat]
  );

  const drawCanvasAt = (timeMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { beat } = getActiveBeatAtTime(sortedBeats, timeMs);
    if (beat?.sceneType === 'archival_video' && beat.heroVideoUrl) {
      const vid = videosRef.current.get(beat.heroVideoUrl);
      if (vid && vid.readyState >= 2) {
        const dur = Number.isFinite(vid.duration) && vid.duration > 0.2 ? vid.duration : 10;
        const targetSec =
          ((beat.videoStartOffsetSec || 0) + Math.max(0, timeMs - beat.startMs) / 1000) % dur;
        if (Math.abs(vid.currentTime - targetSec) > 0.12) {
          try {
            vid.currentTime = targetSec;
          } catch {
            // ignore transient seek errors
          }
        }
      }
    }

    renderWorldFrame(ctx, timeMs, {
      width: canvas.width,
      height: canvas.height,
      worldEnvironment: project.worldEnvironment || 'desk',
      videoStylePreset: project.videoStylePreset || 'historically',
      projectTitle: project.title,
      visualDirection: project.visualDirection,
      beats: sortedBeats,
      images: imagesRef.current,
      videos: videosRef.current,
      deskTexture: deskTextureRef.current,
      totalDurationMs,
      showSafeGuides,
    });
  };

  useEffect(() => {
    drawCanvasAt(currentTimeMs);
  }, [currentTimeMs, sortedBeats, project.worldEnvironment, project.videoStylePreset, showSafeGuides]);

  // Real-time synced animation loop driven by approved narration audio (or wall clock if visual-only)
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      soundEngineRef.current?.stopAmbientBed();
      return;
    }

    const audio = audioRef.current;
    soundEngineRef.current?.startAmbientBed(mixer, true);
    if (audio && masterAudioUrl) {
      audio.volume = mixer.voiceVolume;
      audio.currentTime = currentTimeMs / 1000;
      audio.play().catch(() => {});
    } else {
      playStartWallRef.current = performance.now();
      playStartOffsetRef.current = currentTimeMs;
    }

    const tick = () => {
      let nextMs: number;
      if (audio && masterAudioUrl && !audio.paused) {
        nextMs = Math.round(audio.currentTime * 1000);
      } else {
        nextMs = playStartOffsetRef.current + (performance.now() - playStartWallRef.current);
      }

      if (nextMs >= totalDurationMs) {
        setCurrentTimeMs(totalDurationMs);
        setIsPlaying(false);
        audio?.pause();
        soundEngineRef.current?.stopAmbientBed();
        return;
      }

      // Trigger foley SFX precisely when entering a new beat
      const { beat } = getActiveBeatAtTime(sortedBeats, nextMs);
      if (beat && beat.id !== lastTriggeredBeatRef.current) {
        lastTriggeredBeatRef.current = beat.id;
        if (beat.sfxCue && beat.sfxCue !== 'none') {
          soundEngineRef.current?.triggerSfx(beat.sfxCue, mixer.sfxVolume);
        }
      }

      setCurrentTimeMs(nextMs);
      drawCanvasAt(nextMs);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audio?.pause();
      soundEngineRef.current?.stopAmbientBed();
    };
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = mixer.voiceVolume;
    }
    soundEngineRef.current?.updateMix(mixer, isPlaying);
  }, [mixer, isPlaying]);

  const scrubTo = (ms: number) => {
    const clamped = Math.max(0, Math.min(totalDurationMs, Math.round(ms)));
    setCurrentTimeMs(clamped);
    if (audioRef.current && masterAudioUrl) {
      audioRef.current.currentTime = clamped / 1000;
    }
    playStartOffsetRef.current = clamped;
    playStartWallRef.current = performance.now();
  };

  const jumpBeat = (delta: -1 | 1) => {
    if (sortedBeats.length === 0) return;
    const nextIdx = Math.max(0, Math.min(sortedBeats.length - 1, activeAtPlayhead.index + delta));
    const b = sortedBeats[nextIdx];
    setSelectedBeatId(b.id);
    scrubTo(b.startMs);
  };

  const saveMixer = async (next: AudioMixerSettings) => {
    setMixer(next);
    await onUpdateProject({ audioMixer: next });
  };

  const peaks = project.masterAudio?.waveformPeaks || [];

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      {masterAudioUrl && (
        <audio
          ref={audioRef}
          src={masterAudioUrl}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}

      {/* Top Studio Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[#E5A03A] font-medium">
            Step 06 of 07 · Continuous Visual World · Voice-Synchronized Camera & Sound Design
          </p>
          <h1 className="font-display text-2xl font-semibold text-[#F4F4F6]">Motion Studio</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={project.videoStylePreset || 'historically'}
            onChange={(e) => {
              const id = e.target.value as VideoStylePresetId;
              const info = VIDEO_STYLE_PRESETS[id];
              const nextMixer: AudioMixerSettings = {
                ...mixer,
                ambientBed: info.defaultAmbientBed,
              };
              setMixer(nextMixer);
              onUpdateProject({
                videoStylePreset: id,
                worldEnvironment: info.defaultWorld,
                audioMixer: nextMixer,
              });
            }}
            className="bg-[#16171D] border border-[#E5A03A]/50 rounded-lg px-3 py-1.5 text-xs text-[#F4F4F6]"
            title="Visual Storytelling Style Preset"
          >
            {(Object.keys(VIDEO_STYLE_PRESETS) as VideoStylePresetId[]).map((id) => (
              <option key={id} value={id}>
                Style: {VIDEO_STYLE_PRESETS[id].label}
              </option>
            ))}
          </select>

          <select
            value={project.worldEnvironment || 'desk'}
            onChange={(e) => onUpdateProject({ worldEnvironment: e.target.value as WorldEnvironment })}
            className="bg-[#16171D] border border-[#262933] rounded-lg px-3 py-1.5 text-xs text-[#F4F4F6]"
            title="Continuous world environment"
          >
            <option value="desk">World: Physical Desk</option>
            <option value="map">World: Geographical Map</option>
            <option value="board">World: Investigation Board</option>
            <option value="archive">World: Document Archive</option>
          </select>

          <button
            onClick={() => setShowSafeGuides((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap shrink-0 ${
              showSafeGuides
                ? 'border-[#E5A03A] text-[#E5A03A] bg-[#E5A03A]/10'
                : 'border-[#262933] text-[#989CA8] bg-[#16171D]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Safe Guides
          </button>

          <button
            onClick={onNavigateRender}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] whitespace-nowrap shrink-0"
          >
            <Film className="w-3.5 h-3.5" />
            Render Master MP4
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Viewport + Direct Inspector Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Program Monitor (8 cols) */}
        <div className="xl:col-span-8 bg-[#16171D] border border-[#262933] rounded-xl overflow-hidden flex flex-col">
          <div className="relative bg-[#050507] aspect-video w-full flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Transport Bar */}
          <div className="px-4 py-3 border-t border-[#262933] bg-[#101115] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => jumpBeat(-1)}
                className="p-2 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded-md"
                title="Previous beat"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (currentTimeMs >= totalDurationMs - 100) scrubTo(0);
                  setIsPlaying((p) => !p);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] whitespace-nowrap shrink-0"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isPlaying ? 'Pause' : 'Play Cut'}
              </button>
              <button
                onClick={() => jumpBeat(1)}
                className="p-2 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded-md"
                title="Next beat"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            <div className="font-mono-tabular text-xs text-[#F4F4F6] flex items-center gap-2">
              <span className="text-[#E5A03A]">
                {formatTimecode(currentTimeMs, project.frameRate || 30)}
              </span>
              <span className="text-[#6B7080]">/</span>
              <span className="text-[#989CA8]">
                {formatTimecode(totalDurationMs, project.frameRate || 30)}
              </span>
            </div>

            <div className="text-xs text-[#989CA8] truncate max-w-xs">
              {activeAtPlayhead.beat
                ? `Beat ${activeAtPlayhead.index + 1}: ${activeAtPlayhead.beat.heroAssetTitle || 'Title'}`
                : 'No beats loaded'}
            </div>
          </div>
        </div>

        {/* Right Direct Inspector (4 cols) */}
        <div className="xl:col-span-4 bg-[#16171D] border border-[#262933] rounded-xl flex flex-col overflow-hidden">
          <div className="flex border-b border-[#262933] bg-[#101115]">
            <button
              onClick={() => setInspectorTab('beat')}
              className={`flex-1 py-3 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                inspectorTab === 'beat'
                  ? 'text-[#E5A03A] border-b-2 border-[#E5A03A]'
                  : 'text-[#989CA8] hover:text-[#F4F4F6]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Camera & Object Inspector
            </button>
            <button
              onClick={() => setInspectorTab('audio')}
              className={`flex-1 py-3 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
                inspectorTab === 'audio'
                  ? 'text-[#E5A03A] border-b-2 border-[#E5A03A]'
                  : 'text-[#989CA8] hover:text-[#F4F4F6]'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              Sound Design & Mix
            </button>
          </div>

          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {inspectorTab === 'beat' ? (
              selectedBeat ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#F4F4F6]">
                      Beat {selectedBeat.orderIndex + 1} Properties
                    </span>
                    <button
                      onClick={() => scrubTo(selectedBeat.startMs)}
                      className="text-[11px] text-[#E5A03A] hover:underline"
                    >
                      Cue Playhead
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#989CA8] mb-1">Hero Photograph / Animated Rig</label>
                    <select
                      value={selectedBeat.heroAssetId || ''}
                      onChange={(e) => {
                        const a = usableAssets.find((x) => x.id === e.target.value);
                        if (a?.category === 'animated_rig' && a.animatedRigSpec) {
                          updateBeatDoc(project.id, selectedBeat.id, {
                            heroAssetId: a.id,
                            heroAssetUrl: '',
                            heroAssetTitle: a.title,
                            sceneType: 'animated_rig',
                            objectType: 'animated_rig',
                            animatedRigSpec: a.animatedRigSpec,
                          });
                        } else {
                          updateBeatDoc(project.id, selectedBeat.id, {
                            heroAssetId: a?.id || '',
                            heroAssetUrl: a?.imageUrl || '',
                            heroAssetTitle: a?.title || 'Editorial Title Frame',
                          });
                        }
                      }}
                      className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6]"
                    >
                      <option value="">Editorial Title Folio</option>
                      {usableAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.category === 'animated_rig' ? '[Animated Rig] ' : ''}
                          {a.title.slice(0, 44)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">Camera Move</label>
                      <select
                        value={selectedBeat.cameraMotion}
                        onChange={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            cameraMotion: e.target.value as CameraMotionType,
                          })
                        }
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2 py-1.5 text-xs text-[#F4F4F6]"
                      >
                        <option value="push_in">Push-In</option>
                        <option value="pull_back">Pull-Back</option>
                        <option value="pan_left">Pan Left</option>
                        <option value="pan_right">Pan Right</option>
                        <option value="orbit_drift">Orbit Drift</option>
                        <option value="focus_hold">Focus Hold</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">Scene Visual Type</label>
                      <select
                        value={selectedBeat.sceneType || 'illustrated_scene'}
                        onChange={(e) => {
                          const st = e.target.value as BeatSceneType;
                          updateBeatDoc(project.id, selectedBeat.id, {
                            sceneType: st,
                            objectType:
                              st === 'animated_rig'
                                ? 'animated_rig'
                                : st === 'archival_video'
                                ? 'video_clip'
                                : st === 'animated_map'
                                ? 'map'
                                : st === 'layered_cutout'
                                ? 'cutout'
                                : st === 'diagram_callout'
                                ? 'diagram'
                                : st === 'kinetic_title'
                                ? 'title_card'
                                : st === 'illustrated_scene'
                                ? 'illustration'
                                : 'photo',
                          });
                        }}
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2 py-1.5 text-xs text-[#F4F4F6]"
                      >
                        <option value="animated_rig">Animated Vector Rig</option>
                        <option value="archival_video">Public Archival Video Clip</option>
                        <option value="illustrated_scene">Illustrated Scene</option>
                        <option value="animated_map">Animated Map</option>
                        <option value="layered_cutout">Layered Cutout</option>
                        <option value="diagram_callout">Diagram & Callouts</option>
                        <option value="archival_photo">Archival Photo</option>
                        <option value="kinetic_title">Kinetic Title</option>
                      </select>
                    </div>
                  </div>

                  {selectedBeat.sceneType === 'animated_map' && (
                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">Animated Map Region</label>
                      <select
                        value={selectedBeat.mapSpec?.region || 'world'}
                        onChange={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            mapSpec: {
                              ...(selectedBeat.mapSpec || { markers: [], routes: [], territories: [] }),
                              region: e.target.value as MapRegionId,
                            },
                          })
                        }
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6]"
                      >
                        {(Object.keys(MAP_REGIONS) as MapRegionId[]).map((rId) => (
                          <option key={rId} value={rId}>
                            {MAP_REGIONS[rId].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">On-Screen Stamp</label>
                      <input
                        key={`${selectedBeat.id}-text`}
                        defaultValue={selectedBeat.onScreenText || ''}
                        onBlur={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            onScreenText: e.target.value.slice(0, 120),
                          })
                        }
                        placeholder="0–4 words"
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">Date Ticker</label>
                      <input
                        key={`${selectedBeat.id}-date`}
                        defaultValue={selectedBeat.dateBadge || ''}
                        onBlur={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            dateBadge: e.target.value.slice(0, 40),
                          })
                        }
                        placeholder="e.g., 1846"
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs font-mono-tabular text-[#F4F4F6]"
                      />
                    </div>
                  </div>

                  {/* Direct Spatial Transform Sliders */}
                  <div className="space-y-3 pt-2 border-t border-[#262933]">
                    <div>
                      <div className="flex justify-between text-[11px] text-[#989CA8]">
                        <span>Camera Zoom</span>
                        <span className="font-mono-tabular">{selectedBeat.cameraZoom.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min={0.85}
                        max={1.45}
                        step={0.02}
                        value={selectedBeat.cameraZoom}
                        onChange={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            cameraZoom: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#E5A03A]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-[#989CA8]">
                        <span>Object Rotation</span>
                        <span className="font-mono-tabular">{selectedBeat.worldRotation.toFixed(1)}°</span>
                      </div>
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={0.5}
                        value={selectedBeat.worldRotation}
                        onChange={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            worldRotation: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#E5A03A]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-[#989CA8]">
                        <span>Object Scale</span>
                        <span className="font-mono-tabular">{selectedBeat.worldScale.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.7}
                        max={1.35}
                        step={0.05}
                        value={selectedBeat.worldScale}
                        onChange={(e) =>
                          updateBeatDoc(project.id, selectedBeat.id, {
                            worldScale: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[#E5A03A]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-[#989CA8] mb-1">Transition Sound Effect</label>
                      <select
                        value={selectedBeat.sfxCue}
                        onChange={(e) => {
                          const cue = e.target.value as SfxCueType;
                          updateBeatDoc(project.id, selectedBeat.id, { sfxCue: cue });
                          soundEngineRef.current?.triggerSfx(cue, mixer.sfxVolume);
                        }}
                        className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-1.5 text-xs text-[#F4F4F6]"
                      >
                        <option value="none">None</option>
                        <option value="whoosh">Whoosh Transition</option>
                        <option value="pop_in">Pop-In Callout</option>
                        <option value="stamp_hit">Stamp Impact</option>
                        <option value="map_ping">Map Radar Ping</option>
                        <option value="chalk_draw">Sketch / Chalk Draw</option>
                        <option value="paper_slide">Paper Slide</option>
                        <option value="document_land">Document Land</option>
                        <option value="soft_impact">Soft Impact</option>
                        <option value="map_pin">Map Pin</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-[#989CA8]">
                  Generate your Storyboard first to inspect and refine individual motion beats.
                </p>
              )
            ) : (
              /* Sound Design & Auto-Ducking Mixer */
              <div className="space-y-5">
                <div>
                  <label className="block text-[11px] text-[#989CA8] mb-1.5">Style-Matched Musical Score Bed</label>
                  <select
                    value={mixer.ambientBed}
                    onChange={(e) =>
                      saveMixer({ ...mixer, ambientBed: e.target.value as AudioMixerSettings['ambientBed'] })
                    }
                    className="w-full bg-[#0B0B0D] border border-[#262933] rounded px-2.5 py-2 text-xs text-[#F4F4F6]"
                  >
                    <option value="historically_upbeat">Historically Upbeat Groove</option>
                    <option value="ted_ed_marimba">TED-Ed Curious Marimba Pulse</option>
                    <option value="simple_history_march">Simple History Historical March</option>
                    <option value="maps_cartography_pulse">History on Maps Cartography Pulse</option>
                    <option value="minute_earth_plucky">MinuteEarth Plucky Sketchbook</option>
                    <option value="obsidian_drone">Obsidian Cinema Drone</option>
                    <option value="investigative_pulse">Investigative Low Pulse</option>
                    <option value="historical_strings">Historical Warm Fifths</option>
                    <option value="archive_room_tone">Quiet Archive Room Tone</option>
                    <option value="none">No Music Bed (Voice Only)</option>
                  </select>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-[#D4D6DC]">
                      <span className="inline-flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-[#E5A03A]" />
                        Master Narration (Dominant)
                      </span>
                      <span className="font-mono-tabular">{Math.round(mixer.voiceVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1}
                      step={0.05}
                      value={mixer.voiceVolume}
                      onChange={(e) => saveMixer({ ...mixer, voiceVolume: Number(e.target.value) })}
                      className="w-full accent-[#E5A03A]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[#D4D6DC]">
                      <span>Background Music Level</span>
                      <span className="font-mono-tabular">{Math.round(mixer.musicVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.65}
                      step={0.02}
                      value={mixer.musicVolume}
                      onChange={(e) => saveMixer({ ...mixer, musicVolume: Number(e.target.value) })}
                      className="w-full accent-[#E5A03A]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[#D4D6DC]">
                      <span>Foley & Paper SFX Level</span>
                      <span className="font-mono-tabular">{Math.round(mixer.sfxVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={mixer.sfxVolume}
                      onChange={(e) => saveMixer({ ...mixer, sfxVolume: Number(e.target.value) })}
                      className="w-full accent-[#E5A03A]"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between p-3 rounded-lg bg-[#0B0B0D] border border-[#262933] text-xs cursor-pointer">
                  <div>
                    <div className="text-[#F4F4F6] font-medium">Automatic Narration Ducking</div>
                    <div className="text-[11px] text-[#989CA8]">
                      Automatically lowers ambient score by {mixer.duckingDepthDb} dB during speech
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={mixer.autoDucking}
                    onChange={(e) => saveMixer({ ...mixer, autoDucking: e.target.checked })}
                    className="accent-[#E5A03A] w-4 h-4"
                  />
                </label>

                <div className="pt-2 border-t border-[#262933]">
                  <div className="text-[11px] text-[#989CA8] mb-2">Audition Transition & Foley SFX</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        'whoosh',
                        'pop_in',
                        'stamp_hit',
                        'map_ping',
                        'chalk_draw',
                        'paper_slide',
                        'document_land',
                        'soft_impact',
                      ] as const
                    ).map((cue) => (
                      <button
                        key={cue}
                        onClick={() => soundEngineRef.current?.triggerSfx(cue, mixer.sfxVolume)}
                        className="px-2.5 py-1.5 text-[11px] bg-[#0B0B0D] border border-[#262933] hover:border-[#E5A03A] text-[#D4D6DC] rounded capitalize"
                      >
                        {cue.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Multi-Track Interactive NLE Timeline */}
      <section className="bg-[#16171D] border border-[#262933] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#262933] bg-[#101115] flex items-center justify-between text-xs text-[#989CA8]">
          <div className="flex items-center gap-2 font-medium text-[#F4F4F6]">
            <Layers className="w-3.5 h-3.5 text-[#E5A03A]" />
            Master Multi-Track Timeline
          </div>
          <span className="font-mono-tabular text-[11px]">
            Click anywhere on the timeline to scrub · {sortedBeats.length} visual beats · {segments.length} narration segments
          </span>
        </div>

        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const trackLeft = rect.left + 140;
            const trackWidth = Math.max(100, rect.width - 140);
            if (e.clientX >= trackLeft) {
              const frac = (e.clientX - trackLeft) / trackWidth;
              scrubTo(frac * totalDurationMs);
            }
          }}
          className="relative divide-y divide-[#262933] select-none cursor-pointer"
        >
          {/* Playhead line spanning all tracks */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#E5A03A] z-20 pointer-events-none"
            style={{
              left: `calc(140px + (100% - 140px) * ${Math.min(1, currentTimeMs / Math.max(1, totalDurationMs))})`,
            }}
          />

          {/* Track 1: Hero Visual Assets */}
          <div className="flex items-stretch h-12">
            <div className="w-[140px] shrink-0 px-3 flex items-center text-[11px] font-medium text-[#989CA8] bg-[#121319] border-r border-[#262933]">
              V1 · Hero Visuals
            </div>
            <div className="relative flex-1 bg-[#0B0B0D]">
              {sortedBeats.map((b) => {
                const left = (b.startMs / totalDurationMs) * 100;
                const width = Math.max(2, ((b.endMs - b.startMs) / totalDurationMs) * 100);
                const isSel = selectedBeat?.id === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBeatId(b.id);
                      scrubTo(b.startMs);
                    }}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className={`absolute top-1.5 bottom-1.5 rounded px-2 text-left text-[10px] truncate border transition-colors ${
                      isSel
                        ? 'bg-[#E5A03A]/25 border-[#E5A03A] text-[#F4F4F6]'
                        : 'bg-[#1E2028] border-[#323644] text-[#D4D6DC] hover:border-[#E5A03A]/60'
                    }`}
                  >
                    {b.orderIndex + 1}. {b.heroAssetTitle || b.objectType}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Track 2: Camera Path & Typography */}
          <div className="flex items-stretch h-9">
            <div className="w-[140px] shrink-0 px-3 flex items-center text-[11px] font-medium text-[#989CA8] bg-[#121319] border-r border-[#262933]">
              V2 · Camera / Type
            </div>
            <div className="relative flex-1 bg-[#0B0B0D]">
              {sortedBeats.map((b) => {
                const left = (b.startMs / totalDurationMs) * 100;
                const width = Math.max(2, ((b.endMs - b.startMs) / totalDurationMs) * 100);
                return (
                  <div
                    key={b.id}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="absolute top-1.5 bottom-1.5 rounded bg-[#16171D] border border-[#262933] px-1.5 flex items-center text-[10px] text-[#989CA8] truncate"
                  >
                    {b.cameraMotion.replace('_', ' ')} {b.onScreenText ? `· "${b.onScreenText}"` : ''}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Track 3: Master Narration Waveform */}
          <div className="flex items-stretch h-14">
            <div className="w-[140px] shrink-0 px-3 flex items-center text-[11px] font-medium text-[#E5A03A] bg-[#121319] border-r border-[#262933]">
              A1 · Voice Master
            </div>
            <div className="relative flex-1 bg-[#0B0B0D] px-1 flex items-center gap-[2px] overflow-hidden">
              {(peaks.length > 0 ? peaks : Array.from({ length: 120 }, () => 0.25)).map((amp, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[#E5A03A]/55 rounded-full"
                  style={{ height: `${Math.max(10, Math.round(amp * 82))}%` }}
                />
              ))}
            </div>
          </div>

          {/* Track 4: Ambient Music & SFX */}
          <div className="flex items-stretch h-9">
            <div className="w-[140px] shrink-0 px-3 flex items-center text-[11px] font-medium text-[#989CA8] bg-[#121319] border-r border-[#262933]">
              A2 · Music & SFX
            </div>
            <div className="relative flex-1 bg-[#0B0B0D] flex items-center">
              {mixer.ambientBed !== 'none' && (
                <div className="mx-1 w-full h-5 rounded bg-[#22C55E]/15 border border-[#22C55E]/30 px-2 flex items-center text-[10px] text-[#22C55E] truncate">
                  Ambient Bed: {mixer.ambientBed.replace(/_/g, ' ')} {mixer.autoDucking ? `(Auto-duck -${mixer.duckingDepthDb} dB)` : ''}
                </div>
              )}
              {sortedBeats
                .filter((b) => b.sfxCue !== 'none')
                .map((b) => (
                  <div
                    key={b.id}
                    style={{ left: `${(b.startMs / totalDurationMs) * 100}%` }}
                    className="absolute top-1 bottom-1 w-1.5 rounded-full bg-[#E5A03A]"
                    title={`SFX: ${b.sfxCue}`}
                  />
                ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
