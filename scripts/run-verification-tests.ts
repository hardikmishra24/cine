import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  VIDEO_STYLE_PRESETS,
  type AmbientBedId,
  type SfxCueType,
  type VideoStylePresetId,
} from '../src/types/cineforge.ts';
import { MAP_REGIONS, detectMapRegionFromText } from '../src/lib/worldMapData.ts';
import {
  GeminiStoryboardService,
  alignWordsToDuration,
  subdivideSegmentsIntoPacedBeats,
} from '../src/server/services/researchAndScriptService.ts';
import {
  AnimatedRigGenerationService,
  computeRigSignature,
  sanitizeAnimatedRigSpec,
} from '../src/server/services/animatedRigService.ts';
import { ArchivalAssetService } from '../src/server/services/archivalAssetService.ts';
import { BeatMediaFulfillmentService } from '../src/server/services/beatMediaFulfillmentService.ts';
import {
  buildProceduralEditorialSvg,
  sanitizeGeneratedSvg,
} from '../src/server/services/illustrationService.ts';
import {
  mixNarrationWithMusicAndSfx,
  mixSfxCueIntoBuffers,
  synthesizeMusicBedStereo,
} from '../src/server/services/audioMixService.ts';
import { LocalFileStorageService } from '../src/server/services/fileStorageService.ts';
import { FfmpegVideoRenderingService } from '../src/server/services/videoRenderingService.ts';

const execFileAsync = promisify(execFile);

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

const results: TestResult[] = [];

async function runTest(suite: string, name: string, fn: () => Promise<string> | string) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({
      suite,
      name,
      passed: true,
      durationMs: Date.now() - start,
      detail,
    });
    console.log(`  [PASS] ${suite} :: ${name} (${Date.now() - start}ms) — ${detail}`);
  } catch (err: any) {
    results.push({
      suite,
      name,
      passed: false,
      durationMs: Date.now() - start,
      detail: err?.message || String(err),
    });
    console.error(`  [FAIL] ${suite} :: ${name} — ${err?.message || err}`);
  }
}

function encodeMonoWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function generateTestSpeechWav(durationSec: number, sampleRate = 24000): Buffer {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = Buffer.alloc(totalSamples * 2);
  // Active speech tone bursts for [0.4s..2.2s] and [3.8s..5.5s], silence gap at [2.2s..3.8s] to test auto-ducking
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const isSpeaking = (t >= 0.4 && t <= 2.2) || (t >= 3.8 && t <= 5.5);
    let sample = 0;
    if (isSpeaking) {
      sample =
        (Math.sin(2 * Math.PI * 195 * t) * 0.45 +
          Math.sin(2 * Math.PI * 390 * t) * 0.22 +
          Math.sin(2 * Math.PI * 585 * t) * 0.1) *
        0.72;
    }
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), i * 2);
  }
  return encodeMonoWav(pcm, sampleRate);
}

