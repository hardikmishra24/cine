import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { authedMediaUrl, authedVideoProxyUrl } from './apiClient';
import { getActiveBeatAtTime, renderWorldFrame } from './motionWorldEngine';
import { renderMixedMasterAudioBuffer } from './soundDesignEngine';
import { STUDIO_BACKDROPS, type Project, type StoryboardBeat } from '../types/cineforge';

export interface DeterministicRenderParams {
  project: Project;
  beats: StoryboardBeat[];
  width: number;
  height: number;
  fps: number;
  onProgress: (stage: string, progress: number) => void;
}

export interface DeterministicRenderOutput {
  blob: Blob;
  mimeType: string;
  totalFrames: number;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  qaFrames: Array<{ timeSec: number; label: string; dataUrl: string }>;
  blackFramesDetected: number;
}

export async function preloadBeatImages(beats: StoryboardBeat[]): Promise<{
  images: Map<string, HTMLImageElement>;
  deskTexture: HTMLImageElement | null;
}> {
  const images = new Map<string, HTMLImageElement>();
  const uniqueUrls = Array.from(
    new Set(beats.map((b) => b.heroAssetUrl).filter((u): u is string => Boolean(u)))
  );

  const loadOne = async (rawUrl: string): Promise<HTMLImageElement | null> => {
    const resolved = await authedMediaUrl(rawUrl);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (img: HTMLImageElement | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(img);
      };
      const timer = window.setTimeout(() => finish(null), 15000);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = resolved;
    });
  };

  await Promise.all(
    uniqueUrls.map(async (raw) => {
      const img = await loadOne(raw);
      if (img) images.set(raw, img);
    })
  );

  const deskTexture = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = STUDIO_BACKDROPS.archivalDesk;
  });

  return { images, deskTexture };
}

export async function preloadBeatVideos(
  beats: StoryboardBeat[]
): Promise<Map<string, HTMLVideoElement>> {
  const videos = new Map<string, HTMLVideoElement>();
  const uniqueUrls = Array.from(
    new Set(beats.map((b) => b.heroVideoUrl).filter((u): u is string => Boolean(u)))
  );
  if (uniqueUrls.length === 0) return videos;

  const loadOne = async (rawUrl: string): Promise<HTMLVideoElement | null> => {
    const resolved = await authedVideoProxyUrl(rawUrl);
    if (!resolved) return null;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (el: HTMLVideoElement | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(el);
      };
      const timer = window.setTimeout(() => finish(null), 12000);
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.onloadeddata = () => finish(vid);
      vid.onerror = () => finish(null);
      vid.src = resolved;
      vid.load();
    });
  };

  await Promise.all(
    uniqueUrls.map(async (raw) => {
      const vid = await loadOne(raw);
      if (vid) videos.set(raw, vid);
    })
  );

  return videos;
}

export async function seekVideoElement(video: HTMLVideoElement, targetSec: number): Promise<void> {
  if (!Number.isFinite(targetSec) || video.readyState < 2) return;
  const dur = Number.isFinite(video.duration) && video.duration > 0.2 ? video.duration : 10;
  const safeTarget = Math.max(0, Math.min(dur - 0.04, targetSec % dur));
  if (Math.abs(video.currentTime - safeTarget) < 0.025) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = window.setTimeout(done, 240);
    video.addEventListener('seeked', done, { once: true });
    try {
      video.currentTime = safeTarget;
    } catch {
      done();
    }
  });
}

