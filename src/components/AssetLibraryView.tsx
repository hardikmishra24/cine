import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Search,
  Sparkles,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { apiFetch, authedVideoProxyUrl } from '../lib/apiClient';
import { batchApplyBeatFulfillment } from '../lib/firestoreStore';
import { isBeatVisuallyFulfilled } from '../lib/pipelineSteps';
import { formatTimecode } from '../lib/timecode';
import { MAP_REGIONS } from '../lib/worldMapData';
import {
  VIDEO_STYLE_PRESETS,
  type ArchivalAsset,
  type BeatSceneType,
  type NarrationSegment,
  type Project,
  type ScriptVersion,
  type StoryboardBeat,
  type VideoStylePresetId,
} from '../types/cineforge';
import { AnimatedRigCanvas } from './AnimatedRigCanvas';
import { AuthImage } from './AuthImage';
import { StageProgressBanner, type StageSubStep } from './StageProgressBanner';

interface AssetLibraryViewProps {
  project: Project;
  activeScript: ScriptVersion | null;
  assets: ArchivalAsset[];
  beats: StoryboardBeat[];
  segments: NarrationSegment[];
  onUpdateProject: (patch: Partial<Project>) => Promise<void>;
  onNavigateMotion: () => void;
  onToast: (msg: string) => void;
  onBusyChange?: (busy: boolean, message?: string) => void;
}

interface ArchiveSearchResultItem {
  title: string;
  description: string;
  sourceProvider: ArchivalAsset['sourceProvider'];
  sourceUrl: string;
  imageUrl: string;
  videoUrl?: string;
  thumbnailUrl: string;
  durationSec?: number;
  mediaKind?: 'image' | 'video' | 'animated_rig';
  creator: string;
  license: string;
  category: ArchivalAsset['category'];
}

interface FulfillStoryboardResponse {
  beatPatches: Array<{ beatId: string; patch: Partial<StoryboardBeat> }>;
  createdAssets: Array<
    Omit<ArchivalAsset, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'> & {
      tempId: string;
    }
  >;
  uniquenessReport: {
    totalBeats: number;
    fulfilledCount: number;
    uniqueAssetCount: number;
    duplicateCount: number;
    breakdown: {
      archivalVideo: number;
      animatedRig: number;
      archivalPhoto: number;
      animatedMap: number;
      kineticTitle: number;
    };
  };
}

interface FulfillSingleBeatResponse {
  patch: Partial<StoryboardBeat>;
  createdAsset?: Omit<
    ArchivalAsset,
    'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'
  > & { tempId: string };
  message: string;
}

const FULFILL_PHASES: StageSubStep[] = [
  { id: 'plan', label: 'Reading Shot Blueprint', detail: 'Matching each beat 1-to-1 to narration' },
  { id: 'archive', label: 'Fetching Unique Photos & Video', detail: 'Wikimedia Commons, LOC & NASA archives' },
  { id: 'rigs', label: 'Coding Flat-Vector Character Rigs', detail: 'Unique animated scenes for motion beats' },
  { id: 'dedup', label: 'Verifying Zero Duplicates', detail: 'Saving beat-matched visuals to project' },
];

type DeckFilter = 'all' | 'video' | 'rig' | 'photo' | 'map';
type SwapModalTab = 'photo' | 'video' | 'animated_rig' | 'upload_map';

function computeClientRigSignature(beat: StoryboardBeat): string {
  const spec = beat.animatedRigSpec;
  if (!spec) return '';
  const actorKinds = (spec.actors || []).map((a) => `${a.kind}:${a.action}:${a.count || 1}`).sort().join(',');
  return `${spec.backdrop}|${spec.weatherParticles || 'none'}|${actorKinds}`;
}

function ProxiedVideoPreview({
  videoUrl,
  posterUrl,
  title,
}: {
  videoUrl: string;
  posterUrl?: string;
  title?: string;
}) {
  const [resolvedVideo, setResolvedVideo] = useState('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let active = true;
    setErrored(false);
    authedVideoProxyUrl(videoUrl)
      .then((u) => {
        if (active) setResolvedVideo(u);
      })
      .catch(() => {
        if (active) setErrored(true);
      });
    return () => {
      active = false;
    };
  }, [videoUrl]);

  if (errored || !resolvedVideo) {
    return (
      <div className="w-full h-full bg-[#0B0B0D] flex items-center justify-center relative">
        {posterUrl ? (
          <AuthImage src={posterUrl} alt={title || 'Video clip'} className="w-full h-full object-cover opacity-80" />
        ) : (
          <Video className="w-7 h-7 text-[#E5A03A]/70" />
        )}
      </div>
    );
  }

  return (
    <video
      src={resolvedVideo}
      controls
      muted
      loop
      playsInline
      preload="metadata"
      crossOrigin="anonymous"
      onError={() => setErrored(true)}
      className="w-full h-full object-cover bg-black"
    />
  );
}