async function main() {
  console.log('\n=== CineForge Automated Verification Suite ===\n');

  // 1. Style Presets & Fast Punchy Pacing Subdivision Tests
  await runTest('1. Pacing & Style Engine', 'All 6 Reference Presets Have Vibrant Modern High-Contrast Palettes', () => {
    const ids = Object.keys(VIDEO_STYLE_PRESETS) as VideoStylePresetId[];
    assert.equal(ids.length, 6, 'Expected 6 style presets');
    const hexRe = /^#[0-9A-Fa-f]{6}$/;
    const legacyDullHexes = new Set(['#1A140F', '#292118', '#B89B72']);
    for (const id of ids) {
      const p = VIDEO_STYLE_PRESETS[id];
      assert.ok(p.label && p.referenceChannel && p.defaultAmbientBed);
      assert.ok(hexRe.test(p.palette.bg), `${id} invalid bg hex`);
      assert.ok(hexRe.test(p.palette.accent), `${id} invalid accent hex`);
      assert.ok(hexRe.test(p.palette.secondaryAccent), `${id} invalid secondaryAccent hex`);
      assert.ok(hexRe.test(p.palette.highlightBg), `${id} invalid highlightBg hex`);
      assert.ok(!legacyDullHexes.has(p.palette.bg.toUpperCase()), `${id} still using dull sepia bg`);
    }
    return `6/6 vibrant modern palettes verified (${ids.map((id) => `${id}:${VIDEO_STYLE_PRESETS[id].palette.accent}`).join(', ')})`;
  });

  await runTest('1. Pacing & Style Engine', 'Fast Punchy 2.0–3.5s Beat Subdivision & Word Timestamp Integrity', () => {
    const seg1Text =
      'In November 1932, twenty thousand emus marched straight onto Western Australian wheat farms. Desperate farmers begged Canberra for military aid against the unstoppable feathered invasion.';
    const seg2Text =
      'Major Meredith deployed Royal Artillery soldiers armed with Lewis machine guns near Campion. Across the vast outback map, agile flocks scattered faster than pursuit trucks could chase.';
    const seg1Words = alignWordsToDuration(seg1Text, 0, 11400);
    const seg2Words = alignWordsToDuration(seg2Text, 11700, 11800);

    const beats = subdivideSegmentsIntoPacedBeats([
      { id: 'seg_1', orderIndex: 0, text: seg1Text, startMs: 0, endMs: 11400, wordTimestamps: seg1Words },
      { id: 'seg_2', orderIndex: 1, text: seg2Text, startMs: 11700, endMs: 23500, wordTimestamps: seg2Words },
    ]);

    assert.ok(beats.length >= 6 && beats.length <= 12, `Expected 6..12 punchy beats, got ${beats.length}`);
    let totalDur = 0;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const dur = b.endMs - b.startMs;
      totalDur += dur;
      assert.ok(dur >= 1300 && dur <= 4600, `Beat ${i} duration out of fast-paced range: ${dur}ms`);
      assert.ok(b.wordTimestamps.length > 0, `Beat ${i} missing wordTimestamps`);
      if (i > 0) {
        assert.ok(b.startMs >= beats[i - 1].endMs, `Beat ${i} overlaps previous beat`);
      }
    }
    const avgSec = totalDur / beats.length / 1000;
    assert.ok(avgSec >= 2.0 && avgSec <= 3.6, `Average beat pacing ${avgSec.toFixed(2)}s outside 2.0-3.6s window`);
    return `${beats.length} punchy beats generated · avg ${avgSec.toFixed(2)}s/beat · zero overlaps`;
  });

  await runTest('1. Storyboard-First Pipeline', 'Asset-Agnostic Shot Blueprint (Step 4) -> 1-to-1 Zero-Repeat Fulfillment (Step 5)', async () => {
    const sbService = new GeminiStoryboardService();
    const archivalService = new ArchivalAssetService();
    const fulfillmentService = new BeatMediaFulfillmentService(archivalService);

    const seg1Text =
      'In November 1932, twenty thousand emus charged onto Western Australian wheat farms. Desperate farmers begged Canberra for military aid.';
    const seg2Text =
      'Major Meredith deployed Royal Artillery soldiers armed with Lewis machine guns near Campion. Across the outback map, fast flocks scattered ahead of pursuit trucks.';
    const draftBeats = await sbService.generateStoryboard({
      topic: 'The Great Emu War of 1932 in Western Australia',
      researchSummary:
        'In November 1932, Australian soldiers with Lewis guns pursued 20,000 emus across Western Australian wheat farms before Parliament withdrew.',
      worldEnvironment: 'desk',
      videoStylePreset: 'historically',
      segments: [
        {
          id: 's1',
          orderIndex: 0,
          text: seg1Text,
          startMs: 0,
          endMs: 8200,
          wordTimestamps: alignWordsToDuration(seg1Text, 0, 8200),
        },
        {
          id: 's2',
          orderIndex: 1,
          text: seg2Text,
          startMs: 8450,
          endMs: 17000,
          wordTimestamps: alignWordsToDuration(seg2Text, 8450, 8550),
        },
      ],
    });

    assert.ok(draftBeats.length >= 4, `Expected >=4 planned storyboard beats, got ${draftBeats.length}`);
    for (const b of draftBeats) {
      assert.equal(b.fulfillmentStatus, 'planned', 'Step 4 beats must start in planned state');
      assert.ok(b.shotBrief && b.shotBrief.length >= 8, `Beat ${b.orderIndex} missing shotBrief`);
      assert.ok(
        Boolean(b.assetSearchQuery || b.rigPrompt),
        `Beat ${b.orderIndex} missing assetSearchQuery or rigPrompt`
      );
      assert.equal(b.heroAssetUrl || '', '', 'Step 4 must NOT pre-populate heroAssetUrl before Step 5');
    }

    const plannedBeats = draftBeats.map((b, i) => ({
      ...b,
      id: `beat_test_${i + 1}`,
      ownerId: 'test',
      projectId: 'p1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const fulfilled = await fulfillmentService.fulfillStoryboardBeats({
      topic: 'The Great Emu War of 1932 in Western Australia',
      researchSummary:
        'Australian soldiers with Lewis guns pursued 20,000 emus across Western Australian wheat farms.',
      stylePreset: 'historically',
      beats: plannedBeats,
    });

    assert.equal(
      fulfilled.uniquenessReport.duplicateCount,
      0,
      `Expected ZERO duplicate assets across beats, found ${fulfilled.uniquenessReport.duplicateCount}`
    );
    assert.equal(
      fulfilled.uniquenessReport.fulfilledCount,
      plannedBeats.length,
      `Expected all ${plannedBeats.length} beats fulfilled 1-to-1`
    );

    // Double-check strict URL & rig signature uniqueness independently
    const seenUrls = new Set<string>();
    const seenRigSigs = new Set<string>();
    for (const bp of fulfilled.beatPatches) {
      const p = bp.patch;
      if (p.heroVideoUrl) {
        assert.ok(!seenUrls.has(p.heroVideoUrl), `Duplicate heroVideoUrl: ${p.heroVideoUrl}`);
        seenUrls.add(p.heroVideoUrl);
      } else if (p.heroAssetUrl) {
        assert.ok(!seenUrls.has(p.heroAssetUrl), `Duplicate heroAssetUrl: ${p.heroAssetUrl}`);
        seenUrls.add(p.heroAssetUrl);
      }
      if (p.sceneType === 'animated_rig' && p.animatedRigSpec) {
        const cleanSpec = sanitizeAnimatedRigSpec(p.animatedRigSpec, p.heroAssetTitle || 'Rig');
        const sig = computeRigSignature(cleanSpec);
        assert.ok(!seenRigSigs.has(sig), `Duplicate animated rig signature: ${sig}`);
        seenRigSigs.add(sig);
      }
    }

    const bd = fulfilled.uniquenessReport.breakdown;
    return `${plannedBeats.length} beats planned -> 100% fulfilled with 0 duplicates (video=${bd.archivalVideo}, rigs=${bd.animatedRig}, photos=${bd.archivalPhoto}, maps=${bd.animatedMap})`;
  });

  await runTest('1. Storyboard-First Pipeline', 'Public-Domain Archival Video Clip Discovery (Wikimedia / NASA)', async () => {
    const archivalService = new ArchivalAssetService();
    const videos = await archivalService.searchArchive('Apollo moon rocket launch', ['nasa', 'wikimedia'], 'video');
    assert.ok(videos.length >= 1, 'Expected at least 1 verified public-domain archival video clip');
    for (const v of videos) {
      assert.equal(v.mediaKind, 'video');
      assert.ok(v.videoUrl && v.videoUrl.startsWith('https://'), `Invalid videoUrl on ${v.title}`);
    }
    return `Discovered ${videos.length} verified public-domain video clips (e.g., "${videos[0].title.slice(0, 48)}")`;
  });

  // 2. Vector Cartography Atlas Tests
  await runTest('2. Animated Cartography', 'All 9 World Map Regions & Polygon Integrity', () => {
    const regions = Object.keys(MAP_REGIONS) as Array<keyof typeof MAP_REGIONS>;
    assert.equal(regions.length, 9, 'Expected 9 map regions');
    let polyCount = 0;
    for (const r of regions) {
      const data = MAP_REGIONS[r];
      assert.ok(data.landmasses.length >= 1, `${r} missing landmasses`);
      assert.ok(data.defaultLabels.length >= 2, `${r} needs at least 2 defaultLabels`);
      for (const poly of data.landmasses) {
        polyCount++;
        assert.ok(poly.points.length >= 3, `${r}:${poly.name} polygon < 3 pts`);
        for (const [x, y] of poly.points) {
          assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `Coord out of 0..100 in ${r}`);
        }
      }
    }
    return `9 regions · ${polyCount} valid landmass polygons verified`;
  });

  await runTest('2. Animated Cartography', 'Geographic Text Detection Accuracy', () => {
    assert.equal(detectMapRegionFromText('The Mexican-American War along the Rio Grande in 1846'), 'north_america');
    assert.equal(detectMapRegionFromText('The Great Emu War in Western Australia near Perth'), 'australia');
    assert.equal(detectMapRegionFromText('The 335 Years War between the Netherlands and Isles of Scilly in Britain'), 'europe');
    assert.equal(detectMapRegionFromText('Ancient Mesopotamia along the Euphrates and Egypt'), 'middle_east');
    assert.equal(detectMapRegionFromText('Voyages across Tokyo and Beijing in East Asia'), 'asia');
    return 'All 5 geographic region detections matched accurately';
  });

  // 3. Vector Illustration Security & Generation Tests
  await runTest('3. Editorial Illustrations', 'Strict SVG XSS Sanitizer Strips Dangerous Vectors', () => {
    const malicious = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" onload="alert(1)">
        <script>fetch('https://evil.test')</script>
        <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(2)></body></foreignObject>
        <a href="javascript:alert(3)"><rect x="10" y="10" width="200" height="200" fill="#E5A03A" onclick="evil()"/></a>
        <image href="https://evil.test/tracker.png" width="50" height="50"/>
        <circle cx="640" cy="360" r="120" fill="#38BDF8"/>
      </svg>
    `;
    const clean = sanitizeGeneratedSvg(malicious);
    assert.ok(clean !== null, 'Sanitizer should preserve safe SVG root & shapes');
    assert.ok(!/<script/i.test(clean!), 'Must strip <script>');
    assert.ok(!/foreignObject/i.test(clean!), 'Must strip <foreignObject>');
    assert.ok(!/onload|onerror|onclick/i.test(clean!), 'Must strip event handlers');
    assert.ok(!/javascript:/i.test(clean!), 'Must strip javascript: URI');
    assert.ok(!/evil\.test/i.test(clean!), 'Must strip external image/href references');
    assert.ok(/<circle/i.test(clean!), 'Must preserve safe vector primitives');
    return 'Stripped <script>, <foreignObject>, on* handlers, javascript:, and external hrefs';
  });

  await runTest('3. Editorial Illustrations', 'Procedural 16:9 Vector Artwork Generation Across All 6 Presets', () => {
    const ids = Object.keys(VIDEO_STYLE_PRESETS) as VideoStylePresetId[];
    for (const id of ids) {
      const svg = buildProceduralEditorialSvg({
        prompt: 'WWI gas mask filter diagram and trench timeline in 1917',
        title: 'History of Protective Masks (1917)',
        stylePreset: id,
      });
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `Invalid SVG envelope for ${id}`);
      assert.ok(svg.includes('viewBox="0 0 1280 720"'), `Missing 16:9 viewBox for ${id}`);
      assert.ok(sanitizeGeneratedSvg(svg) !== null, `Generated SVG failed sanitizer for ${id}`);
    }
    return `6/6 presets produced sanitizer-verified 1280x720 editorial SVGs`;
  });

  // 4. Deterministic Music Bed, SFX & Auto-Ducking Audio Engine Tests
  await runTest('4. Audio Mixing Engine', 'All 9 Style Music Beds & All 9 SFX Cues Synthesize Clean Stereo Audio', () => {
    const beds: Exclude<AmbientBedId, 'none'>[] = [
      'ted_ed_marimba',
      'simple_history_march',
      'maps_cartography_pulse',
      'minute_earth_plucky',
      'historically_upbeat',
      'obsidian_drone',
      'investigative_pulse',
      'historical_strings',
      'archive_room_tone',
    ];
    for (const bed of beds) {
      const { left, right } = synthesizeMusicBedStereo(bed, 1.5, 48000);
      assert.equal(left.length, 72000);
      let sumSq = 0;
      for (let i = 0; i < left.length; i++) sumSq += left[i] * left[i] + right[i] * right[i];
      const rms = Math.sqrt(sumSq / (left.length * 2));
      assert.ok(rms > 0.005, `Music bed ${bed} is unexpectedly silent (rms=${rms})`);
    }

    const sfxCues: Exclude<SfxCueType, 'none'>[] = [
      'whoosh',
      'pop_in',
      'paper_slide',
      'stamp_hit',
      'map_ping',
      'chalk_draw',
      'document_land',
      'soft_impact',
      'map_pin',
    ];
    for (const cue of sfxCues) {
      const l = new Float32Array(48000);
      const r = new Float32Array(48000);
      mixSfxCueIntoBuffers(l, r, cue, 100, 0.7, 48000);
      let peak = 0;
      for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      assert.ok(peak > 0.02, `SFX cue ${cue} produced no audible signal`);
    }
    return '9/9 musical beds + 9/9 SFX cues produced clean non-silent 48kHz stereo PCM';
  });

  await runTest('4. Audio Mixing Engine', 'Voiceover Auto-Ducking Reduces Music Under Speech Without Clipping', () => {
    const speechWav = generateTestSpeechWav(6.0, 24000);
    const mixedDucked = mixNarrationWithMusicAndSfx({
      voiceWavBuffer: speechWav,
      durationSec: 6.0,
      mixer: {
        voiceVolume: 1.0,
        musicVolume: 0.42,
        sfxVolume: 0.55,
        autoDucking: true,
        duckingDepthDb: 12,
        ambientBed: 'historically_upbeat',
      },
      sfxEvents: [
        { timeMs: 0, cue: 'whoosh' },
        { timeMs: 3000, cue: 'map_ping' },
      ],
    });
    const mixedUnducked = mixNarrationWithMusicAndSfx({
      voiceWavBuffer: speechWav,
      durationSec: 6.0,
      mixer: {
        voiceVolume: 1.0,
        musicVolume: 0.42,
        sfxVolume: 0.55,
        autoDucking: false,
        duckingDepthDb: 0,
        ambientBed: 'historically_upbeat',
      },
      sfxEvents: [
        { timeMs: 0, cue: 'whoosh' },
        { timeMs: 3000, cue: 'map_ping' },
      ],
    });
    assert.ok(mixedDucked.wavBuffer.length > 48000 * 4 * 5, 'Expected 6s 48kHz 16-bit stereo WAV');
    assert.equal(mixedDucked.sampleRate, 48000);
    assert.ok(mixedDucked.peakAmplitude <= 0.99, `Audio clipped: peak=${mixedDucked.peakAmplitude}`);
    assert.ok(mixedDucked.rmsDb > -30 && mixedDucked.rmsDb < -1, `Unexpected mixed RMS dB: ${mixedDucked.rmsDb}`);
    // Auto-ducking reduces overall energy during speech segments compared to unducked mix
    assert.ok(
      mixedDucked.rmsDb < mixedUnducked.rmsDb,
      `Expected ducked RMS (${mixedDucked.rmsDb} dBFS) < unducked RMS (${mixedUnducked.rmsDb} dBFS)`
    );
    return `48kHz stereo WAV (${(mixedDucked.wavBuffer.length / 1024).toFixed(0)} KB) · peak ${mixedDucked.peakAmplitude.toFixed(3)} · ducked ${mixedDucked.rmsDb} dBFS vs unducked ${mixedUnducked.rmsDb} dBFS`;
  });

  // 5. Real End-to-End FFmpeg H.264/AAC MP4 Render & QA Validation
  await runTest('5. FFmpeg Render & QA', 'End-to-End H.264/AAC MP4 Mux with Mixed Music+SFX, FFprobe & Zero Black Frames', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cineforge-e2e-test-'));
    const storage = new LocalFileStorageService();
    const renderer = new FfmpegVideoRenderingService(storage);
    const testOwner = 'qa_test_runner';
    const testProject = `e2e_${Date.now().toString(36)}`;
    const testRenderId = `rnd_e2e_${Date.now().toString(36)}`;

    try {
      // Create a vibrant 5-second H.264 test video stream (1280x720 @ 30fps, zero black frames)
      const rawMp4 = path.join(tmpDir, 'synthetic_world.mp4');
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1280x720:rate=30:duration=5',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          rawMp4,
        ],
        { timeout: 30000 }
      );

      // Save synthetic narration WAV to storage
      const speechWav = generateTestSpeechWav(5.0, 24000);
      const savedAudio = await storage.saveFile({
        ownerId: testOwner,
        projectId: testProject,
        folder: 'audio',
        fileName: 'narration_test.wav',
        buffer: speechWav,
      });

      const renderResult = await renderer.finalizeUploadedVideo({
        ownerId: testOwner,
        projectId: testProject,
        renderId: testRenderId,
        inputFilePath: rawMp4,
        inputExt: 'mp4',
        audioRelativePath: savedAudio.relativePath,
        audioMixConfig: {
          mixer: {
            voiceVolume: 1.0,
            musicVolume: 0.28,
            sfxVolume: 0.5,
            autoDucking: true,
            duckingDepthDb: 11,
            ambientBed: 'ted_ed_marimba',
          },
          sfxEvents: [
            { timeMs: 0, cue: 'whoosh' },
            { timeMs: 2500, cue: 'pop_in' },
          ],
        },
        width: 1280,
        height: 720,
        fps: 30,
      });

      assert.ok(renderResult.fileSizeBytes > 50_000, 'Rendered MP4 unexpectedly small');
      assert.ok(renderResult.codecInfo.includes('H264') && renderResult.codecInfo.includes('AAC'), `Unexpected codec: ${renderResult.codecInfo}`);
      assert.equal(renderResult.blackFramesDetected, 0, 'Detected black frames in rendered MP4');
      assert.ok(renderResult.audioSyncDeltaMs <= 450, `Audio/Video sync delta too high: ${renderResult.audioSyncDeltaMs}ms`);
      assert.ok(renderResult.qaFrames.length >= 3, `Expected >=3 QA frames, got ${renderResult.qaFrames.length}`);
      assert.ok(renderResult.qaChecks.every((c) => c.passed), `One or more QA checks failed: ${JSON.stringify(renderResult.qaChecks)}`);

      return `${renderResult.codecInfo} · ${(renderResult.fileSizeBytes / 1024).toFixed(0)} KB · ${renderResult.durationSec}s · 0 black frames · sync Δ${renderResult.audioSyncDeltaMs}ms · ${renderResult.qaFrames.length} QA keyframes`;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(path.resolve(process.cwd(), 'data', 'media', testOwner, testProject), { recursive: true, force: true }).catch(() => {});
    }
  });

  // 6. Live Express Server & Auth Protection Checks
  await runTest('6. Live API Server', 'Health Check & Auth Guards on New Endpoints (Port 3000)', async () => {
    const healthResp = await fetch('http://127.0.0.1:3000/api/health');
    assert.equal(healthResp.status, 200, 'Expected /api/health 200 OK');
    const healthJson = (await healthResp.json()) as { ok?: boolean };
    assert.equal(healthJson.ok, true);

    const protectedEndpoints = [
      '/api/assets/fulfill-storyboard',
      '/api/assets/fulfill-beat',
      '/api/assets/generate-animated-rigs',
      '/api/assets/generate-single-rig',
      '/api/illustrations/generate',
      '/api/illustrations/batch',
      '/api/storyboard/generate',
      '/api/render/finalize-chunked',
    ];
    for (const ep of protectedEndpoints) {
      const resp = await fetch(`http://127.0.0.1:3000${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(resp.status, 401, `Expected 401 Unauthorized on unauthenticated ${ep}, got ${resp.status}`);
    }
    const mediaProxyResp = await fetch(
      'http://127.0.0.1:3000/api/media/proxy?url=https%3A%2F%2Fupload.wikimedia.org%2Ftest.mp4'
    );
    assert.equal(mediaProxyResp.status, 401, `Expected 401 on unauthenticated /api/media/proxy, got ${mediaProxyResp.status}`);
    return `/api/health 200 OK · ${protectedEndpoints.length} POST routes + /api/media/proxy enforced 401`;
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n=== Test Summary: ${passed}/${results.length} PASSED, ${failed} FAILED ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Verification suite crashed:', err);
  process.exit(1);
});
