import { execFile } from 'child_process';
import dotenv from 'dotenv';
import express, { type Response } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import { requireAuth, type AuthRequest } from './src/server/middleware/auth.ts';
import { ArchivalAssetService, isAllowedArchivalUrl } from './src/server/services/archivalAssetService.ts';
import {
  concatenateWavBuffers,
  LocalFileStorageService,
} from './src/server/services/fileStorageService.ts';
import {
  GeminiAudioAnalysisService,
  GeminiResearchService,
  GeminiScriptService,
  GeminiStoryboardService,
} from './src/server/services/researchAndScriptService.ts';
import { FfmpegVideoRenderingService } from './src/server/services/videoRenderingService.ts';
import { VoiceServiceRegistry } from './src/server/services/voiceService.ts';
import { getGeminiErrorStatus } from './src/server/services/geminiClient.ts';
import { EditorialIllustrationService } from './src/server/services/illustrationService.ts';
import { AnimatedRigGenerationService } from './src/server/services/animatedRigService.ts';
import { BeatMediaFulfillmentService } from './src/server/services/beatMediaFulfillmentService.ts';
import {
  VIDEO_STYLE_PRESETS,
  type AudioMixerSettings,
  type SfxCueType,
  type VideoStylePresetId,
} from './src/types/cineforge.ts';

dotenv.config();

const execFileAsync = promisify(execFile);

// Dependency-injected domain services
const fileStorage = new LocalFileStorageService();
const researchService = new GeminiResearchService();
const assetService = new ArchivalAssetService();
const beatFulfillmentService = new BeatMediaFulfillmentService(assetService);
const scriptService = new GeminiScriptService();
const voiceRegistry = new VoiceServiceRegistry();
const audioAnalysisService = new GeminiAudioAnalysisService();
const storyboardService = new GeminiStoryboardService();
const videoRenderingService = new FfmpegVideoRenderingService(fileStorage);
const illustrationService = new EditorialIllustrationService();

// SSE client registry per project
const sseClients = new Map<string, Set<Response>>();

function emitProjectEvent(projectId: string, eventType: string, payload: Record<string, unknown>) {
  const clients = sseClients.get(projectId);
  if (!clients || clients.size === 0) return;
  const line = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 }, // up to 120MB for rendered video or voiceover audio
});

interface CachedArchivalImage {
  buffer: Buffer;
  contentType: string;
  cachedAt: number;
}

type ArchivalImageFetchResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; status: number; error: string };

const IMAGE_CACHE_MAX_ENTRIES = 120;
const IMAGE_CACHE_MAX_BYTES = 45 * 1024 * 1024;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const archivalImageCache = new Map<string, CachedArchivalImage>();
let archivalImageCacheBytes = 0;
const inFlightImageFetches = new Map<string, Promise<ArchivalImageFetchResult>>();

function getCachedArchivalImage(url: string): CachedArchivalImage | null {
  const hit = archivalImageCache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > IMAGE_CACHE_TTL_MS) {
    archivalImageCache.delete(url);
    archivalImageCacheBytes = Math.max(0, archivalImageCacheBytes - hit.buffer.length);
    return null;
  }
  // Refresh LRU order
  archivalImageCache.delete(url);
  archivalImageCache.set(url, hit);
  return hit;
}

function setCachedArchivalImage(url: string, buffer: Buffer, contentType: string): void {
  if (buffer.length > 8 * 1024 * 1024) return; // skip caching unusually huge images
  const existing = archivalImageCache.get(url);
  if (existing) {
    archivalImageCache.delete(url);
    archivalImageCacheBytes = Math.max(0, archivalImageCacheBytes - existing.buffer.length);
  }
  while (
    archivalImageCache.size >= IMAGE_CACHE_MAX_ENTRIES ||
    archivalImageCacheBytes + buffer.length > IMAGE_CACHE_MAX_BYTES
  ) {
    const oldestKey = archivalImageCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = archivalImageCache.get(oldestKey);
    archivalImageCache.delete(oldestKey);
    if (oldest) {
      archivalImageCacheBytes = Math.max(0, archivalImageCacheBytes - oldest.buffer.length);
    }
  }
  archivalImageCache.set(url, { buffer, contentType, cachedAt: Date.now() });
  archivalImageCacheBytes += buffer.length;
}

async function fetchArchivalImageWithRetry(targetUrl: string): Promise<ArchivalImageFetchResult> {
  const maxAttempts = 2;
  let lastStatus = 504;
  let lastError = 'Archival image host timed out.';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'CineForgeDocumentaryStudio/1.0 (https://cineforge.studio; archival-viewer)',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(22000),
      });

      if (!upstream.ok) {
        lastStatus = upstream.status === 429 || upstream.status >= 500 ? 502 : upstream.status;
        lastError = `Source archive returned HTTP ${upstream.status}.`;
        if ((upstream.status === 429 || upstream.status >= 500) && attempt + 1 < maxAttempts) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        return { ok: false, status: lastStatus, error: lastError };
      }

      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return { ok: false, status: 415, error: 'Upstream archive did not return an image.' };
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length === 0) {
        return { ok: false, status: 502, error: 'Upstream archive returned an empty image.' };
      }
      setCachedArchivalImage(targetUrl, buffer, contentType);
      return { ok: true, buffer, contentType };
    } catch (err: any) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      lastStatus = isTimeout ? 504 : 502;
      lastError = isTimeout
        ? 'Archival image host timed out.'
        : 'Archival image temporarily unavailable.';
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      console.warn(`Archival image proxy ${isTimeout ? 'timeout' : 'fetch warning'} for ${targetUrl}`);
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