async function decodeMasterNarrationAudio(audioUrl: string): Promise<AudioBuffer | null> {
  try {
    const resolved = await authedMediaUrl(audioUrl);
    if (!resolved) return null;
    const resp = await fetch(resolved, { credentials: 'include', cache: 'no-store' });
    if (!resp.ok) return null;
    const rawBuf = await resp.arrayBuffer();
    if (rawBuf.byteLength < 64) return null;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(rawBuf.slice(0));
      // Resample to standard 48 kHz for universal WebCodecs AAC + MP4 player compatibility
      const targetRate = 48000;
      const targetChannels = Math.min(2, Math.max(1, decoded.numberOfChannels));
      if (decoded.sampleRate === targetRate && decoded.numberOfChannels === targetChannels) {
        return decoded;
      }
      const offline = new OfflineAudioContext(
        targetChannels,
        Math.max(1, Math.ceil(decoded.duration * targetRate)),
        targetRate
      );
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      return await offline.startRendering();
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

function captureQaThumbnail(sourceCanvas: HTMLCanvasElement, targetWidth = 480): string {
  const aspect = sourceCanvas.height / Math.max(1, sourceCanvas.width);
  const thumb = document.createElement('canvas');
  thumb.width = targetWidth;
  thumb.height = Math.max(180, Math.round(targetWidth * aspect));
  const tctx = thumb.getContext('2d');
  if (!tctx) return '';
  tctx.drawImage(sourceCanvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.82);
}

function isCanvasMostlyBlack(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    // Sample a fast 8x5 grid of pixels across the frame
    const sample = ctx.getImageData(0, 0, w, h).data;
    let brightCount = 0;
    const stepX = Math.max(1, Math.floor(w / 10));
    const stepY = Math.max(1, Math.floor(h / 6));
    let total = 0;
    for (let y = stepY; y < h; y += stepY) {
      for (let x = stepX; x < w; x += stepX) {
        const idx = (y * w + x) * 4;
        const luma = 0.299 * sample[idx] + 0.587 * sample[idx + 1] + 0.114 * sample[idx + 2];
        if (luma > 16) brightCount++;
        total++;
      }
    }
    return total > 0 && brightCount / total < 0.08;
  } catch {
    return false;
  }
}

/**
 * Deterministically renders every frame of the continuous CineForge visual world
 * at exact timestamps using WebCodecs H.264 (+ AAC audio muxing when supported) + mp4-muxer,
 * returning a compact broadcast-ready MP4 Blob along with captured QA keyframes.
 */
export async function renderDeterministicVideoBlob(
  params: DeterministicRenderParams
): Promise<DeterministicRenderOutput> {
  const { project, beats, fps, onProgress } = params;
  // Preserve exact aspect ratio (e.g., 2560x1080 -> 1920x810) while capping browser canvas size for encoder stability
  const fitScale = Math.min(1, 1920 / Math.max(1, params.width), 1080 / Math.max(1, params.height));
  const renderW = Math.max(640, Math.round((params.width * fitScale) / 2) * 2);
  const renderH = Math.max(360, Math.round((params.height * fitScale) / 2) * 2);

  const lastBeatEnd = beats.length > 0 ? Math.max(...beats.map((b) => b.endMs)) : 8000;
  const durationMs = Math.max(3000, project.masterAudio?.durationMs || lastBeatEnd);
  const totalFrames = Math.max(fps * 3, Math.ceil((durationMs / 1000) * fps));

  onProgress('Loading verified visual assets, video clips & mastering narration + music mix...', 6);
  const [{ images, deskTexture }, videos, rawDecodedAudio] = await Promise.all([
    preloadBeatImages(beats),
    preloadBeatVideos(beats),
    project.masterAudio?.audioUrl ? decodeMasterNarrationAudio(project.masterAudio.audioUrl) : Promise.resolve(null),
  ]);

  let decodedAudio = rawDecodedAudio;
  const mixer = project.audioMixer || {
    voiceVolume: 1.0,
    musicVolume: 0.24,
    sfxVolume: 0.48,
    ambientBed: 'historically_upbeat' as const,
    autoDucking: true,
    duckingDepthDb: 10,
  };
  const sfxEvents = beats
    .filter((b) => b.sfxCue && b.sfxCue !== 'none')
    .map((b) => ({ timeMs: b.startMs, cue: b.sfxCue }));

  if (rawDecodedAudio || mixer.ambientBed !== 'none' || sfxEvents.length > 0) {
    try {
      const mixed = await renderMixedMasterAudioBuffer({
        voiceBuffer: rawDecodedAudio,
        durationSec: durationMs / 1000,
        mixer,
        sfxEvents,
      });
      if (mixed) decodedAudio = mixed;
    } catch (mixErr) {
      console.warn('Browser audio mix fallback to dry narration:', mixErr);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = renderW;
  canvas.height = renderH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for rendering.');

  const worldConfig = {
    width: renderW,
    height: renderH,
    worldEnvironment: project.worldEnvironment || 'desk',
    videoStylePreset: project.videoStylePreset || 'historically',
    projectTitle: project.title,
    visualDirection: project.visualDirection,
    beats,
    images,
    videos,
    deskTexture,
    totalDurationMs: durationMs,
    showSafeGuides: false,
  };

  const qaTargets = [
    { frame: Math.max(1, Math.floor(totalFrames * 0.08)), label: 'Opening Frame' },
    { frame: Math.max(2, Math.floor(totalFrames * 0.34)), label: 'Transition Check 1' },
    { frame: Math.max(3, Math.floor(totalFrames * 0.64)), label: 'Transition Check 2' },
    { frame: Math.max(4, Math.floor(totalFrames * 0.88)), label: 'Closing Sequence' },
  ];
  const qaFrames: Array<{ timeSec: number; label: string; dataUrl: string }> = [];
  let blackFramesDetected = 0;

  // Path A: True deterministic offline WebCodecs H.264 (+ AAC audio) + mp4-muxer
  const canUseWebCodecs =
    typeof (window as any).VideoEncoder !== 'undefined' && typeof (window as any).VideoFrame !== 'undefined';

  if (canUseWebCodecs) {
    try {
      // Check if browser WebCodecs AudioEncoder supports AAC so the MP4 is self-contained with audio
      let useAudioMux = false;
      const canUseAudioEncoder =
        Boolean(decodedAudio) &&
        typeof (window as any).AudioEncoder !== 'undefined' &&
        typeof (window as any).AudioData !== 'undefined';

      if (canUseAudioEncoder && decodedAudio) {
        try {
          const audioSupport = await (window as any).AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2',
            numberOfChannels: decodedAudio.numberOfChannels,
            sampleRate: decodedAudio.sampleRate,
            bitrate: 128_000,
          });
          useAudioMux = Boolean(audioSupport?.supported);
        } catch {
          useAudioMux = false;
        }
      }

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width: renderW,
          height: renderH,
          frameRate: fps,
        },
        ...(useAudioMux && decodedAudio
          ? {
              audio: {
                codec: 'aac' as const,
                numberOfChannels: decodedAudio.numberOfChannels,
                sampleRate: decodedAudio.sampleRate,
              },
            }
          : {}),
        fastStart: 'in-memory',
      });

      let encodeError: Error | null = null;
      const encoder = new (window as any).VideoEncoder({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (err: any) => {
          encodeError = err instanceof Error ? err : new Error(String(err));
        },
      });

      // Balanced archival documentary bitrate (~1.5 Mbps @ 1080p) keeps exports compact & crisp
      const targetBitrate = renderW * renderH > 1920 * 1080 ? 2_100_000 : 1_500_000;
      const codecCandidates = ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
      let configured = false;
      for (const codec of codecCandidates) {
        const support = await (window as any).VideoEncoder.isConfigSupported({
          codec,
          width: renderW,
          height: renderH,
          bitrate: targetBitrate,
          framerate: fps,
        });
        if (support?.supported) {
          encoder.configure({
            codec,
            width: renderW,
            height: renderH,
            bitrate: targetBitrate,
            framerate: fps,
          });
          configured = true;
          break;
        }
      }

      if (configured) {
        onProgress(`Rendering ${totalFrames} deterministic frames (${renderW}x${renderH} @ ${fps} FPS)...`, 12);
        const frameDurationUs = Math.round(1_000_000 / fps);
        const qaTargetMap = new Map(qaTargets.map((t) => [t.frame, t.label]));
        const blackSampleInterval = Math.max(1, Math.floor(fps * 2));

        for (let f = 0; f < totalFrames; f++) {
          if (encodeError) throw encodeError;
          const timeMs = (f / fps) * 1000;
          const { beat: activeBeat } = getActiveBeatAtTime(beats, timeMs);
          if (activeBeat?.sceneType === 'archival_video' && activeBeat.heroVideoUrl) {
            const vidEl = videos.get(activeBeat.heroVideoUrl);
            if (vidEl) {
              const targetSec =
                (activeBeat.videoStartOffsetSec || 0) + Math.max(0, timeMs - activeBeat.startMs) / 1000;
              await seekVideoElement(vidEl, targetSec);
            }
          }
          renderWorldFrame(ctx, timeMs, worldConfig);

          const qaLabel = qaTargetMap.get(f);
          if (qaLabel) {
            const dataUrl = captureQaThumbnail(canvas);
            if (dataUrl) {
              qaFrames.push({
                timeSec: Number((timeMs / 1000).toFixed(2)),
                label: qaLabel,
                dataUrl,
              });
            }
          }
          if (f % blackSampleInterval === 0 && isCanvasMostlyBlack(ctx, renderW, renderH)) {
            blackFramesDetected++;
          }

          const videoFrame = new (window as any).VideoFrame(canvas, {
            timestamp: f * frameDurationUs,
            duration: frameDurationUs,
          });
          encoder.encode(videoFrame, { keyFrame: f % (fps * 2) === 0 });
          videoFrame.close();

          if (f % Math.max(4, Math.floor(totalFrames / 30)) === 0) {
            const pct = 12 + Math.round((f / totalFrames) * 46);
            onProgress(`Rendering frame ${f + 1} / ${totalFrames}`, pct);
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        await encoder.flush();
        encoder.close();

        let audioMuxSucceeded = false;
        if (useAudioMux && decodedAudio) {
          onProgress('Encoding mastered AAC narration audio track...', 60);
          try {
            let audioEncodeErr: Error | null = null;
            const audioEncoder = new (window as any).AudioEncoder({
              output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
              error: (err: any) => {
                audioEncodeErr = err instanceof Error ? err : new Error(String(err));
              },
            });

            audioEncoder.configure({
              codec: 'mp4a.40.2',
              numberOfChannels: decodedAudio.numberOfChannels,
              sampleRate: decodedAudio.sampleRate,
              bitrate: 128_000,
            });

            const numChannels = decodedAudio.numberOfChannels;
            const sampleRate = decodedAudio.sampleRate;
            const totalSamples = decodedAudio.length;
            const chunkSamples = 4096;
            const channels: Float32Array[] = [];
            for (let c = 0; c < numChannels; c++) {
              channels.push(decodedAudio.getChannelData(c));
            }

            for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
              if (audioEncodeErr) throw audioEncodeErr;
              const framesInChunk = Math.min(chunkSamples, totalSamples - offset);
              const planar = new Float32Array(framesInChunk * numChannels);
              for (let c = 0; c < numChannels; c++) {
                planar.set(channels[c].subarray(offset, offset + framesInChunk), c * framesInChunk);
              }
              const timestampUs = Math.round((offset / sampleRate) * 1_000_000);
              const audioData = new (window as any).AudioData({
                format: 'f32-planar',
                sampleRate,
                numberOfFrames: framesInChunk,
                numberOfChannels: numChannels,
                timestamp: timestampUs,
                data: planar,
              });
              audioEncoder.encode(audioData);
              audioData.close();
            }

            await audioEncoder.flush();
            audioEncoder.close();
            if (!audioEncodeErr) {
              audioMuxSucceeded = true;
            }
          } catch (audioErr) {
            console.warn('Browser AAC mux skipped (server FFmpeg will mux audio):', audioErr);
          }
        }

        muxer.finalize();

        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        if (blob.size > 1024) {
          return {
            blob,
            mimeType: 'video/mp4',
            totalFrames,
            durationMs,
            width: renderW,
            height: renderH,
            hasAudio: audioMuxSucceeded,
            audioSampleRate: audioMuxSucceeded ? decodedAudio?.sampleRate : undefined,
            qaFrames,
            blackFramesDetected,
          };
        }
      }
    } catch (err) {
      console.warn('WebCodecs path fallback to MediaRecorder:', err);
    }
  }

  // Path B: Reliable MediaRecorder canvas capture fallback (encoded into H.264 MP4 on server via FFmpeg)
  onProgress('Capturing visual sequence stream for FFmpeg MP4 encoding...', 15);
  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_200_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start(250);
  const startWall = performance.now();

  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsed = performance.now() - startWall;
      const t = Math.min(elapsed, durationMs);
      renderWorldFrame(ctx, t, worldConfig);
      const pct = 15 + Math.round((t / durationMs) * 49);
      onProgress(`Recording timeline ${(t / 1000).toFixed(1)}s / ${(durationMs / 1000).toFixed(1)}s`, pct);
      if (elapsed < durationMs) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  const blob = await stopped;
  return {
    blob,
    mimeType,
    totalFrames,
    durationMs,
    width: renderW,
    height: renderH,
    hasAudio: false,
    qaFrames,
    blackFramesDetected,
  };
}