export function AssetLibraryView({
  project,
  assets,
  beats,
  onUpdateProject,
  onNavigateMotion,
  onToast,
  onBusyChange,
}: AssetLibraryViewProps) {
  const [fulfillingAll, setFulfillingAll] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [filter, setFilter] = useState<DeckFilter>('all');
  const [refreshingBeatId, setRefreshingBeatId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // Swap modal state
  const [swapBeat, setSwapBeat] = useState<StoryboardBeat | null>(null);
  const [swapTab, setSwapTab] = useState<SwapModalTab>('photo');
  const [swapQuery, setSwapQuery] = useState('');
  const [swapResults, setSwapResults] = useState<ArchiveSearchResultItem[]>([]);
  const [swapSearching, setSwapSearching] = useState(false);
  const [swapRigPrompt, setSwapRigPrompt] = useState('');
  const [swapApplying, setSwapApplying] = useState(false);

  const autoFulfillHashRef = useRef<string | null>(null);

  const sortedBeats = useMemo(
    () => [...beats].sort((a, b) => a.orderIndex - b.orderIndex),
    [beats]
  );

  const activePresetId: VideoStylePresetId = project.videoStylePreset || 'historically';

  const storyboardFingerprint = useMemo(
    () =>
      sortedBeats
        .map((b) => `${b.id}:${b.sceneType || ''}:${b.assetSearchQuery || ''}:${b.rigPrompt || ''}`)
        .join('|'),
    [sortedBeats]
  );

  const assetById = useMemo(() => {
    const m = new Map<string, ArchivalAsset>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const anyBusy = fulfillingAll || Boolean(refreshingBeatId) || swapApplying;

  useEffect(() => {
    onBusyChange?.(
      anyBusy,
      fulfillingAll
        ? 'Fulfilling every storyboard beat 1-to-1 with unique photos, video clips, rigs & maps...'
        : refreshingBeatId
        ? 'Swapping beat visual with a unique unused asset...'
        : undefined
    );
  }, [anyBusy, fulfillingAll, refreshingBeatId, onBusyChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  // Compute live uniqueness & breakdown counts across all beats
  const deckMetrics = useMemo(() => {
    let fulfilled = 0;
    let videoCount = 0;
    let rigCount = 0;
    let photoCount = 0;
    let mapTitleCount = 0;
    const seenUrls = new Set<string>();
    const seenRigs = new Set<string>();
    let duplicates = 0;

    for (const b of sortedBeats) {
      if (isBeatVisuallyFulfilled(b)) fulfilled++;
      const st = b.sceneType || 'archival_photo';
      if (st === 'archival_video') {
        videoCount++;
        if (b.heroVideoUrl) {
          if (seenUrls.has(b.heroVideoUrl)) duplicates++;
          else seenUrls.add(b.heroVideoUrl);
        }
      } else if (st === 'animated_rig') {
        rigCount++;
        const sig = computeClientRigSignature(b);
        if (sig) {
          if (seenRigs.has(sig)) duplicates++;
          else seenRigs.add(sig);
        }
      } else if (st === 'animated_map' || st === 'kinetic_title') {
        mapTitleCount++;
      } else {
        photoCount++;
        if (b.heroAssetUrl) {
          if (seenUrls.has(b.heroAssetUrl)) duplicates++;
          else seenUrls.add(b.heroAssetUrl);
        }
      }
    }

    return {
      total: sortedBeats.length,
      fulfilled,
      duplicates,
      videoCount,
      rigCount,
      photoCount,
      mapTitleCount,
    };
  }, [sortedBeats]);

  const handleFulfillAllBeats = async (forceRefreshAll = false) => {
    if (sortedBeats.length === 0) {
      onToast('Plan your Storyboard in Step 4 first before populating beat visuals.');
      return;
    }

    setFulfillingAll(true);
    setPhaseIdx(0);
    const t1 = window.setTimeout(() => setPhaseIdx(1), 1100);
    const t2 = window.setTimeout(() => setPhaseIdx(2), 3200);

    try {
      const lockedBeatIds = forceRefreshAll
        ? []
        : sortedBeats.filter((b) => isBeatVisuallyFulfilled(b)).map((b) => b.id);

      const res = await apiFetch<FulfillStoryboardResponse>('/api/assets/fulfill-storyboard', {
        method: 'POST',
        timeoutMs: 120000,
        body: JSON.stringify({
          projectId: project.id,
          topic: project.topic || project.title,
          researchSummary: project.researchSummary || '',
          stylePreset: activePresetId,
          beats: sortedBeats,
          lockedBeatIds,
        }),
      });

      setPhaseIdx(3);
      const oldAutoAssetIds = forceRefreshAll
        ? assets.filter((a) => Boolean(a.assignedBeatId)).map((a) => a.id)
        : [];

      await batchApplyBeatFulfillment(
        project.id,
        res.beatPatches,
        res.createdAssets,
        oldAutoAssetIds
      );

      const firstThumb =
        res.createdAssets.find((a) => a.thumbnailUrl || a.imageUrl)?.thumbnailUrl ||
        res.createdAssets.find((a) => a.imageUrl)?.imageUrl ||
        project.thumbnailUrl;

      await onUpdateProject({
        mediaFulfilledHash: storyboardFingerprint,
        ...(firstThumb && !project.thumbnailUrl ? { thumbnailUrl: firstThumb } : {}),
      });

      const rep = res.uniquenessReport;
      onToast(
        `Fulfilled ${rep.fulfilledCount}/${rep.totalBeats} beats 1-to-1 (${rep.duplicateCount} duplicates): ${rep.breakdown.archivalVideo} video, ${rep.breakdown.animatedRig} rigs, ${rep.breakdown.archivalPhoto} photos, ${rep.breakdown.animatedMap} maps.`
      );
    } catch (err: any) {
      onToast(err?.message || 'Failed to fulfill storyboard visuals.');
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setFulfillingAll(false);
    }
  };

  // Auto-fulfill all planned beats once when entering Step 5 if any beat is unfulfilled
  useEffect(() => {
    if (sortedBeats.length === 0 || fulfillingAll) return;
    const hasUnfulfilled = sortedBeats.some((b) => !isBeatVisuallyFulfilled(b));
    if (!hasUnfulfilled) return;
    const key = `${project.id}:${storyboardFingerprint}`;
    if (autoFulfillHashRef.current === key) return;
    if (project.mediaFulfilledHash === storyboardFingerprint && !hasUnfulfilled) return;

    autoFulfillHashRef.current = key;
    void handleFulfillAllBeats(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, storyboardFingerprint, sortedBeats.length]);

  // Build exclusion lists from all OTHER beats so swaps never create duplicates
  const getExclusionsForBeat = (targetBeatId: string) => {
    const excludeUrls: string[] = [];
    const excludeTitles: string[] = [];
    const excludeRigSignatures: string[] = [];
    for (const b of sortedBeats) {
      if (b.id === targetBeatId) continue;
      if (b.heroAssetUrl) excludeUrls.push(b.heroAssetUrl);
      if (b.heroVideoUrl) excludeUrls.push(b.heroVideoUrl);
      if (b.heroAssetTitle) excludeTitles.push(b.heroAssetTitle);
      const sig = computeClientRigSignature(b);
      if (sig) excludeRigSignatures.push(sig);
    }
    return { excludeUrls, excludeTitles, excludeRigSignatures };
  };

  const handleQuickRefreshBeat = async (beat: StoryboardBeat) => {
    setRefreshingBeatId(beat.id);
    try {
      const { excludeUrls, excludeTitles, excludeRigSignatures } = getExclusionsForBeat(beat.id);
      // Also exclude this beat's current URL/signature so quick refresh gives a genuinely new option
      if (beat.heroAssetUrl) excludeUrls.push(beat.heroAssetUrl);
      if (beat.heroVideoUrl) excludeUrls.push(beat.heroVideoUrl);
      const curSig = computeClientRigSignature(beat);
      if (curSig) excludeRigSignatures.push(curSig);

      const mode: 'photo' | 'video' | 'animated_rig' | 'animated_map' =
        beat.sceneType === 'archival_video'
          ? 'video'
          : beat.sceneType === 'animated_rig'
          ? 'animated_rig'
          : beat.sceneType === 'animated_map'
          ? 'animated_map'
          : 'photo';

      const res = await apiFetch<FulfillSingleBeatResponse>('/api/assets/fulfill-beat', {
        method: 'POST',
        body: JSON.stringify({
          topic: project.topic || project.title,
          stylePreset: activePresetId,
          beat,
          mode,
          excludeUrls,
          excludeTitles,
          excludeRigSignatures,
        }),
      });

      await batchApplyBeatFulfillment(
        project.id,
        [{ beatId: beat.id, patch: res.patch }],
        res.createdAsset ? [res.createdAsset] : [],
        []
      );
      onToast(res.message);
    } catch (err: any) {
      onToast(err?.message || 'Could not refresh this beat visual.');
    } finally {
      setRefreshingBeatId(null);
    }
  };

  const openSwapModal = (beat: StoryboardBeat) => {
    setSwapBeat(beat);
    const defaultTab: SwapModalTab =
      beat.sceneType === 'archival_video'
        ? 'video'
        : beat.sceneType === 'animated_rig'
        ? 'animated_rig'
        : beat.sceneType === 'animated_map'
        ? 'upload_map'
        : 'photo';
    setSwapTab(defaultTab);
    const q = beat.assetSearchQuery || beat.shotBrief || project.topic || '';
    setSwapQuery(q.slice(0, 120));
    setSwapRigPrompt(beat.rigPrompt || beat.shotBrief || beat.narrationText || '');
    setSwapResults([]);
    if (defaultTab === 'photo' || defaultTab === 'video') {
      void runSwapArchiveSearch(q.slice(0, 120), defaultTab === 'video' ? 'video' : 'image');
    }
  };

  const runSwapArchiveSearch = async (query: string, mediaKind: 'image' | 'video') => {
    const clean = query.trim();
    if (!clean) return;
    setSwapSearching(true);
    try {
      const res = await apiFetch<{ assets: ArchiveSearchResultItem[] }>(
        `/api/archive/search?q=${encodeURIComponent(clean)}&mediaKind=${mediaKind}`
      );
      setSwapResults(res.assets || []);
    } catch (err: any) {
      onToast(err?.message || 'Archive search failed.');
    } finally {
      setSwapSearching(false);
    }
  };

  const handleBindArchiveResult = async (item: ArchiveSearchResultItem) => {
    if (!swapBeat) return;
    setSwapApplying(true);
    try {
      const isVideo = item.mediaKind === 'video' || Boolean(item.videoUrl);
      const tempId = `tmp_manual_${Date.now().toString(36)}`;
      const patch: Partial<StoryboardBeat> = isVideo
        ? {
            sceneType: 'archival_video',
            objectType: 'video_clip',
            heroAssetId: tempId,
            heroAssetUrl: item.thumbnailUrl || item.imageUrl || '',
            heroVideoUrl: item.videoUrl || '',
            videoStartOffsetSec: 0,
            heroAssetTitle: item.title.slice(0, 280),
            fulfillmentStatus: 'fulfilled',
          }
        : {
            sceneType: swapBeat.sceneType === 'layered_cutout' ? 'layered_cutout' : 'archival_photo',
            objectType: swapBeat.sceneType === 'layered_cutout' ? 'cutout' : 'photo',
            heroAssetId: tempId,
            heroAssetUrl: item.imageUrl || '',
            heroVideoUrl: '',
            heroAssetTitle: item.title.slice(0, 280),
            fulfillmentStatus: 'fulfilled',
          };

      await batchApplyBeatFulfillment(
        project.id,
        [{ beatId: swapBeat.id, patch }],
        [
          {
            tempId,
            title: item.title,
            description: item.description,
            sourceProvider: item.sourceProvider,
            sourceUrl: item.sourceUrl,
            imageUrl: item.imageUrl,
            videoUrl: item.videoUrl,
            thumbnailUrl: item.thumbnailUrl,
            durationSec: item.durationSec,
            mediaKind: isVideo ? 'video' : 'image',
            creator: item.creator,
            license: item.license,
            category: isVideo ? 'video_clip' : item.category,
            approvalStatus: 'approved',
            downloadStatus: 'ready',
            assignedBeatId: swapBeat.id,
          },
        ],
        []
      );

      onToast(`Bound "${item.title}" to Shot ${swapBeat.orderIndex + 1}.`);
      setSwapBeat(null);
    } catch (err: any) {
      onToast(err?.message || 'Failed to bind asset to beat.');
    } finally {
      setSwapApplying(false);
    }
  };

  const handleSwapGenerateRig = async () => {
    if (!swapBeat) return;
    setSwapApplying(true);
    try {
      const { excludeUrls, excludeTitles, excludeRigSignatures } = getExclusionsForBeat(swapBeat.id);
      const res = await apiFetch<FulfillSingleBeatResponse>('/api/assets/fulfill-beat', {
        method: 'POST',
        body: JSON.stringify({
          topic: project.topic || project.title,
          stylePreset: activePresetId,
          beat: swapBeat,
          mode: 'animated_rig',
          customQueryOrPrompt: swapRigPrompt,
          excludeUrls,
          excludeTitles,
          excludeRigSignatures,
        }),
      });

      await batchApplyBeatFulfillment(
        project.id,
        [{ beatId: swapBeat.id, patch: res.patch }],
        res.createdAsset ? [res.createdAsset] : [],
        []
      );
      onToast(res.message);
      setSwapBeat(null);
    } catch (err: any) {
      onToast(err?.message || 'Failed to code animated rig.');
    } finally {
      setSwapApplying(false);
    }
  };

  const handleSwapToMap = async () => {
    if (!swapBeat) return;
    setSwapApplying(true);
    try {
      const res = await apiFetch<FulfillSingleBeatResponse>('/api/assets/fulfill-beat', {
        method: 'POST',
        body: JSON.stringify({
          topic: project.topic || project.title,
          stylePreset: activePresetId,
          beat: swapBeat,
          mode: 'animated_map',
          customQueryOrPrompt: swapQuery,
        }),
      });
      await batchApplyBeatFulfillment(
        project.id,
        [{ beatId: swapBeat.id, patch: res.patch }],
        [],
        []
      );
      onToast(res.message);
      setSwapBeat(null);
    } catch (err: any) {
      onToast(err?.message || 'Failed to switch shot to animated map.');
    } finally {
      setSwapApplying(false);
    }
  };

  const handleUploadBeatImage = async (file: File) => {
    if (!swapBeat) return;
    setSwapApplying(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', project.id);
      const uploaded = await apiFetch<{ url: string; name: string }>('/api/uploads/reference', {
        method: 'POST',
        body: form,
      });

      const tempId = `tmp_upload_${Date.now().toString(36)}`;
      await batchApplyBeatFulfillment(
        project.id,
        [
          {
            beatId: swapBeat.id,
            patch: {
              sceneType: 'archival_photo',
              objectType: 'photo',
              heroAssetId: tempId,
              heroAssetUrl: uploaded.url,
              heroVideoUrl: '',
              heroAssetTitle: uploaded.name.slice(0, 280),
              fulfillmentStatus: 'fulfilled',
            },
          },
        ],
        [
          {
            tempId,
            title: uploaded.name,
            description: `Custom uploaded visual for Shot ${swapBeat.orderIndex + 1}`,
            sourceProvider: 'upload',
            sourceUrl: uploaded.url,
            imageUrl: uploaded.url,
            thumbnailUrl: uploaded.url,
            mediaKind: 'image',
            creator: 'User Upload',
            license: 'User Provided',
            category: 'reference',
            approvalStatus: 'approved',
            downloadStatus: 'ready',
            assignedBeatId: swapBeat.id,
          },
        ],
        []
      );
      onToast(`Uploaded "${uploaded.name}" directly to Shot ${swapBeat.orderIndex + 1}.`);
      setSwapBeat(null);
    } catch (err: any) {
      onToast(err?.message || 'Failed to upload image.');
    } finally {
      setSwapApplying(false);
    }
  };

  const handleApproveAndOpenMotion = async () => {
    if (deckMetrics.fulfilled === 0) {
      onToast('Fulfill at least one storyboard beat before opening Motion Studio.');
      return;
    }
    setApproving(true);
    try {
      await onUpdateProject({
        assetsApproved: true,
        activeStage: 'motion',
      });
      onToast('Beat visuals approved. Opening Motion Studio.');
      onNavigateMotion();
    } catch (err: any) {
      onToast(err?.message || 'Could not approve beat visuals.');
    } finally {
      setApproving(false);
    }
  };

  const filteredBeats = useMemo(() => {
    if (filter === 'all') return sortedBeats;
    return sortedBeats.filter((b) => {
      const st = b.sceneType || 'archival_photo';
      if (filter === 'video') return st === 'archival_video';
      if (filter === 'rig') return st === 'animated_rig';
      if (filter === 'map') return st === 'animated_map' || st === 'kinetic_title';
      return st !== 'archival_video' && st !== 'animated_rig' && st !== 'animated_map' && st !== 'kinetic_title';
    });
  }, [sortedBeats, filter]);

  // URLs claimed by OTHER beats (used to warn/block duplicates inside the Swap Modal)
  const swapOtherUsedUrls = useMemo(() => {
    const s = new Set<string>();
    if (!swapBeat) return s;
    for (const b of sortedBeats) {
      if (b.id === swapBeat.id) continue;
      if (b.heroAssetUrl) s.add(b.heroAssetUrl);
      if (b.heroVideoUrl) s.add(b.heroVideoUrl);
    }
    return s;
  }, [sortedBeats, swapBeat]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-[#E5A03A] font-medium mb-1">
            Step 05 of 07 · Beat-Matched Media & Animation Studio · 1-to-1 Fulfillment (Zero Repeats)
          </p>
          <h1 className="font-display text-3xl font-semibold text-[#F4F4F6]">
            Media & Animation Studio
          </h1>
          <p className="text-sm text-[#989CA8] mt-1 max-w-2xl">
            Every beat planned in Step 4 is automatically fulfilled 1-to-1 with its own unique public-domain video clip, archival photo, code-driven flat-vector animation rig, or cartography map.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => handleFulfillAllBeats(true)}
            disabled={fulfillingAll || sortedBeats.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-[#16171D] border border-[#262933] text-[#F4F4F6] hover:border-[#E5A03A] rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {fulfillingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E5A03A]" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-[#E5A03A]" />
            )}
            Re-Fulfill All Beats (Zero Repeats)
          </button>

          <button
            onClick={handleApproveAndOpenMotion}
            disabled={approving || fulfillingAll || deckMetrics.fulfilled === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {approving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Approve Visuals & Open Motion Studio
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Auto-Fulfillment Progress Banner */}
      <AnimatePresence>
        {fulfillingAll && (
          <StageProgressBanner
            stepNumber={5}
            title="Fulfilling Storyboard Beats 1-to-1"
            statusMessage={`Matching ${sortedBeats.length} shots across real photos, public archival video clips, animated vector rigs & maps with zero repeats`}
            subSteps={FULFILL_PHASES}
            activeSubStepIndex={phaseIdx}
          />
        )}
      </AnimatePresence>

      {/* Summary Bar + Functional Filter Tabs */}
      {sortedBeats.length > 0 && (
        <div className="bg-[#16171D] border border-[#262933] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#989CA8]">
            <span className="font-mono-tabular font-semibold text-[#F4F4F6]">
              {deckMetrics.fulfilled}/{deckMetrics.total} Beats Fulfilled
            </span>
            <span className="text-[#4B4F5E]">·</span>
            <span
              className={
                deckMetrics.duplicates === 0
                  ? 'font-mono-tabular text-[#22C55E] font-medium'
                  : 'font-mono-tabular text-[#F87171] font-medium'
              }
            >
              {deckMetrics.duplicates} Duplicates
            </span>
            <span className="text-[#4B4F5E]">·</span>
            <span>{deckMetrics.videoCount} Video Clips</span>
            <span className="text-[#4B4F5E]">·</span>
            <span>{deckMetrics.rigCount} Animated Rigs</span>
            <span className="text-[#4B4F5E]">·</span>
            <span>{deckMetrics.photoCount} Archival Photos</span>
            <span className="text-[#4B4F5E]">·</span>
            <span>{deckMetrics.mapTitleCount} Maps & Titles</span>
          </div>

          <div className="flex items-center gap-1 bg-[#0B0B0D] border border-[#262933] rounded-lg p-0.5">
            {(
              [
                { id: 'all', label: 'All Beats' },
                { id: 'video', label: 'Video' },
                { id: 'rig', label: 'Animated Rigs' },
                { id: 'photo', label: 'Photos' },
                { id: 'map', label: 'Maps & Titles' },
              ] as Array<{ id: DeckFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  filter === tab.id
                    ? 'bg-[#232632] text-[#F4F4F6] font-medium'
                    : 'text-[#989CA8] hover:text-[#F4F4F6]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {sortedBeats.length === 0 && (
        <div className="bg-[#16171D] border border-[#262933] rounded-xl p-10 text-center space-y-3">
          <Layers className="w-8 h-8 text-[#E5A03A] mx-auto" />
          <h2 className="text-base font-semibold text-[#F4F4F6]">No Storyboard Shots Planned Yet</h2>
          <p className="text-xs text-[#989CA8] max-w-md mx-auto">
            Return to Step 4 (Storyboard) to generate your voice-synced shot blueprint first. Step 5 will then automatically fulfill every beat 1-to-1 with unique visuals.
          </p>
        </div>
      )}

      {/* Beat-by-Beat Visual Deck (2-column grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filteredBeats.map((beat) => {
          const sceneType: BeatSceneType = beat.sceneType || 'archival_photo';
          const linkedAsset = beat.heroAssetId ? assetById.get(beat.heroAssetId) : undefined;
          const isRefreshing = refreshingBeatId === beat.id;
          const fulfilled = isBeatVisuallyFulfilled(beat);

          return (
            <article
              key={beat.id}
              className="bg-[#16171D] border border-[#262933] rounded-xl overflow-hidden flex flex-col"
            >
              {/* Card Header */}
              <div className="px-4 py-2.5 bg-[#101115] border-b border-[#262933] flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono-tabular font-semibold text-[#E5A03A] shrink-0">
                    Shot {String(beat.orderIndex + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[#4B4F5E]">·</span>
                  <span className="font-mono-tabular text-[#989CA8] shrink-0">
                    {formatTimecode(beat.startMs, project.frameRate || 30)}
                  </span>
                  <span className="text-[#4B4F5E]">·</span>
                  <span className="text-[#D4D6DC] truncate">
                    {sceneType === 'archival_video'
                      ? 'Public Video Clip'
                      : sceneType === 'animated_rig'
                      ? 'Flat-Vector Animated Rig'
                      : sceneType === 'animated_map'
                      ? 'Animated Map'
                      : sceneType === 'kinetic_title'
                      ? 'Kinetic Title'
                      : sceneType === 'layered_cutout'
                      ? 'Archival Photo Cutout'
                      : 'Archival Photograph'}
                  </span>
                </div>

                <span
                  className={`text-[11px] shrink-0 ${
                    fulfilled ? 'text-[#22C55E]' : 'text-[#989CA8]'
                  }`}
                >
                  {fulfilled ? 'Unique Match' : 'Pending'}
                </span>
              </div>

              {/* 16:9 Live Visual Preview */}
              <div className="aspect-video w-full bg-[#0B0B0D] relative overflow-hidden border-b border-[#262933]">
                {sceneType === 'archival_video' && beat.heroVideoUrl ? (
                  <ProxiedVideoPreview
                    videoUrl={beat.heroVideoUrl}
                    posterUrl={beat.heroAssetUrl}
                    title={beat.heroAssetTitle}
                  />
                ) : sceneType === 'animated_rig' && beat.animatedRigSpec ? (
                  <AnimatedRigCanvas
                    spec={beat.animatedRigSpec}
                    presetId={activePresetId}
                    className="w-full h-full"
                  />
                ) : sceneType === 'animated_map' ? (
                  <div className="w-full h-full p-5 bg-[#0D1A2B] flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs text-[#38BDF8]">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <MapIcon className="w-4 h-4" />
                        {MAP_REGIONS[beat.mapSpec?.region || 'world']?.label || 'Animated Map'}
                      </span>
                      <span className="font-mono-tabular text-[#94A3B8]">
                        {beat.dateBadge || beat.mapSpec?.dateLabel || ''}
                      </span>
                    </div>
                    <div className="text-sm font-display text-[#F8FAFC] line-clamp-2">
                      {beat.heroAssetTitle || beat.shotBrief}
                    </div>
                    <div className="text-xs text-[#94A3B8] font-mono-tabular">
                      {beat.mapSpec?.markers?.length || 0} pulsing markers ·{' '}
                      {beat.mapSpec?.routes?.length || 0} animated routes
                    </div>
                  </div>
                ) : sceneType === 'kinetic_title' ? (
                  <div className="w-full h-full p-6 bg-[#10121A] flex flex-col items-center justify-center text-center gap-2">
                    <Type className="w-5 h-5 text-[#E5A03A]" />
                    <div className="font-display text-xl font-bold text-[#F4F4F6]">
                      {beat.onScreenText || beat.heroAssetTitle || 'Chapter Title'}
                    </div>
                    {beat.dateBadge && (
                      <div className="font-mono-tabular text-xs text-[#E5A03A]">{beat.dateBadge}</div>
                    )}
                  </div>
                ) : beat.heroAssetUrl ? (
                  <AuthImage
                    src={beat.heroAssetUrl}
                    alt={beat.heroAssetTitle || `Shot ${beat.orderIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-[#6B7080]">
                    <Loader2 className="w-5 h-5 animate-spin text-[#E5A03A]" />
                    <span>Awaiting beat fulfillment...</span>
                  </div>
                )}
              </div>

              {/* Narration & Attribution Body */}
              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <p className="text-xs text-[#F4F4F6] leading-relaxed line-clamp-2">
                    “{beat.narrationText}”
                  </p>
                  {beat.shotBrief && (
                    <p className="text-[11px] text-[#989CA8] line-clamp-2">
                      Brief: {beat.shotBrief}
                    </p>
                  )}
                  <div className="text-[11px] text-[#6B7080] truncate pt-0.5">
                    {beat.heroAssetTitle || 'Untitled visual'}
                    {linkedAsset?.creator ? ` · ${linkedAsset.creator}` : ''}
                    {linkedAsset?.license ? ` · ${linkedAsset.license}` : ''}
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-2.5 border-t border-[#262933] flex items-center justify-between gap-2">
                  <button
                    onClick={() => openSwapModal(beat)}
                    disabled={fulfillingAll || isRefreshing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1E2028] hover:bg-[#272A35] text-[#F4F4F6] border border-[#323644] rounded-lg disabled:opacity-50"
                  >
                    <Search className="w-3.5 h-3.5 text-[#E5A03A]" />
                    Swap Media
                  </button>

                  <button
                    onClick={() => handleQuickRefreshBeat(beat)}
                    disabled={fulfillingAll || isRefreshing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded-lg disabled:opacity-50"
                  >
                    {isRefreshing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E5A03A]" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    New Alternative
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Per-Beat Swap Modal */}
      {swapBeat && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#16171D] border border-[#262933] rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-[#101115] border-b border-[#262933] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs text-[#E5A03A] font-mono-tabular">
                  Swap Visual · Shot {String(swapBeat.orderIndex + 1).padStart(2, '0')}
                </div>
                <p className="text-xs text-[#D4D6DC] truncate mt-0.5">
                  “{swapBeat.narrationText}”
                </p>
              </div>
              <button
                onClick={() => setSwapBeat(null)}
                className="p-1.5 text-[#989CA8] hover:text-[#F4F4F6] hover:bg-[#1E2028] rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-5 pt-3 border-b border-[#262933] flex flex-wrap gap-2 bg-[#121319]">
              {(
                [
                  { id: 'photo', label: 'Archival Photos', icon: ImageIcon },
                  { id: 'video', label: 'Public Video Clips', icon: Video },
                  { id: 'animated_rig', label: 'Code Animated Rig', icon: Sparkles },
                  { id: 'upload_map', label: 'Upload / Map', icon: Upload },
                ] as Array<{ id: SwapModalTab; label: string; icon: typeof ImageIcon }>
              ).map((t) => {
                const Icon = t.icon;
                const active = swapTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSwapTab(t.id);
                      if (t.id === 'photo') void runSwapArchiveSearch(swapQuery, 'image');
                      if (t.id === 'video') void runSwapArchiveSearch(swapQuery, 'video');
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      active
                        ? 'border-[#E5A03A] text-[#F4F4F6]'
                        : 'border-transparent text-[#989CA8] hover:text-[#F4F4F6]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {(swapTab === 'photo' || swapTab === 'video') && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runSwapArchiveSearch(swapQuery, swapTab === 'video' ? 'video' : 'image');
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={swapQuery}
                      onChange={(e) => setSwapQuery(e.target.value)}
                      placeholder={
                        swapTab === 'video'
                          ? 'Search Wikimedia Commons & NASA public-domain video clips...'
                          : 'Search Wikimedia Commons, Library of Congress & NASA photos...'
                      }
                      className="flex-1 bg-[#0B0B0D] border border-[#262933] focus:border-[#E5A03A] rounded-lg px-3 py-2 text-xs text-[#F4F4F6] outline-none"
                    />
                    <button
                      type="submit"
                      disabled={swapSearching}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] disabled:opacity-50"
                    >
                      {swapSearching ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      Search
                    </button>
                  </form>

                  {swapSearching ? (
                    <div className="py-10 text-center text-xs text-[#989CA8] flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#E5A03A]" />
                      Searching verified public-domain archives...
                    </div>
                  ) : swapResults.length === 0 ? (
                    <div className="py-10 text-center text-xs text-[#989CA8]">
                      No verified results for this query yet. Try broader historical or subject keywords.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {swapResults.map((item, idx) => {
                        const keyUrl = item.videoUrl || item.imageUrl;
                        const usedElsewhere = Boolean(keyUrl && swapOtherUsedUrls.has(keyUrl));
                        return (
                          <div
                            key={`${keyUrl}-${idx}`}
                            className="bg-[#0E0F14] border border-[#262933] rounded-lg overflow-hidden flex flex-col"
                          >
                            <div className="aspect-video bg-[#07080B] relative">
                              {item.thumbnailUrl || item.imageUrl ? (
                                <AuthImage
                                  src={item.thumbnailUrl || item.imageUrl}
                                  alt={item.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Film className="w-6 h-6 text-[#6B7080]" />
                                </div>
                              )}
                              {item.durationSec && (
                                <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono-tabular text-[#F4F4F6]">
                                  {Math.round(item.durationSec)}s
                                </div>
                              )}
                            </div>
                            <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                              <div>
                                <div className="text-xs font-medium text-[#F4F4F6] line-clamp-1">
                                  {item.title}
                                </div>
                                <div className="text-[11px] text-[#6B7080] truncate">
                                  {item.sourceProvider} · {item.license}
                                </div>
                              </div>
                              <button
                                onClick={() => handleBindArchiveResult(item)}
                                disabled={swapApplying || usedElsewhere}
                                className="w-full py-1.5 text-xs font-medium rounded-md border border-[#323644] bg-[#1A1C24] hover:border-[#E5A03A] text-[#F4F4F6] disabled:opacity-40"
                              >
                                {usedElsewhere
                                  ? 'Already used on another shot'
                                  : swapApplying
                                  ? 'Binding...'
                                  : 'Use on This Shot'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {swapTab === 'animated_rig' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-[#D4D6DC] mb-1.5">
                      Flat-Vector Animation Prompt (Vox / Kurzgesagt Style)
                    </label>
                    <textarea
                      value={swapRigPrompt}
                      onChange={(e) => setSwapRigPrompt(e.target.value)}
                      rows={4}
                      placeholder="Describe the moving characters, vehicles, props, and visual action for this shot..."
                      className="w-full bg-[#0B0B0D] border border-[#262933] focus:border-[#E5A03A] rounded-lg px-3 py-2.5 text-xs text-[#F4F4F6] outline-none"
                    />
                  </div>
                  <button
                    onClick={handleSwapGenerateRig}
                    disabled={swapApplying}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] disabled:opacity-50"
                  >
                    {swapApplying ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Code Unique Animated Character Rig
                  </button>
                </div>
              )}

              {swapTab === 'upload_map' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-[#0E0F14] border border-[#262933] rounded-lg p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#F4F4F6]">Upload Custom Image</div>
                    <p className="text-[11px] text-[#989CA8]">
                      Upload your own photograph, chart, or artwork to bind exclusively to Shot{' '}
                      {swapBeat.orderIndex + 1}.
                    </p>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-[#1E2028] hover:bg-[#272A35] text-[#F4F4F6] border border-[#323644] rounded-lg cursor-pointer">
                      <Upload className="w-3.5 h-3.5 text-[#E5A03A]" />
                      Choose Image File
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUploadBeatImage(f);
                        }}
                      />
                    </label>
                  </div>

                  <div className="bg-[#0E0F14] border border-[#262933] rounded-lg p-4 space-y-3">
                    <div className="text-xs font-semibold text-[#F4F4F6]">
                      Animated Cartography Map
                    </div>
                    <p className="text-[11px] text-[#989CA8]">
                      Replace this shot with an animated geographic map featuring pulsing markers, route arrows, and smooth camera flight.
                    </p>
                    <button
                      onClick={handleSwapToMap}
                      disabled={swapApplying}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#E5A03A] text-[#0B0B0D] rounded-lg hover:bg-[#F0B254] disabled:opacity-50"
                    >
                      <MapIcon className="w-3.5 h-3.5" />
                      Switch Shot to Animated Map
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