function fetchArchivalImageDeduped(targetUrl: string): Promise<ArchivalImageFetchResult> {
  const existing = inFlightImageFetches.get(targetUrl);
  if (existing) return existing;
  const promise = fetchArchivalImageWithRetry(targetUrl).finally(() => {
    inFlightImageFetches.delete(targetUrl);
  });
  inFlightImageFetches.set(targetUrl, promise);
  return promise;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '12mb' }));

  // --- Health & Provider Capabilities (Read-Only, No Keys Exposed) ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'CineForge Studio API' });
  });

  app.get('/api/providers/status', requireAuth, async (_req, res) => {
    let ffmpegAvailable = false;
    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
      ffmpegAvailable = true;
    } catch {
      ffmpegAvailable = false;
    }
    res.json({
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      voiceProviders: voiceRegistry.getProviderStatus(),
      archivalProviders: {
        wikimedia: true,
        libraryOfCongress: true,
        nasa: true,
      },
      ffmpegAvailable,
    });
  });

  // --- Real-Time SSE Progress Stream ---
  app.get('/api/events/:projectId', requireAuth, (req: AuthRequest, res) => {
    const projectId = String(req.params.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectId) {
      return res.status(400).json({ error: 'Invalid projectId' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ projectId })}\n\n`);

    if (!sseClients.has(projectId)) {
      sseClients.set(projectId, new Set());
    }
    sseClients.get(projectId)!.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.get(projectId)?.delete(res);
    });
  });

  // --- Stage 1: Autonomous Research + Archival Photo Discovery ---
  app.post('/api/research', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, topic, scriptContext, language, researchPreferences, referenceTexts } = req.body || {};
      if (!topic || typeof topic !== 'string' || !topic.trim()) {
        return res.status(400).json({ error: 'A documentary topic is required for autonomous research.' });
      }
      if (projectId) {
        emitProjectEvent(projectId, 'progress', { stage: 'Running Gemini Search Grounding & archival verification...', progress: 22 });
      }

      const research = await researchService.researchTopic({
        topic: topic.trim(),
        scriptContext: typeof scriptContext === 'string' ? scriptContext : undefined,
        language: typeof language === 'string' ? language : 'English',
        researchPreferences: typeof researchPreferences === 'string' ? researchPreferences : undefined,
        referenceTexts: Array.isArray(referenceTexts) ? referenceTexts : undefined,
      });

      if (projectId) {
        emitProjectEvent(projectId, 'progress', { stage: 'Querying Wikimedia Commons, Library of Congress, and NASA archives...', progress: 65 });
      }

      const discoveredAssets = await assetService.discoverArchivalAssets({
        queries: research.imageSearchQueries,
        topic: topic.trim(),
      });

      if (projectId) {
        emitProjectEvent(projectId, 'progress', { stage: 'Research dossier and authentic archival collection ready.', progress: 100 });
      }

      res.json({
        summary: research.summary,
        entities: research.entities,
        sources: research.sources,
        visualDirection: research.visualDirection,
        assets: discoveredAssets,
      });
    } catch (error: any) {
      console.error('Research error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Autonomous research failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  // --- Live Archival Photo & Public Video Search (Wikimedia, LOC, NASA) ---
  app.get('/api/archive/search', requireAuth, async (req: AuthRequest, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) return res.status(400).json({ error: 'Search query is required.' });
      const rawProviders = typeof req.query.providers === 'string' ? req.query.providers.split(',') : ['wikimedia', 'loc', 'nasa'];
      const valid = rawProviders.filter((p): p is 'wikimedia' | 'loc' | 'nasa' =>
        p === 'wikimedia' || p === 'loc' || p === 'nasa'
      );
      const rawKind = typeof req.query.mediaKind === 'string' ? req.query.mediaKind : 'image';
      const mediaKind: 'image' | 'video' | 'all' =
        rawKind === 'video' || rawKind === 'all' ? rawKind : 'image';
      const results = await assetService.searchArchive(
        q,
        valid.length ? valid : ['wikimedia', 'loc', 'nasa'],
        mediaKind
      );
      res.json({ assets: results });
    } catch (error: any) {
      console.error('Archive search error:', error);
      res.status(500).json({ error: error?.message || 'Archive search failed.' });
    }
  });

  // --- SSRF-Safe Host-Allowlisted Archival Image Proxy (for clean Canvas rendering) ---
  app.get('/api/proxy/image', requireAuth, async (req: AuthRequest, res) => {
    try {
      const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
      if (!targetUrl || !isAllowedArchivalUrl(targetUrl)) {
        return res.status(403).json({ error: 'Image URL is not on the verified archival host allowlist.' });
      }

      const cached = getCachedArchivalImage(targetUrl);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(cached.buffer);
      }

      const result = await fetchArchivalImageDeduped(targetUrl);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(result.buffer);
    } catch (err: any) {
      console.warn('Archival image proxy warning:', err?.name || err?.message || err);
      res.status(504).json({ error: 'Archival image temporarily unavailable.' });
    }
  });

  // --- SSRF-Safe Range-Capable Media Proxy for Public Archival Video Clips & Images (CORS-Clean Canvas) ---
  const handleArchivalMediaProxy = async (req: AuthRequest, res: express.Response) => {
    try {
      const targetUrl = typeof req.query.url === 'string' ? req.query.url : '';
      if (!targetUrl || !isAllowedArchivalUrl(targetUrl)) {
        return res.status(403).json({ error: 'Media URL is not on the verified archival host allowlist.' });
      }

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'CineForgeDocumentaryStudio/1.0 (https://cineforge.studio; archival-media-proxy)',
      };
      if (typeof req.headers.range === 'string' && req.headers.range.startsWith('bytes=')) {
        upstreamHeaders.Range = req.headers.range;
      }

      const upstream = await fetch(targetUrl, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(25000),
      });

      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
          error: `Source archival media returned HTTP ${upstream.status}.`,
        });
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const allowedMediaType =
        contentType.startsWith('video/') ||
        contentType.startsWith('image/') ||
        contentType.includes('ogg') ||
        contentType.includes('mp4') ||
        contentType.includes('webm');
      if (!allowedMediaType) {
        return res.status(415).json({ error: 'Upstream archive did not return supported image or video media.' });
      }

      res.status(upstream.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      if (req.method === 'HEAD' || !upstream.body) {
        return res.end();
      }

      // Stream response in chunks (staying safe below Cloud Run 32 MB buffer ceiling)
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const ok = res.write(Buffer.from(value));
            if (!ok) {
              await new Promise<void>((resolve) => res.once('drain', resolve));
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        console.warn('Archival media proxy warning:', err?.name || err?.message || err);
        res.status(504).json({ error: 'Archival media stream temporarily unavailable.' });
      } else {
        res.end();
      }
    }
  };
  app.get('/api/media/proxy', requireAuth, handleArchivalMediaProxy);
  app.head('/api/media/proxy', requireAuth, handleArchivalMediaProxy);

  // --- Stage 2: Script Studio ---
  app.post('/api/script/generate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, topic, existingScript, researchSummary, entities, targetDurationSec, language, narrationStyle } = req.body || {};
      if (!topic && !existingScript) {
        return res.status(400).json({ error: 'Topic or existing script is required.' });
      }
      if (projectId) {
        emitProjectEvent(String(projectId), 'script_progress', {
          stepIndex: 1,
          progress: 38,
          stage: 'Drafting spoken documentary narration segments with Gemini...',
        });
      }
      const result = await scriptService.generateOrRefineScript({
        topic: String(topic || 'Documentary Production'),
        existingScript: typeof existingScript === 'string' ? existingScript : undefined,
        researchSummary: typeof researchSummary === 'string' ? researchSummary : undefined,
        entities,
        targetDurationSec: Number(targetDurationSec) || 90,
        language: String(language || 'English'),
        narrationStyle: typeof narrationStyle === 'string' ? narrationStyle : undefined,
      });
      if (projectId) {
        emitProjectEvent(String(projectId), 'script_progress', {
          stepIndex: 2,
          progress: 78,
          stage: `Generated ${result.paragraphs.length} segments (${result.wordCount} words). Saving script version...`,
        });
      }
      res.json(result);
    } catch (error: any) {
      console.error('Script generation error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Script generation failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/script/regenerate-paragraph', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { topic, paragraph, surroundingContext, instruction, language } = req.body || {};
      if (!paragraph?.text) {
        return res.status(400).json({ error: 'Paragraph content is required.' });
      }
      const updated = await scriptService.regenerateParagraph({
        topic: String(topic || ''),
        paragraph,
        surroundingContext: String(surroundingContext || ''),
        instruction: String(instruction || ''),
        language: String(language || 'English'),
      });
      res.json({ paragraph: updated });
    } catch (error: any) {
      console.error('Paragraph regen error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Paragraph regeneration failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  // --- Stage 3: Voice Studio (Highest Priority) ---
  app.post('/api/voice/sample', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, text, voiceProfile, pronunciationHint, postProcessing } = req.body || {};
      if (!projectId || !text || !voiceProfile) {
        return res.status(400).json({ error: 'projectId, text, and voiceProfile are required.' });
      }
      const provider = voiceRegistry.getProvider(voiceProfile.provider || 'gemini');
      const result = await provider.synthesize({
        text: String(text).slice(0, 1500),
        voiceProfile,
        pronunciationHint,
        postProcessing,
      });

      const saved = await fileStorage.saveFile({
        ownerId: req.user!.uid,
        projectId: String(projectId),
        folder: 'audio',
        fileName: `sample_${Date.now()}.wav`,
        buffer: result.audioBuffer,
      });

      res.json({
        audioUrl: saved.publicUrl,
        durationMs: result.durationMs,
        sampleRate: result.sampleRate,
        providerUsed: provider.providerName,
      });
    } catch (error: any) {
      console.error('Voice sample error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Voice sample synthesis failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/voice/generate-segment', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, segmentIndex, text, voiceProfile, pronunciationHint, postProcessing } = req.body || {};
      if (!projectId || !text || !voiceProfile) {
        return res.status(400).json({ error: 'projectId, text, and voiceProfile are required.' });
      }
      const provider = voiceRegistry.getProvider(voiceProfile.provider || 'gemini');
      const result = await provider.synthesize({
        text: String(text).slice(0, 3500),
        voiceProfile,
        pronunciationHint,
        postProcessing,
      });

      const saved = await fileStorage.saveFile({
        ownerId: req.user!.uid,
        projectId: String(projectId),
        folder: 'audio',
        fileName: `seg_${Number(segmentIndex) || 0}_${Date.now()}.wav`,
        buffer: result.audioBuffer,
      });

      const analysis = await audioAnalysisService.analyzeAudioBuffer({
        buffer: result.audioBuffer,
        mimeType: 'audio/wav',
        knownScriptSegments: [{ text: String(text), durationMs: result.durationMs }],
      });

      res.json({
        audioUrl: saved.publicUrl,
        durationMs: result.durationMs,
        sampleRate: result.sampleRate,
        providerUsed: provider.providerName,
        wordTimestamps: analysis.segments[0]?.wordTimestamps || [],
        pauseMarkers: analysis.segments[0]?.pauseMarkers || [],
      });
    } catch (error: any) {
      console.error('Segment synthesis error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Segment voice synthesis failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  // --- Stage 4: Master Audio Assembly & Timestamp Analysis ---
  app.post('/api/voice/assemble-master', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, segments } = req.body || {};
      if (!projectId || !Array.isArray(segments) || segments.length === 0) {
        return res.status(400).json({ error: 'Project ID and generated narration segments are required.' });
      }

      const ownerId = req.user!.uid;
      const wavBuffers: Buffer[] = [];
      for (const seg of segments) {
        const audioUrl: string = seg.audioUrl || '';
        const match = audioUrl.match(/\/api\/media\/file\/([^/]+)\/([^/]+)\/(audio|uploads|renders)\/([^/?]+)/);
        if (!match) {
          return res.status(400).json({ error: `Segment "${seg.orderIndex}" does not have a saved audio file yet.` });
        }
        const fileOwner = decodeURIComponent(match[1]);
        if (fileOwner !== ownerId) {
          return res.status(403).json({ error: 'Unauthorized audio segment reference.' });
        }
        const relPath = path.posix.join(
          fileOwner,
          decodeURIComponent(match[2]),
          match[3],
          decodeURIComponent(match[4])
        );
        wavBuffers.push(await fileStorage.readFile(relPath));
      }

      const merged = concatenateWavBuffers(wavBuffers, 280);
      const savedMaster = await fileStorage.saveFile({
        ownerId,
        projectId: String(projectId),
        folder: 'audio',
        fileName: `master_narration_${Date.now()}.wav`,
        buffer: merged.wavBuffer,
      });

      const analysis = await audioAnalysisService.analyzeAudioBuffer({
        buffer: merged.wavBuffer,
        mimeType: 'audio/wav',
        knownScriptSegments: segments.map((s: any, idx: number) => ({
          id: s.id,
          text: s.text,
          durationMs: merged.segmentOffsets[idx]?.durationMs || s.durationMs,
        })),
      });

      res.json({
        masterAudio: {
          audioUrl: savedMaster.publicUrl,
          durationMs: merged.totalDurationMs,
          sampleRate: merged.sampleRate,
          isUploadedOriginal: false,
          waveformPeaks: analysis.waveformPeaks,
          analyzedAt: new Date().toISOString(),
        },
        analyzedSegments: analysis.segments,
      });
    } catch (error: any) {
      console.error('Master audio assembly error:', error);
      res.status(500).json({ error: error?.message || 'Failed to assemble and analyze master audio.' });
    }
  });

  // --- Mode C: Upload Existing Voiceover + Transcribe & Extract Timestamps ---
  app.post('/api/audio/upload-and-analyze', requireAuth, upload.single('audio'), async (req: AuthRequest, res) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cineforge-vo-'));
    try {
      const file = req.file;
      const projectId = String(req.body?.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!file || !projectId) {
        return res.status(400).json({ error: 'Audio file and projectId are required.' });
      }
      if (!file.mimetype.startsWith('audio/') && !file.originalname.match(/\.(wav|mp3|m4a|ogg|webm|flac)$/i)) {
        return res.status(415).json({ error: 'Unsupported file type. Please upload WAV, MP3, M4A, OGG, or WebM audio.' });
      }

      // Normalize uploaded voiceover into a clean 24kHz mono WAV for uniform analysis & mastering,
      // while preserving the speaker's exact recorded voice.
      const inExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '.audio';
      const inPath = path.join(tmpDir, `upload${inExt}`);
      const outWavPath = path.join(tmpDir, 'normalized.wav');
      await fs.writeFile(inPath, file.buffer);

      let wavBuffer = file.buffer;
      try {
        await execFileAsync('ffmpeg', ['-y', '-i', inPath, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', outWavPath], {
          timeout: 45000,
        });
        wavBuffer = await fs.readFile(outWavPath);
      } catch (err) {
        console.warn('Uploaded audio direct passthrough (FFmpeg convert skipped):', err);
      }

      const saved = await fileStorage.saveFile({
        ownerId: req.user!.uid,
        projectId,
        folder: 'audio',
        fileName: `uploaded_voiceover_${Date.now()}.wav`,
        buffer: wavBuffer,
      });

      const analysis = await audioAnalysisService.analyzeAudioBuffer({
        buffer: wavBuffer,
        mimeType: 'audio/wav',
      });

      res.json({
        masterAudio: {
          audioUrl: saved.publicUrl,
          durationMs: analysis.durationMs,
          sampleRate: analysis.sampleRate,
          isUploadedOriginal: true,
          waveformPeaks: analysis.waveformPeaks,
          analyzedAt: new Date().toISOString(),
        },
        transcript: analysis.transcript,
        analyzedSegments: analysis.segments,
      });
    } catch (error: any) {
      console.error('Upload voiceover error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Failed to analyze uploaded voiceover.');
      res.status(statusCode).json({ error: message });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // --- Reference / Image / PDF / Text File Upload ---
  app.post('/api/uploads/reference', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      const projectId = String(req.body?.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!file || !projectId) {
        return res.status(400).json({ error: 'File and projectId are required.' });
      }
      const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown',
      ];
      if (!allowedMimes.includes(file.mimetype)) {
        return res.status(415).json({ error: 'Allowed uploads: JPEG, PNG, WebP, PDF, TXT, or Markdown files.' });
      }

      const safeName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const saved = await fileStorage.saveFile({
        ownerId: req.user!.uid,
        projectId,
        folder: 'uploads',
        fileName: safeName,
        buffer: file.buffer,
      });

      let extractedText: string | undefined;
      if (file.mimetype === 'text/plain' || file.mimetype === 'text/markdown') {
        extractedText = file.buffer.toString('utf8').slice(0, 8000);
      }

      res.json({
        id: `ref_${Date.now().toString(36)}`,
        name: file.originalname.slice(0, 140),
        mimeType: file.mimetype,
        sizeBytes: saved.sizeBytes,
        url: saved.publicUrl,
        extractedText,
      });
    } catch (error: any) {
      console.error('Reference upload error:', error);
      res.status(500).json({ error: error?.message || 'File upload failed.' });
    }
  });

  // --- Stage 4: Storyboard-First Shot Blueprint Generation (Asset-Agnostic) ---
  app.post('/api/storyboard/generate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { topic, researchSummary, worldEnvironment, videoStylePreset, visualDirection, segments, assets } = req.body || {};
      if (!Array.isArray(segments) || segments.length === 0) {
        return res.status(400).json({ error: 'Approved narration segments are required before generating a storyboard.' });
      }
      const presetId: VideoStylePresetId =
        typeof videoStylePreset === 'string' && videoStylePreset in VIDEO_STYLE_PRESETS
          ? (videoStylePreset as VideoStylePresetId)
          : 'historically';

      const beats = await storyboardService.generateStoryboard({
        topic: String(topic || 'Documentary'),
        researchSummary: typeof researchSummary === 'string' ? researchSummary.slice(0, 4000) : undefined,
        worldEnvironment: worldEnvironment || VIDEO_STYLE_PRESETS[presetId].defaultWorld,
        videoStylePreset: presetId,
        visualDirection,
        segments,
        assets: Array.isArray(assets) ? assets : [],
      });
      res.json({ beats });
    } catch (error: any) {
      console.error('Storyboard generation error:', error);
      const { statusCode, message } = getGeminiErrorStatus(error, 'Storyboard generation failed.');
      res.status(statusCode).json({ error: message });
    }
  });

  // --- Editorial Vector Illustration Generation (Free-Tier Gemini SVG + Procedural Vector Fallback) ---
  app.post('/api/illustrations/generate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, prompt, topic, stylePreset, dateBadge, title } = req.body || {};
      const safeProjectId = String(projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanPrompt = String(prompt || '').trim();
      if (!safeProjectId || !cleanPrompt) {
        return res.status(400).json({ error: 'projectId and illustration prompt are required.' });
      }
      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'ted_ed';

      const resolvedTitle = String(title || cleanPrompt.slice(0, 64)).slice(0, 160);
      const generated = await illustrationService.generateEditorialIllustrationSvg({
        prompt: cleanPrompt,
        title: resolvedTitle,
        topic: String(topic || cleanPrompt).slice(0, 140),
        stylePreset: presetId,
      });

      const fileName = `illus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.svg`;
      const saved = await fileStorage.saveFile({
        ownerId: req.user!.uid,
        projectId: safeProjectId,
        folder: 'uploads',
        fileName,
        buffer: Buffer.from(generated.svg, 'utf8'),
      });

      res.json({
        imageUrl: saved.publicUrl,
        thumbnailUrl: saved.publicUrl,
        title: resolvedTitle,
        generatedBy: generated.generatedBy,
        width: 1280,
        height: 720,
      });
    } catch (error: any) {
      console.error('Illustration generation error:', error);
      res.status(500).json({ error: error?.message || 'Illustration generation failed.' });
    }
  });

  app.post('/api/illustrations/batch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, topic, stylePreset, items } = req.body || {};
      const safeProjectId = String(projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeProjectId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'projectId and items array are required.' });
      }
      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'ted_ed';

      const limited = items.slice(0, 12);
      const results: Array<{
        beatId: string;
        imageUrl: string;
        thumbnailUrl: string;
        title: string;
        generatedBy: 'gemini_vector' | 'procedural_vector';
      }> = [];

      // Process in small batches of 3 to stay friendly with free-tier rate limits
      for (let i = 0; i < limited.length; i += 3) {
        const group = limited.slice(i, i + 3);
        const settled = await Promise.all(
          group.map(async (item: any) => {
            const beatId = String(item?.beatId || '');
            const prompt = String(item?.prompt || topic || 'Historical explainer scene').trim();
            const resolvedTitle = String(item?.title || prompt.slice(0, 64)).slice(0, 160);
            const generated = await illustrationService.generateEditorialIllustrationSvg({
              prompt,
              title: resolvedTitle,
              topic: String(topic || prompt).slice(0, 140),
              stylePreset: presetId,
            });
            const fileName = `illus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.svg`;
            const saved = await fileStorage.saveFile({
              ownerId: req.user!.uid,
              projectId: safeProjectId,
              folder: 'uploads',
              fileName,
              buffer: Buffer.from(generated.svg, 'utf8'),
            });
            return {
              beatId,
              imageUrl: saved.publicUrl,
              thumbnailUrl: saved.publicUrl,
              title: resolvedTitle,
              generatedBy: generated.generatedBy,
            };
          })
        );
        results.push(...settled);
        emitProjectEvent(safeProjectId, 'illustration_progress', {
          completed: results.length,
          total: limited.length,
        });
      }

      res.json({ results });
    } catch (error: any) {
      console.error('Batch illustration generation error:', error);
      res.status(500).json({ error: error?.message || 'Batch illustration generation failed.' });
    }
  });

  // --- Stage 4: Code-Driven Animated Character & Scene Rig Auto-Generator ---
  app.post('/api/assets/generate-animated-rigs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        projectId,
        topic,
        researchSummary,
        scriptParagraphs,
        existingAssetTitles,
        stylePreset,
        maxRigs,
      } = req.body || {};

      const cleanTopic = String(topic || '').trim();
      const paragraphs = Array.isArray(scriptParagraphs)
        ? scriptParagraphs
            .filter((p: any) => p && typeof p.text === 'string' && p.text.trim())
            .slice(0, 20)
            .map((p: any) => ({
              heading: typeof p.heading === 'string' ? p.heading.slice(0, 120) : undefined,
              text: String(p.text).slice(0, 1500),
              visualCue: typeof p.visualCue === 'string' ? p.visualCue.slice(0, 240) : undefined,
            }))
        : [];

      if (!cleanTopic && paragraphs.length === 0) {
        return res.status(400).json({ error: 'Topic or script paragraphs are required to generate animated rigs.' });
      }

      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'historically';

      if (projectId) {
        emitProjectEvent(String(projectId), 'progress', {
          stage: 'Analyzing script for missing animated characters & moving scenes...',
          progress: 35,
        });
      }

      const result = await AnimatedRigGenerationService.generateMissingRigsForScript({
        topic: cleanTopic || 'Modern Documentary',
        researchSummary: typeof researchSummary === 'string' ? researchSummary.slice(0, 3000) : undefined,
        scriptParagraphs:
          paragraphs.length > 0
            ? paragraphs
            : [{ heading: 'Documentary Overview', text: cleanTopic }],
        existingAssetTitles: Array.isArray(existingAssetTitles)
          ? existingAssetTitles.map((t: any) => String(t).slice(0, 100)).slice(0, 24)
          : [],
        stylePreset: presetId,
        maxRigs: Number(maxRigs) || 5,
      });

      if (projectId) {
        emitProjectEvent(String(projectId), 'progress', {
          stage: `Generated ${result.rigs.length} code-driven animated character & prop scenes.`,
          progress: 100,
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error('Animated rig generation error:', error);
      res.status(500).json({ error: error?.message || 'Failed to generate animated scene rigs.' });
    }
  });

  app.post('/api/assets/generate-single-rig', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { prompt, topic, stylePreset } = req.body || {};
      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        return res.status(400).json({ error: 'An animation scene prompt is required.' });
      }
      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'historically';

      const result = await AnimatedRigGenerationService.generateSingleRig({
        prompt: cleanPrompt.slice(0, 600),
        topic: typeof topic === 'string' ? topic.slice(0, 200) : undefined,
        stylePreset: presetId,
      });
      res.json(result);
    } catch (error: any) {
      console.error('Single animated rig generation error:', error);
      res.status(500).json({ error: error?.message || 'Failed to generate custom animated scene rig.' });
    }
  });

  // --- Stage 5: 1-to-1 Zero-Repeat Storyboard Beat Media & Animation Fulfillment ---
  app.post('/api/assets/fulfill-storyboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId, topic, researchSummary, stylePreset, beats, lockedBeatIds } = req.body || {};
      if (!Array.isArray(beats) || beats.length === 0) {
        return res.status(400).json({ error: 'Storyboard beats from Step 4 are required to fulfill beat visuals.' });
      }
      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'historically';

      const result = await beatFulfillmentService.fulfillStoryboardBeats({
        topic: String(topic || 'Documentary').slice(0, 400),
        researchSummary: typeof researchSummary === 'string' ? researchSummary.slice(0, 3000) : undefined,
        stylePreset: presetId,
        beats: beats.slice(0, 48),
        lockedBeatIds: Array.isArray(lockedBeatIds) ? lockedBeatIds.map(String) : [],
        onProgress: (completed, total, message) => {
          if (projectId) {
            emitProjectEvent(String(projectId), 'media_fulfillment_progress', {
              completed,
              total,
              progress: total > 0 ? Math.round((completed / total) * 100) : 100,
              stage: message,
            });
          }
        },
      });

      res.json(result);
    } catch (error: any) {
      console.error('Beat media fulfillment error:', error);
      res.status(500).json({ error: error?.message || 'Failed to fulfill storyboard beat visuals.' });
    }
  });

  app.post('/api/assets/fulfill-beat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        topic,
        stylePreset,
        beat,
        mode,
        customQueryOrPrompt,
        excludeUrls,
        excludeTitles,
        excludeRigSignatures,
      } = req.body || {};

      if (!beat || typeof beat !== 'object' || !beat.id) {
        return res.status(400).json({ error: 'A valid storyboard beat object is required.' });
      }
      const validModes = new Set(['photo', 'video', 'animated_rig', 'animated_map']);
      const resolvedMode = validModes.has(mode) ? mode : 'photo';
      const presetId: VideoStylePresetId =
        typeof stylePreset === 'string' && stylePreset in VIDEO_STYLE_PRESETS
          ? (stylePreset as VideoStylePresetId)
          : 'historically';

      const result = await beatFulfillmentService.fulfillSingleBeat({
        topic: String(topic || 'Documentary').slice(0, 400),
        stylePreset: presetId,
        beat,
        mode: resolvedMode,
        customQueryOrPrompt: typeof customQueryOrPrompt === 'string' ? customQueryOrPrompt.slice(0, 500) : undefined,
        excludeUrls: Array.isArray(excludeUrls) ? excludeUrls.map(String) : [],
        excludeTitles: Array.isArray(excludeTitles) ? excludeTitles.map(String) : [],
        excludeRigSignatures: Array.isArray(excludeRigSignatures) ? excludeRigSignatures.map(String) : [],
      });

      res.json(result);
    } catch (error: any) {
      console.error('Single beat fulfillment error:', error);
      res.status(400).json({ error: error?.message || 'Failed to swap beat media.' });
    }
  });

  // --- Stage 9 & 10: Real Server-Side FFmpeg MP4 Encoding + QA Validation ---
  const RENDER_CHUNK_ROOT = path.resolve(os.tmpdir(), 'cineforge-render-chunks');

  const resolveRenderChunkDir = (ownerId: string, projectId: string, renderId: string) => {
    const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeProj = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeRender = renderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.resolve(RENDER_CHUNK_ROOT, `${safeOwner}_${safeProj}_${safeRender}`);
    if (!dir.startsWith(RENDER_CHUNK_ROOT + path.sep)) {
      throw new Error('Invalid render workspace path.');
    }
    return dir;
  };

  interface RenderJobStatusEntry {
    status: 'processing' | 'completed' | 'failed';
    stage: string;
    progress: number;
    result?: Awaited<ReturnType<typeof videoRenderingService.finalizeUploadedVideo>>;
    error?: string;
    updatedAt: number;
  }

  const renderJobStore = new Map<string, RenderJobStatusEntry>();
  const RENDER_JOB_TTL_MS = 30 * 60 * 1000;

  const pruneRenderJobStore = () => {
    const now = Date.now();
    for (const [key, entry] of renderJobStore.entries()) {
      if (now - entry.updatedAt > RENDER_JOB_TTL_MS) {
        renderJobStore.delete(key);
      }
    }
  };

  app.post(
    '/api/render/upload-chunk-raw',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: '4mb' }),
    async (req: AuthRequest, res) => {
      try {
        const bodyBuf = Buffer.isBuffer(req.body) ? req.body : null;
        const projectId = String(req.query.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const renderId = String(req.query.renderId || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const chunkIndex = Number(req.query.chunkIndex);
        const totalChunks = Number(req.query.totalChunks);

        if (
          !bodyBuf ||
          bodyBuf.length === 0 ||
          !projectId ||
          !renderId ||
          !Number.isInteger(chunkIndex) ||
          chunkIndex < 0 ||
          chunkIndex >= 1500 ||
          !Number.isInteger(totalChunks) ||
          totalChunks < 1 ||
          totalChunks > 1500 ||
          chunkIndex >= totalChunks
        ) {
          return res.status(400).json({ error: 'Valid binary chunk body, projectId, renderId, chunkIndex, and totalChunks are required.' });
        }

        const chunkDir = resolveRenderChunkDir(req.user!.uid, projectId, renderId);
        await fs.mkdir(chunkDir, { recursive: true });
        const chunkPath = path.resolve(chunkDir, `chunk_${String(chunkIndex).padStart(5, '0')}.bin`);
        if (!chunkPath.startsWith(chunkDir + path.sep)) {
          return res.status(400).json({ error: 'Invalid chunk path.' });
        }
        await fs.writeFile(chunkPath, bodyBuf);

        res.json({ ok: true, chunkIndex, receivedBytes: bodyBuf.length });
      } catch (error: any) {
        console.error('Raw render chunk upload error:', error);
        res.status(500).json({ error: error?.message || 'Failed to save render upload chunk.' });
      }
    }
  );

  app.post('/api/render/upload-chunk', requireAuth, upload.single('chunk'), async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      const projectId = String(req.body?.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const renderId = String(req.body?.renderId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const chunkIndex = Number(req.body?.chunkIndex);
      const totalChunks = Number(req.body?.totalChunks);

      if (
        !file ||
        !projectId ||
        !renderId ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= 1500 ||
        !Number.isInteger(totalChunks) ||
        totalChunks < 1 ||
        totalChunks > 1500 ||
        chunkIndex >= totalChunks
      ) {
        return res.status(400).json({ error: 'Valid chunk file, projectId, renderId, chunkIndex, and totalChunks are required.' });
      }

      const chunkDir = resolveRenderChunkDir(req.user!.uid, projectId, renderId);
      await fs.mkdir(chunkDir, { recursive: true });
      const chunkPath = path.resolve(chunkDir, `chunk_${String(chunkIndex).padStart(5, '0')}.bin`);
      if (!chunkPath.startsWith(chunkDir + path.sep)) {
        return res.status(400).json({ error: 'Invalid chunk path.' });
      }
      await fs.writeFile(chunkPath, file.buffer);

      res.json({ ok: true, chunkIndex, receivedBytes: file.buffer.length });
    } catch (error: any) {
      console.error('Render chunk upload error:', error);
      res.status(500).json({ error: error?.message || 'Failed to save render upload chunk.' });
    }
  });

  app.post('/api/render/finalize-chunked', requireAuth, async (req: AuthRequest, res) => {
    const ownerId = req.user!.uid;
    const projectId = String(req.body?.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const renderId = String(req.body?.renderId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const totalChunks = Number(req.body?.totalChunks);
    const rawExt = String(req.body?.inputExt || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const inputExt = rawExt === 'webm' ? 'webm' : 'mp4';
    const width = Math.max(320, Math.min(3840, Number(req.body?.width) || 1920));
    const height = Math.max(240, Math.min(2160, Number(req.body?.height) || 1080));
    const fps = Math.max(24, Math.min(60, Number(req.body?.fps) || 30));
    const masterAudioUrl = String(req.body?.masterAudioUrl || '');
    const rawAudioMixConfig = req.body?.audioMixConfig;
    const audioMixConfig:
      | { mixer: AudioMixerSettings; sfxEvents: Array<{ timeMs: number; cue: SfxCueType }> }
      | undefined =
      rawAudioMixConfig && typeof rawAudioMixConfig === 'object' && rawAudioMixConfig.mixer
        ? {
            mixer: rawAudioMixConfig.mixer as AudioMixerSettings,
            sfxEvents: Array.isArray(rawAudioMixConfig.sfxEvents)
              ? rawAudioMixConfig.sfxEvents.slice(0, 120)
              : [],
          }
        : undefined;

    if (!projectId || !renderId || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 1500) {
      return res.status(400).json({ error: 'Valid projectId, renderId, and totalChunks are required.' });
    }

    const chunkDir = resolveRenderChunkDir(ownerId, projectId, renderId);
    const assembledPath = path.resolve(chunkDir, `assembled.${inputExt}`);
    if (!assembledPath.startsWith(chunkDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid render workspace path.' });
    }

    pruneRenderJobStore();
    const jobKey = `${ownerId}:${projectId}:${renderId}`;

    // If finalize was retried while already processing or finished, return current state immediately
    const existing = renderJobStore.get(jobKey);
    if (existing && (existing.status === 'processing' || existing.status === 'completed')) {
      return res.status(202).json({
        status: existing.status,
        projectId,
        renderId,
        stage: existing.stage,
        progress: existing.progress,
      });
    }

    // Verify first chunk exists before detaching background job
    try {
      await fs.access(path.resolve(chunkDir, 'chunk_00000.bin'));
    } catch {
      return res.status(400).json({ error: 'Uploaded video chunks were not found on the server. Please retry rendering.' });
    }

    const updateJobState = (patch: Partial<RenderJobStatusEntry>) => {
      const prev = renderJobStore.get(jobKey) || {
        status: 'processing' as const,
        stage: 'Assembling uploaded stream chunks...',
        progress: 74,
        updatedAt: Date.now(),
      };
      renderJobStore.set(jobKey, {
        ...prev,
        ...patch,
        updatedAt: Date.now(),
      });
    };

    updateJobState({
      status: 'processing',
      stage: `Assembling ${totalChunks} uploaded stream chunks on encoder disk...`,
      progress: 74,
    });

    // Return 202 Accepted immediately so reverse proxies never drop long-running FFmpeg HTTP connections
    res.status(202).json({
      status: 'processing',
      projectId,
      renderId,
      stage: `Assembling ${totalChunks} uploaded stream chunks on encoder disk...`,
      progress: 74,
    });

    // Run assembly + FFmpeg encoding + QA validation asynchronously in background
    void (async () => {
      try {
        emitProjectEvent(projectId, 'render_progress', {
          renderId,
          stage: `Assembling ${totalChunks} uploaded stream chunks on encoder disk...`,
          progress: 74,
        });

        const outHandle = await fs.open(assembledPath, 'w');
        try {
          for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.resolve(chunkDir, `chunk_${String(i).padStart(5, '0')}.bin`);
            if (!chunkPath.startsWith(chunkDir + path.sep)) {
              throw new Error('Invalid chunk path detected during assembly.');
            }
            const data = await fs.readFile(chunkPath);
            await outHandle.write(data);
          }
        } finally {
          await outHandle.close();
        }

        let audioRelativePath: string | undefined;
        const audioMatch = masterAudioUrl.match(/\/api\/media\/file\/([^/]+)\/([^/]+)\/(audio|uploads|renders)\/([^/?]+)/);
        if (audioMatch && decodeURIComponent(audioMatch[1]) === ownerId) {
          audioRelativePath = path.posix.join(
            decodeURIComponent(audioMatch[1]),
            decodeURIComponent(audioMatch[2]),
            audioMatch[3],
            decodeURIComponent(audioMatch[4])
          );
        }

        const result = await videoRenderingService.finalizeUploadedVideo(
          {
            ownerId,
            projectId,
            renderId,
            inputFilePath: assembledPath,
            inputExt,
            audioRelativePath,
            audioMixConfig,
            width,
            height,
            fps,
          },
          (stage, progress) => {
            updateJobState({ status: 'processing', stage, progress });
            emitProjectEvent(projectId, 'render_progress', { renderId, stage, progress });
          }
        );

        updateJobState({
          status: 'completed',
          stage: 'MP4 verified and archived in Deliverables',
          progress: 100,
          result,
        });
      } catch (error: any) {
        console.error('Chunked render finalize error:', error);
        const errMsg = error?.message || 'MP4 encoding and QA validation failed.';
        updateJobState({
          status: 'failed',
          stage: 'Render failed',
          error: errMsg,
        });
        emitProjectEvent(projectId, 'render_progress', {
          renderId,
          stage: `Render failed: ${errMsg}`,
          progress: 100,
        });
      } finally {
        await fs.rm(chunkDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
  });

  app.get('/api/render/status/:projectId/:renderId', requireAuth, (req: AuthRequest, res) => {
    pruneRenderJobStore();
    const projectId = String(req.params.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const renderId = String(req.params.renderId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectId || !renderId) {
      return res.status(400).json({ error: 'Valid projectId and renderId are required.' });
    }
    const jobKey = `${req.user!.uid}:${projectId}:${renderId}`;
    const job = renderJobStore.get(jobKey);
    if (!job) {
      return res.status(404).json({ error: 'Render job status not found or expired.' });
    }
    res.json({
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      result: job.status === 'completed' ? job.result : undefined,
      error: job.status === 'failed' ? job.error : undefined,
    });
  });

  app.post('/api/render/finalize', requireAuth, upload.single('video'), async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      const projectId = String(req.body?.projectId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const renderId = String(req.body?.renderId || `rnd_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
      const width = Number(req.body?.width) || 1920;
      const height = Number(req.body?.height) || 1080;
      const fps = Number(req.body?.fps) || 30;
      const masterAudioUrl = String(req.body?.masterAudioUrl || '');

      if (!file || !projectId) {
        return res.status(400).json({ error: 'Rendered video stream and projectId are required.' });
      }

      let audioRelativePath: string | undefined;
      const audioMatch = masterAudioUrl.match(/\/api\/media\/file\/([^/]+)\/([^/]+)\/(audio|uploads|renders)\/([^/?]+)/);
      if (audioMatch && decodeURIComponent(audioMatch[1]) === req.user!.uid) {
        audioRelativePath = path.posix.join(
          decodeURIComponent(audioMatch[1]),
          decodeURIComponent(audioMatch[2]),
          audioMatch[3],
          decodeURIComponent(audioMatch[4])
        );
      }

      const ext = file.mimetype.includes('mp4') ? 'mp4' : 'webm';
      const result = await videoRenderingService.finalizeUploadedVideo(
        {
          ownerId: req.user!.uid,
          projectId,
          renderId,
          videoBuffer: file.buffer,
          inputExt: ext,
          audioRelativePath,
          width,
          height,
          fps,
        },
        (stage, progress) => {
          emitProjectEvent(projectId, 'render_progress', { renderId, stage, progress });
        }
      );

      res.json(result);
    } catch (error: any) {
      console.error('Render finalize error:', error);
      res.status(500).json({ error: error?.message || 'MP4 encoding and QA validation failed.' });
    }
  });

  // --- Owner-Authenticated Media Streaming with Cloud-Run-Safe 4 MB Chunked HTTP Range Support ---
  const MAX_MEDIA_RANGE_BYTES = 4 * 1024 * 1024; // Keep every HTTP response well under Cloud Run's 32 MB limit

  const handleMediaFileRequest = async (req: AuthRequest, res: Response) => {
    try {
      const ownerId = decodeURIComponent(String(req.params.ownerId));
      const projectId = decodeURIComponent(String(req.params.projectId));
      const folder = String(req.params.folder);
      const fileName = decodeURIComponent(String(req.params.fileName));

      if (ownerId !== req.user!.uid) {
        return res.status(403).json({ error: 'Access denied to this project media asset.' });
      }
      if (folder !== 'audio' && folder !== 'uploads' && folder !== 'renders') {
        return res.status(400).json({ error: 'Invalid media folder.' });
      }

      const fullPath = fileStorage.resolveSafePath(path.posix.join(ownerId, projectId, folder, fileName));
      const stat = await fs.stat(fullPath);

      const ext = path.extname(fileName).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain; charset=utf-8',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      if (ext === '.svg') {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }

      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      }

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
        });
        return res.end();
      }

      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!match) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }

        let start: number;
        let requestedEnd: number;
        if (match[1] === '' && match[2] !== '') {
          // Suffix byte range: bytes=-N
          const suffixLen = parseInt(match[2], 10);
          start = Math.max(0, stat.size - suffixLen);
          requestedEnd = stat.size - 1;
        } else {
          start = parseInt(match[1], 10);
          requestedEnd = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        }

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(requestedEnd) ||
          start < 0 ||
          start >= stat.size ||
          requestedEnd < start
        ) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }

        // Cap each 206 response to 4 MB so <video> streaming & chunked downloads never exceed proxy limits
        const end = Math.min(requestedEnd, start + MAX_MEDIA_RANGE_BYTES - 1, stat.size - 1);
        const chunkSize = end - start + 1;
        const fileHandle = await fs.open(fullPath, 'r');
        try {
          const buf = Buffer.allocUnsafe(chunkSize);
          let bytesReadTotal = 0;
          while (bytesReadTotal < chunkSize) {
            const { bytesRead } = await fileHandle.read(
              buf,
              bytesReadTotal,
              chunkSize - bytesReadTotal,
              start + bytesReadTotal
            );
            if (bytesRead <= 0) break;
            bytesReadTotal += bytesRead;
          }
          const slice = bytesReadTotal === chunkSize ? buf : buf.subarray(0, bytesReadTotal);
          const actualEnd = start + slice.length - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${actualEnd}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': slice.length,
            'Content-Type': contentType,
            'Cache-Control': 'private, max-age=300',
          });
          res.end(slice);
        } finally {
          await fileHandle.close();
        }
      } else {
        const buf = await fs.readFile(fullPath);
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
        });
        res.end(buf);
      }
    } catch {
      res.status(404).json({ error: 'Media file not found.' });
    }
  };

  app.get('/api/media/file/:ownerId/:projectId/:folder/:fileName', requireAuth, handleMediaFileRequest);
  app.head('/api/media/file/:ownerId/:projectId/:folder/:fileName', requireAuth, handleMediaFileRequest);

  // --- Guarantee /api/* NEVER falls through to SPA HTML or HTML error pages ---
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  app.use(
    '/api',
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('API middleware error:', err);
      const status =
        typeof err?.status === 'number'
          ? err.status
          : typeof err?.statusCode === 'number'
          ? err.statusCode
          : 500;
      const message =
        err?.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the 120 MB limit.'
          : err?.type === 'entity.too.large'
          ? 'Request payload exceeds the 12 MB size limit.'
          : err?.type === 'entity.parse.failed'
          ? 'Malformed JSON request body.'
          : err?.message || 'Internal server error.';
      res.status(status).json({ error: message });
    }
  );

  // --- Public Verified Demo Render Streaming (HTTP 206 Byte-Range Support) ---
  const handleDemoVideoRequest = async (req: express.Request, res: express.Response) => {
    try {
      const safeName = path.basename(String(req.params.fileName || '')).replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safeName || !safeName.endsWith('.mp4')) {
        return res.status(404).end();
      }
      const demoPath = path.resolve(process.cwd(), 'public', 'demo', safeName);
      const stat = await fs.stat(demoPath);
      const totalSize = stat.size;
      const rangeHeader = req.headers.range;

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (!match) {
          res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
          return;
        }
        const start = match[1] ? Math.min(totalSize - 1, Math.max(0, Number(match[1]))) : 0;
        const requestedEnd = match[2] ? Math.min(totalSize - 1, Number(match[2])) : totalSize - 1;
        const maxChunk = 4 * 1024 * 1024;
        const end = Math.min(requestedEnd, start + maxChunk - 1);
        const chunkLen = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkLen));
        if (req.method === 'HEAD') return res.end();
        const fh = await fs.open(demoPath, 'r');
        try {
          const buf = Buffer.alloc(chunkLen);
          await fh.read(buf, 0, chunkLen, start);
          res.end(buf);
        } finally {
          await fh.close();
        }
        return;
      }

      res.status(200);
      res.setHeader('Content-Length', String(totalSize));
      if (req.method === 'HEAD') return res.end();
      res.sendFile(demoPath);
    } catch {
      res.status(404).end();
    }
  };
  app.get('/demo/:fileName', handleDemoVideoRequest);
  app.head('/demo/:fileName', handleDemoVideoRequest);

  // --- Vite Dev Middleware / Static Production Assets ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CineForge full-stack studio listening on http://0.0.0.0:${PORT}`);
  });
  // Keep backend sockets alive longer than Cloud Run / reverse-proxy idle pools to prevent mid-upload ECONNRESET
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 300_000;
}

startServer().catch((err) => {
  console.error('Failed to start CineForge server:', err);
  process.exit(1);
});
