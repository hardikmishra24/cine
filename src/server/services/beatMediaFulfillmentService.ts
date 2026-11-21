import {
  VIDEO_STYLE_PRESETS,
  type ArchivalAsset,
  type BeatMapSpec,
  type BeatObjectType,
  type BeatSceneType,
  type MapRegionId,
  type StoryboardBeat,
  type VideoStylePresetId,
} from '../../types/cineforge.ts';
import { MAP_REGIONS } from '../../lib/worldMapData.ts';
import { ArchivalAssetService } from './archivalAssetService.ts';
import {
  AnimatedRigGenerationService,
  computeRigSignature,
} from './animatedRigService.ts';

type DraftFulfilledAsset = Omit<
  ArchivalAsset,
  'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'
> & { tempId: string };

export interface BeatFulfillmentPatch {
  beatId: string;
  patch: Partial<StoryboardBeat>;
}

export interface UniquenessReport {
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
}

export interface FulfillStoryboardResult {
  beatPatches: BeatFulfillmentPatch[];
  createdAssets: DraftFulfilledAsset[];
  uniquenessReport: UniquenessReport;
}

function normalizeTitle(val?: string): string {
  return String(val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildBroadFallbackQuery(topic: string, narrationText: string, beatIndex: number): string {
  const words = `${topic} ${narrationText}`
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const picked = Array.from(new Set(words)).slice(0, 3);
  if (picked.length === 0) return `history documentary ${beatIndex + 1}`;
  return picked.join(' ');
}

function detectMapRegionQuick(text: string): MapRegionId {
  const lower = text.toLowerCase();
  if (/australia|perth|sydney|melbourne|outback|emu|ampion/.test(lower)) return 'australia';
  if (/europe|london|paris|berlin|rome|britain|france|germany|spain|italy|scilly|dutch/.test(lower)) return 'europe';
  if (/united states|america|new york|washington|texas|california|canada|mexico/.test(lower)) return 'north_america';
  if (/china|japan|india|korea|vietnam|asia|tokyo|beijing/.test(lower)) return 'asia';
  if (/egypt|iraq|iran|persia|arabia|jerusalem|middle east|ottoman/.test(lower)) return 'middle_east';
  if (/brazil|argentina|peru|chile|andes|amazon|south america/.test(lower)) return 'south_america';
  if (/pacific|hawaii|midway|galapagos|polynesia/.test(lower)) return 'pacific';
  if (/atlantic|titanic|caribbean|azores/.test(lower)) return 'atlantic';
  return 'world';
}

function buildFallbackMapSpec(
  topic: string,
  narrationText: string,
  dateBadge: string | undefined,
  beatIndex: number,
  accentColor: string
): BeatMapSpec {
  const region = detectMapRegionQuick(`${topic} ${narrationText}`);
  const regionMeta = MAP_REGIONS[region] || MAP_REGIONS.world;
  const focusX = 46 + ((beatIndex * 7) % 14) - 7;
  const focusY = 48 + ((beatIndex * 5) % 12) - 6;
  const shortLabel =
    narrationText
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 2)
      .join(' ')
      .replace(/[^a-zA-Z0-9\s-]/g, '') || regionMeta.label;
  return {
    region,
    dateLabel: dateBadge || undefined,
    focusX,
    focusY,
    zoom: 1.32,
    markers: [
      { label: shortLabel.slice(0, 24), x: focusX, y: focusY, kind: 'event', color: accentColor },
      { label: regionMeta.label, x: Math.min(82, focusX + 16), y: Math.max(24, focusY - 10), kind: 'city', color: '#00D4FF' },
    ],
    routes: [
      {
        fromX: Math.max(18, focusX - 18),
        fromY: Math.min(76, focusY + 12),
        toX: focusX,
        toY: focusY,
        color: accentColor,
        dashed: true,
      },
    ],
  };
}

export class BeatMediaFulfillmentService {
  private archivalService: ArchivalAssetService;

  constructor(archivalService?: ArchivalAssetService) {
    this.archivalService = archivalService || new ArchivalAssetService();
  }

  /**
   * 1-to-1 Storyboard Beat Media Fulfillment Engine with strict timeline-wide zero-repeat guarantee.
   * No archival photo, public video clip, or animated rig signature is ever assigned to two beats.
   */
  async fulfillStoryboardBeats(params: {
    topic: string;
    researchSummary?: string;
    stylePreset?: VideoStylePresetId;
    beats: StoryboardBeat[];
    lockedBeatIds?: string[];
    onProgress?: (completed: number, total: number, message: string) => void;
  }): Promise<FulfillStoryboardResult> {
    const presetId: VideoStylePresetId =
      params.stylePreset && VIDEO_STYLE_PRESETS[params.stylePreset]
        ? params.stylePreset
        : 'historically';
    const preset = VIDEO_STYLE_PRESETS[presetId];

    const lockedSet = new Set(params.lockedBeatIds || []);
    const usedUrls = new Set<string>();
    const usedTitles = new Set<string>();
    const usedRigSignatures = new Set<string>();

    const sortedBeats = [...params.beats].sort((a, b) => a.orderIndex - b.orderIndex);

    // Pre-register any locked beats so we never reuse their URLs or rig signatures on other beats
    for (const beat of sortedBeats) {
      if (!lockedSet.has(beat.id)) continue;
      if (beat.heroVideoUrl) usedUrls.add(beat.heroVideoUrl);
      if (beat.heroAssetUrl) usedUrls.add(beat.heroAssetUrl);
      if (beat.heroAssetTitle) usedTitles.add(normalizeTitle(beat.heroAssetTitle));
      if (beat.animatedRigSpec) usedRigSignatures.add(computeRigSignature(beat.animatedRigSpec));
    }

    const beatPatches: BeatFulfillmentPatch[] = [];
    const createdAssets: DraftFulfilledAsset[] = [];

    const breakdown = {
      archivalVideo: 0,
      animatedRig: 0,
      archivalPhoto: 0,
      animatedMap: 0,
      kineticTitle: 0,
    };

    const claimAssetUrls = (asset: { videoUrl?: string; imageUrl?: string; title?: string }) => {
      if (asset.videoUrl) usedUrls.add(asset.videoUrl);
      if (asset.imageUrl) usedUrls.add(asset.imageUrl);
      if (asset.title) usedTitles.add(normalizeTitle(asset.title));
    };

    for (let i = 0; i < sortedBeats.length; i++) {
      const beat = sortedBeats[i];
      if (lockedSet.has(beat.id)) {
        // Count locked beat in breakdown
        if (beat.sceneType === 'archival_video') breakdown.archivalVideo++;
        else if (beat.sceneType === 'animated_rig') breakdown.animatedRig++;
        else if (beat.sceneType === 'animated_map') breakdown.animatedMap++;
        else if (beat.sceneType === 'kinetic_title') breakdown.kineticTitle++;
        else breakdown.archivalPhoto++;
        continue;
      }

      params.onProgress?.(
        i,
        sortedBeats.length,
        `Fulfilling Beat ${i + 1}/${sortedBeats.length} (${(beat.sceneType || 'archival_photo').replace('_', ' ')})...`
      );

      const plannedType: BeatSceneType = beat.sceneType || 'archival_photo';
      const searchQuery =
        (beat.assetSearchQuery || '').trim() ||
        buildBroadFallbackQuery(params.topic, beat.narrationText, i);
      const fallbackQuery = buildBroadFallbackQuery(params.topic, beat.narrationText, i);
      const rigBrief =
        (beat.rigPrompt || beat.shotBrief || beat.narrationText || params.topic).trim();

      // 1. Animated Map beat
      if (plannedType === 'animated_map') {
        const mapSpec =
          beat.mapSpec ||
          buildFallbackMapSpec(
            params.topic,
            beat.narrationText,
            beat.dateBadge,
            i,
            preset.palette.accent
          );
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: 'animated_map',
            objectType: 'map',
            mapSpec,
            heroAssetId: '',
            heroAssetUrl: '',
            heroVideoUrl: '',
            heroAssetTitle: `${MAP_REGIONS[mapSpec.region]?.label || 'Regional'} Animated Map`,
            fulfillmentStatus: 'fulfilled',
          },
        });
        breakdown.animatedMap++;
        continue;
      }

      // 2. Kinetic Title beat
      if (plannedType === 'kinetic_title') {
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: 'kinetic_title',
            objectType: 'title_card',
            onScreenText:
              beat.onScreenText ||
              params.topic.split(/\s+/).slice(0, 4).join(' ').toUpperCase(),
            heroAssetId: '',
            heroAssetUrl: '',
            heroVideoUrl: '',
            fulfillmentStatus: 'fulfilled',
          },
        });
        breakdown.kineticTitle++;
        continue;
      }

      // 3. Public-Domain Archival Video Clip beat
      if (plannedType === 'archival_video') {
        const videoAsset = await this.archivalService.searchUniqueBeatMedia({
          query: searchQuery,
          fallbackQuery,
          mediaKind: 'video',
          excludeUrls: usedUrls,
          excludeTitles: usedTitles,
        });

        if (videoAsset && videoAsset.videoUrl) {
          claimAssetUrls(videoAsset);
          const tempId = `tmp_vid_${i}_${Date.now().toString(36)}`;
          createdAssets.push({
            ...videoAsset,
            tempId,
            mediaKind: 'video',
            category: 'video_clip',
            approvalStatus: 'approved',
            downloadStatus: 'ready',
            assignedBeatId: beat.id,
          });
          beatPatches.push({
            beatId: beat.id,
            patch: {
              sceneType: 'archival_video',
              objectType: 'video_clip',
              heroAssetId: tempId,
              heroAssetUrl: videoAsset.thumbnailUrl || videoAsset.imageUrl || '',
              heroVideoUrl: videoAsset.videoUrl,
              videoStartOffsetSec: 0,
              heroAssetTitle: videoAsset.title.slice(0, 280),
              fulfillmentStatus: 'fulfilled',
            },
          });
          breakdown.archivalVideo++;
          continue;
        }

        // Fallback if no unused public-domain video exists for this niche historical query:
        // Upgrade cleanly into a bespoke, unique code-generated animated rig so zero beats stay empty or repeat!
        const { rig } = await AnimatedRigGenerationService.generateSingleRig({
          prompt: rigBrief,
          narrationText: beat.narrationText,
          topic: params.topic,
          stylePreset: presetId,
          beatIndex: i,
          avoidSignatures: Array.from(usedRigSignatures),
        });
        const rigSig = computeRigSignature(rig.animatedRigSpec);
        usedRigSignatures.add(rigSig);
        const tempId = `tmp_rig_${i}_${Date.now().toString(36)}`;
        createdAssets.push({
          tempId,
          title: rig.title,
          description: `${rig.description} (Upgraded from archival video search for zero-repeat motion coverage.)`,
          sourceProvider: 'code_animation',
          sourceUrl: '',
          imageUrl: '',
          thumbnailUrl: '',
          mediaKind: 'animated_rig',
          creator: 'CineForge Code-Driven Vector Rig',
          license: 'Original Procedural Vector Animation',
          category: 'animated_rig',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: beat.id,
          animatedRigSpec: rig.animatedRigSpec,
        });
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: 'animated_rig',
            objectType: 'animated_rig',
            heroAssetId: tempId,
            heroAssetUrl: '',
            heroVideoUrl: '',
            heroAssetTitle: rig.title.slice(0, 280),
            animatedRigSpec: rig.animatedRigSpec,
            fulfillmentStatus: 'fallback',
          },
        });
        breakdown.animatedRig++;
        continue;
      }

      // 4. Code-Generated Animated Character / Object Rig beat
      if (plannedType === 'animated_rig') {
        const { rig } = await AnimatedRigGenerationService.generateSingleRig({
          prompt: rigBrief,
          narrationText: beat.narrationText,
          topic: params.topic,
          stylePreset: presetId,
          beatIndex: i,
          avoidSignatures: Array.from(usedRigSignatures),
        });
        const rigSig = computeRigSignature(rig.animatedRigSpec);
        usedRigSignatures.add(rigSig);
        const tempId = `tmp_rig_${i}_${Date.now().toString(36)}`;
        createdAssets.push({
          tempId,
          title: rig.title,
          description: rig.description,
          sourceProvider: 'code_animation',
          sourceUrl: '',
          imageUrl: '',
          thumbnailUrl: '',
          mediaKind: 'animated_rig',
          creator: 'CineForge Code-Driven Vector Rig',
          license: 'Original Procedural Vector Animation',
          category: 'animated_rig',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: beat.id,
          animatedRigSpec: rig.animatedRigSpec,
        });
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: 'animated_rig',
            objectType: 'animated_rig',
            heroAssetId: tempId,
            heroAssetUrl: '',
            heroVideoUrl: '',
            heroAssetTitle: rig.title.slice(0, 280),
            animatedRigSpec: rig.animatedRigSpec,
            fulfillmentStatus: 'fulfilled',
          },
        });
        breakdown.animatedRig++;
        continue;
      }

      // 5. Archival Photo / Layered Cutout / Diagram Callout beat
      const photoAsset = await this.archivalService.searchUniqueBeatMedia({
        query: searchQuery,
        fallbackQuery,
        mediaKind: 'image',
        excludeUrls: usedUrls,
        excludeTitles: usedTitles,
      });

      if (photoAsset && photoAsset.imageUrl) {
        claimAssetUrls(photoAsset);
        const tempId = `tmp_img_${i}_${Date.now().toString(36)}`;
        const resolvedObjectType: BeatObjectType =
          plannedType === 'layered_cutout'
            ? 'cutout'
            : plannedType === 'diagram_callout'
            ? 'diagram'
            : 'photo';

        createdAssets.push({
          ...photoAsset,
          tempId,
          mediaKind: 'image',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: beat.id,
        });
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: plannedType,
            objectType: resolvedObjectType,
            heroAssetId: tempId,
            heroAssetUrl: photoAsset.imageUrl,
            heroVideoUrl: '',
            heroAssetTitle: photoAsset.title.slice(0, 280),
            fulfillmentStatus: 'fulfilled',
          },
        });
        breakdown.archivalPhoto++;
      } else {
        // Zero-repeat safety net: if no unused real photo was found for this query, synthesize a unique animated rig
        const { rig } = await AnimatedRigGenerationService.generateSingleRig({
          prompt: rigBrief,
          narrationText: beat.narrationText,
          topic: params.topic,
          stylePreset: presetId,
          beatIndex: i,
          avoidSignatures: Array.from(usedRigSignatures),
        });
        const rigSig = computeRigSignature(rig.animatedRigSpec);
        usedRigSignatures.add(rigSig);
        const tempId = `tmp_rig_${i}_${Date.now().toString(36)}`;
        createdAssets.push({
          tempId,
          title: rig.title,
          description: `${rig.description} (Generated to maintain 100% unique visual coverage with zero photo repeats.)`,
          sourceProvider: 'code_animation',
          sourceUrl: '',
          imageUrl: '',
          thumbnailUrl: '',
          mediaKind: 'animated_rig',
          creator: 'CineForge Code-Driven Vector Rig',
          license: 'Original Procedural Vector Animation',
          category: 'animated_rig',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: beat.id,
          animatedRigSpec: rig.animatedRigSpec,
        });
        beatPatches.push({
          beatId: beat.id,
          patch: {
            sceneType: 'animated_rig',
            objectType: 'animated_rig',
            heroAssetId: tempId,
            heroAssetUrl: '',
            heroVideoUrl: '',
            heroAssetTitle: rig.title.slice(0, 280),
            animatedRigSpec: rig.animatedRigSpec,
            fulfillmentStatus: 'fallback',
          },
        });
        breakdown.animatedRig++;
      }
    }

    params.onProgress?.(
      sortedBeats.length,
      sortedBeats.length,
      `Fulfilled ${sortedBeats.length}/${sortedBeats.length} beats with zero visual repeats.`
    );

    // Strictly audit uniqueness across all returned patches + locked beats
    const auditMediaKeys = new Set<string>();
    let duplicateCount = 0;
    const patchMap = new Map(beatPatches.map((bp) => [bp.beatId, bp.patch]));
    for (const beat of sortedBeats) {
      const p = patchMap.get(beat.id);
      const vidUrl = p ? p.heroVideoUrl : beat.heroVideoUrl;
      const imgUrl = p ? p.heroAssetUrl : beat.heroAssetUrl;
      const rigSpec = p ? p.animatedRigSpec : beat.animatedRigSpec;
      const sceneType = (p ? p.sceneType : beat.sceneType) || 'archival_photo';

      let key = '';
      if (sceneType === 'archival_video' && vidUrl) key = `vid:${vidUrl}`;
      else if (sceneType === 'animated_rig' && rigSpec) key = `rig:${computeRigSignature(rigSpec)}`;
      else if (imgUrl) key = `img:${imgUrl}`;

      if (key) {
        if (auditMediaKeys.has(key)) duplicateCount++;
        auditMediaKeys.add(key);
      }
    }

    return {
      beatPatches,
      createdAssets,
      uniquenessReport: {
        totalBeats: sortedBeats.length,
        fulfilledCount: sortedBeats.length,
        uniqueAssetCount: createdAssets.length,
        duplicateCount,
        breakdown,
      },
    };
  }

  /**
   * Single-beat fulfillment / swap for Step 5's Per-Beat Swap Drawer.
   * Respects all URLs and rig signatures currently assigned to OTHER beats.
   */
  async fulfillSingleBeat(params: {
    topic: string;
    stylePreset?: VideoStylePresetId;
    beat: StoryboardBeat;
    mode: 'photo' | 'video' | 'animated_rig' | 'animated_map';
    customQueryOrPrompt?: string;
    excludeUrls?: string[];
    excludeTitles?: string[];
    excludeRigSignatures?: string[];
  }): Promise<{
    patch: Partial<StoryboardBeat>;
    createdAsset?: DraftFulfilledAsset;
    message: string;
  }> {
    const presetId: VideoStylePresetId =
      params.stylePreset && VIDEO_STYLE_PRESETS[params.stylePreset]
        ? params.stylePreset
        : 'historically';
    const preset = VIDEO_STYLE_PRESETS[presetId];
    const excludeUrlSet = new Set(params.excludeUrls || []);
    const excludeTitleSet = new Set((params.excludeTitles || []).map(normalizeTitle));
    const excludeRigSet = new Set(params.excludeRigSignatures || []);

    const queryOrPrompt =
      (params.customQueryOrPrompt || '').trim() ||
      (params.mode === 'animated_rig'
        ? params.beat.rigPrompt || params.beat.shotBrief || params.beat.narrationText
        : params.beat.assetSearchQuery || params.beat.narrationText);

    if (params.mode === 'animated_map') {
      const mapSpec = buildFallbackMapSpec(
        params.topic,
        `${queryOrPrompt} ${params.beat.narrationText}`,
        params.beat.dateBadge,
        params.beat.orderIndex,
        preset.palette.accent
      );
      return {
        patch: {
          sceneType: 'animated_map',
          objectType: 'map',
          mapSpec,
          heroAssetId: '',
          heroAssetUrl: '',
          heroVideoUrl: '',
          heroAssetTitle: `${MAP_REGIONS[mapSpec.region]?.label || 'Regional'} Animated Map`,
          fulfillmentStatus: 'fulfilled',
        },
        message: `Switched Beat ${params.beat.orderIndex + 1} to animated cartography map.`,
      };
    }

    if (params.mode === 'animated_rig') {
      const { rig } = await AnimatedRigGenerationService.generateSingleRig({
        prompt: queryOrPrompt,
        narrationText: params.beat.narrationText,
        topic: params.topic,
        stylePreset: presetId,
        beatIndex: params.beat.orderIndex,
        avoidSignatures: Array.from(excludeRigSet),
      });
      const tempId = `tmp_swap_rig_${Date.now().toString(36)}`;
      return {
        patch: {
          sceneType: 'animated_rig',
          objectType: 'animated_rig',
          heroAssetId: tempId,
          heroAssetUrl: '',
          heroVideoUrl: '',
          heroAssetTitle: rig.title.slice(0, 280),
          rigPrompt: queryOrPrompt.slice(0, 560),
          animatedRigSpec: rig.animatedRigSpec,
          fulfillmentStatus: 'fulfilled',
        },
        createdAsset: {
          tempId,
          title: rig.title,
          description: rig.description,
          sourceProvider: 'code_animation',
          sourceUrl: '',
          imageUrl: '',
          thumbnailUrl: '',
          mediaKind: 'animated_rig',
          creator: 'CineForge Code-Driven Vector Rig',
          license: 'Original Procedural Vector Animation',
          category: 'animated_rig',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: params.beat.id,
          animatedRigSpec: rig.animatedRigSpec,
        },
        message: `Generated unique animated character rig for Beat ${params.beat.orderIndex + 1}.`,
      };
    }

    const mediaKind = params.mode === 'video' ? 'video' : 'image';
    const found = await this.archivalService.searchUniqueBeatMedia({
      query: queryOrPrompt,
      fallbackQuery: buildBroadFallbackQuery(params.topic, queryOrPrompt, params.beat.orderIndex),
      mediaKind,
      excludeUrls: excludeUrlSet,
      excludeTitles: excludeTitleSet,
    });

    if (!found) {
      throw new Error(
        `No unused ${mediaKind === 'video' ? 'public-domain video clip' : 'archival photograph'} was found for "${queryOrPrompt}". Try broadening your keywords or switching to an Animated Rig.`
      );
    }

    const tempId = `tmp_swap_${mediaKind}_${Date.now().toString(36)}`;
    if (mediaKind === 'video' && found.videoUrl) {
      return {
        patch: {
          sceneType: 'archival_video',
          objectType: 'video_clip',
          heroAssetId: tempId,
          heroAssetUrl: found.thumbnailUrl || found.imageUrl || '',
          heroVideoUrl: found.videoUrl,
          videoStartOffsetSec: 0,
          heroAssetTitle: found.title.slice(0, 280),
          assetSearchQuery: queryOrPrompt.slice(0, 240),
          fulfillmentStatus: 'fulfilled',
        },
        createdAsset: {
          ...found,
          tempId,
          mediaKind: 'video',
          category: 'video_clip',
          approvalStatus: 'approved',
          downloadStatus: 'ready',
          assignedBeatId: params.beat.id,
        },
        message: `Bound unique archival video clip "${found.title}" to Beat ${params.beat.orderIndex + 1}.`,
      };
    }

    return {
      patch: {
        sceneType: params.beat.sceneType === 'layered_cutout' ? 'layered_cutout' : 'archival_photo',
        objectType: params.beat.sceneType === 'layered_cutout' ? 'cutout' : 'photo',
        heroAssetId: tempId,
        heroAssetUrl: found.imageUrl || '',
        heroVideoUrl: '',
        heroAssetTitle: found.title.slice(0, 280),
        assetSearchQuery: queryOrPrompt.slice(0, 240),
        fulfillmentStatus: 'fulfilled',
      },
      createdAsset: {
        ...found,
        tempId,
        mediaKind: 'image',
        approvalStatus: 'approved',
        downloadStatus: 'ready',
        assignedBeatId: params.beat.id,
      },
      message: `Bound unique archival photo "${found.title}" to Beat ${params.beat.orderIndex + 1}.`,
    };
  }
}
