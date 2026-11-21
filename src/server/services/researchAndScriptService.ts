import { ThinkingLevel, Type } from '@google/genai';
import {
  VIDEO_STYLE_PRESETS,
  type ArchivalAsset,
  type BeatCalloutItem,
  type BeatMapSpec,
  type BeatObjectType,
  type BeatSceneType,
  type BeatTransitionType,
  type MapRegionId,
  type PauseMarker,
  type PronunciationEntry,
  type ResearchEntities,
  type ResearchSource,
  type ScriptParagraph,
  type SfxCueType,
  type StoryboardBeat,
  type VideoStylePresetId,
  type VisualDirection,
  type WordTimestamp,
  type WorldEnvironment,
} from '../../types/cineforge.ts';
import { detectMapRegionFromText, MAP_REGIONS } from '../../lib/worldMapData.ts';
import {
  extractJsonFromText,
  generateContentWithResilience,
  isQuotaOrRateLimitError,
} from './geminiClient.ts';
import { computeWaveformPeaks, extractWavPcmData, getWavDurationMs } from './fileStorageService.ts';
import type {
  AnalyzedAudioResult,
  GeneratedScriptResult,
  IAudioAnalysisService,
  IResearchService,
  IScriptGenerationService,
  IStoryboardService,
  ResearchResult,
} from './interfaces.ts';

const TEXT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

export class GeminiResearchService implements IResearchService {
  async researchTopic(params: {
    topic: string;
    scriptContext?: string;
    language: string;
    researchPreferences?: string;
    referenceTexts?: string[];
  }): Promise<ResearchResult> {
    // Single combined grounded research + structured JSON call (cuts API quota usage in half)
    const groundingPrompt = `You are a senior documentary archival researcher. Conduct thorough, factually rigorous research on the documentary subject below.
Subject: ${params.topic}
Language: ${params.language}
${params.researchPreferences ? `Research priorities: ${params.researchPreferences}` : ''}
${params.scriptContext ? `Supplied script context:\n${params.scriptContext.slice(0, 3000)}` : ''}
${params.referenceTexts?.length ? `Uploaded reference notes:\n${params.referenceTexts.join('\n---\n').slice(0, 3000)}` : ''}

Prioritize government archives, museums, libraries, institutional records, historical archives, and reputable journalism.
Never fabricate facts, dates, quotes, or sources. Explicitly note any historical uncertainties.

Return ONLY a valid JSON object (no markdown commentary outside the JSON block) with this exact shape:
{
  "summary": "Clean 3-4 paragraph factual documentary research dossier with verified dates, turning points, and human context.",
  "entities": {
    "people": ["string"],
    "organizations": ["string"],
    "events": ["string"],
    "dates": ["string"],
    "locations": ["string"]
  },
  "visualDirection": {
    "worldEnvironment": "desk" | "map" | "board" | "archive",
    "cinematographyNotes": "string",
    "lightingStyle": "string",
    "colorPalette": ["#0B0B0D", "#1A1C22", "#E5A03A", "#D9D2C5", "#7C8594"],
    "typographyStyle": "string",
    "cameraLanguage": "string",
    "physicalMotifs": ["string"],
    "referenceNotes": "string"
  },
  "imageSearchQueries": [
    { "query": "2-4 word Wikimedia/LOC/NASA archival search term", "category": "photograph" | "map" | "document" | "newspaper" | "archive", "subject": "short subject label" }
  ]
}`;

    let groundedResp;
    try {
      groundedResp = await generateContentWithResilience({
        models: TEXT_MODELS,
        contents: groundingPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
        maxRetriesPerModel: 2,
      });
    } catch (err) {
      // If Google Search tool quota specifically hit 429 on a free-tier key,
      // retry once using standard Gemini generation (still paired with live Wikimedia/LOC/NASA archival search).
      if (isQuotaOrRateLimitError(err)) {
        groundedResp = await generateContentWithResilience({
          models: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
          contents: groundingPrompt,
          config: {
            responseMimeType: 'application/json',
          },
          maxRetriesPerModel: 1,
        });
      } else {
        throw err;
      }
    }

    const groundedText = groundedResp.text || '';
    const groundingChunks = groundedResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webSources: Array<Omit<ResearchSource, 'id' | 'ownerId' | 'projectId' | 'createdAt'>> = [];
    const seenUrls = new Set<string>();

    for (const chunk of groundingChunks as any[]) {
      const uri = chunk?.web?.uri;
      const title = chunk?.web?.title;
      if (uri && !seenUrls.has(uri)) {
        seenUrls.add(uri);
        let publisher = 'Verified Web Source';
        try {
          publisher = new URL(uri).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
        webSources.push({
          title: String(title || publisher).slice(0, 280),
          url: String(uri).slice(0, 950),
          publisher,
          sourceType:
            publisher.endsWith('.gov') || publisher.endsWith('.edu') || publisher.includes('museum') || publisher.includes('loc.gov')
              ? 'Institutional Archive'
              : 'Verified Reference',
          summary: `Grounding citation verifying facts in "${params.topic}".`,
        });
      }
    }

    let parsed = extractJsonFromText<any>(groundedText, null);

    // Only invoke a lightweight structuring pass if the grounded call returned prose instead of JSON
    if (!parsed || typeof parsed !== 'object' || !parsed.summary) {
      const structuredResp = await generateContentWithResilience({
        models: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
        contents: `Convert the verified documentary research dossier below into structured JSON. Preserve factual accuracy strictly.

Topic: ${params.topic}
Research Dossier:
${groundedText.slice(0, 10000)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'Clean 3-4 paragraph documentary research dossier.' },
              entities: {
                type: Type.OBJECT,
                properties: {
                  people: { type: Type.ARRAY, items: { type: Type.STRING } },
                  organizations: { type: Type.ARRAY, items: { type: Type.STRING } },
                  events: { type: Type.ARRAY, items: { type: Type.STRING } },
                  dates: { type: Type.ARRAY, items: { type: Type.STRING } },
                  locations: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
              },
              visualDirection: {
                type: Type.OBJECT,
                properties: {
                  worldEnvironment: { type: Type.STRING, description: 'One of: desk, map, board, archive' },
                  cinematographyNotes: { type: Type.STRING },
                  lightingStyle: { type: Type.STRING },
                  colorPalette: { type: Type.ARRAY, items: { type: Type.STRING } },
                  typographyStyle: { type: Type.STRING },
                  cameraLanguage: { type: Type.STRING },
                  physicalMotifs: { type: Type.ARRAY, items: { type: Type.STRING } },
                  referenceNotes: { type: Type.STRING },
                },
              },
              imageSearchQueries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    query: { type: Type.STRING, description: 'Concise 2-4 word archival search term for Wikimedia/LOC/NASA.' },
                    category: { type: Type.STRING, description: 'One of: photograph, map, document, newspaper, archive' },
                    subject: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
        maxRetriesPerModel: 1,
      });
      parsed = extractJsonFromText<any>(structuredResp.text, {});
    }

    const envRaw = String(parsed?.visualDirection?.worldEnvironment || 'desk').toLowerCase();
    const worldEnvironment: WorldEnvironment =
      envRaw === 'map' || envRaw === 'board' || envRaw === 'archive' ? envRaw : 'desk';

    const validCategories = new Set(['photograph', 'map', 'document', 'newspaper', 'archive']);
    const imageSearchQueries = Array.isArray(parsed?.imageSearchQueries)
      ? parsed.imageSearchQueries
          .filter((q: any) => q?.query)
          .slice(0, 6)
          .map((q: any) => ({
            query: String(q.query).slice(0, 100),
            category: (validCategories.has(q.category) ? q.category : 'photograph') as ArchivalAsset['category'],
            subject: String(q.subject || q.query).slice(0, 140),
          }))
      : [{ query: params.topic.slice(0, 80), category: 'photograph' as const, subject: params.topic }];

    return {
      summary: String(parsed?.summary || groundedText || `Research dossier for ${params.topic}`).slice(0, 18000),
      entities: {
        people: Array.isArray(parsed?.entities?.people) ? parsed.entities.people.slice(0, 12) : [],
        organizations: Array.isArray(parsed?.entities?.organizations) ? parsed.entities.organizations.slice(0, 12) : [],
        events: Array.isArray(parsed?.entities?.events) ? parsed.entities.events.slice(0, 12) : [],
        dates: Array.isArray(parsed?.entities?.dates) ? parsed.entities.dates.slice(0, 12) : [],
        locations: Array.isArray(parsed?.entities?.locations) ? parsed.entities.locations.slice(0, 12) : [],
      },
      sources: webSources,
      visualDirection: {
        worldEnvironment,
        cinematographyNotes:
          parsed?.visualDirection?.cinematographyNotes ||
          'One continuous top-down and angled camera traversal across physical archival artifacts with restrained push-ins.',
        lightingStyle:
          parsed?.visualDirection?.lightingStyle ||
          'Warm tungsten directional key light with deep obsidian shadows and subtle paper highlight roll-off.',
        colorPalette:
          Array.isArray(parsed?.visualDirection?.colorPalette) && parsed.visualDirection.colorPalette.length > 0
            ? parsed.visualDirection.colorPalette.slice(0, 5)
            : ['#0B0B0D', '#1A1C22', '#E5A03A', '#D9D2C5', '#7C8594'],
        typographyStyle:
          parsed?.visualDirection?.typographyStyle ||
          'Editorial serif display titles paired with high-contrast archival date stamps; minimal words per frame.',
        cameraLanguage:
          parsed?.visualDirection?.cameraLanguage ||
          'Continuous gliding moves between artifacts, decelerating to a gentle breathing drift on pivotal sentences.',
        physicalMotifs: Array.isArray(parsed?.visualDirection?.physicalMotifs)
          ? parsed.visualDirection.physicalMotifs.slice(0, 6)
          : ['Archival gelatin prints', 'Annotated maps', 'Declassified memos', 'Broadsheet clippings'],
        referenceNotes:
          parsed?.visualDirection?.referenceNotes ||
          'Inspired by investigative archival cinema and editorial broadsheet motion design.',
      },
      imageSearchQueries,
    };
  }
}

export class GeminiScriptService implements IScriptGenerationService {
  async generateOrRefineScript(params: {
    topic: string;
    existingScript?: string;
    researchSummary?: string;
    entities?: ResearchEntities;
    targetDurationSec: number;
    language: string;
    narrationStyle?: string;
  }): Promise<GeneratedScriptResult> {
    const targetWords = Math.max(90, Math.min(900, Math.round((params.targetDurationSec / 60) * 135)));
    const targetParagraphs = Math.max(4, Math.min(9, Math.round(targetWords / 45)));

    const prompt = params.existingScript
      ? `You are an award-winning documentary script editor. Refine the narration pacing and spoken clarity of this supplied documentary script WITHOUT altering its factual meaning. Separate it into ${targetParagraphs} clean narration segments.
Language: ${params.language}
Tone: ${params.narrationStyle || 'Investigative, natural, human documentary voice'}
Supplied script:
${params.existingScript}
${params.researchSummary ? `\nResearch context:\n${params.researchSummary.slice(0, 4000)}` : ''}`
      : `You are an award-winning documentary writer. Write a compelling, factually accurate spoken documentary script designed to be read aloud by a human narrator.
Topic: ${params.topic}
Language: ${params.language}
Target length: approximately ${targetWords} words across ${targetParagraphs} focused narration segments (~${params.targetDurationSec} seconds spoken).
Tone: ${params.narrationStyle || 'Calm, authoritative, investigative documentary storytelling'}.
Research Dossier:
${params.researchSummary || 'Use verified historical facts only.'}
${params.entities ? `Key figures/locations/dates: ${JSON.stringify(params.entities)}` : ''}

Writing rules:
- Strong, grounded opening hook with zero clichés or artificial hype.
- Natural spoken rhythm — short-to-medium sentences that breathe.
- Logical narrative progression, emotional resonance, and a thoughtful closing line.
- Avoid repetitive phrasing, unsupported claims, or sensationalism.
- Include a pronunciation guide for proper nouns, dates, foreign places, or technical terms.`;

    const resp = await generateContentWithResilience({
      models: TEXT_MODELS,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            paragraphs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING, description: 'Short segment title (e.g., Opening Frame, The Turning Point).' },
                  text: { type: Type.STRING, description: 'Exact spoken narration prose for this segment.' },
                  researchRef: { type: Type.STRING, description: 'Key fact or archive reference supporting this paragraph.' },
                  visualCue: { type: Type.STRING, description: 'Suggested real-world photograph, document, or map subject.' },
                },
              },
            },
            pronunciationGuide: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  phonetic: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = extractJsonFromText<any>(resp.text, {});
    const rawParas = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs : [];
    let paragraphs: ScriptParagraph[] = rawParas
      .filter((p: any) => p?.text && String(p.text).trim().length > 0)
      .map((p: any, i: number) => {
        const text = String(p.text).trim();
        const words = text.split(/\s+/).filter(Boolean).length;
        const item: ScriptParagraph = {
          id: `para_${i + 1}_${Date.now().toString(36)}`,
          heading: String(p.heading || `Segment ${i + 1}`).slice(0, 120),
          text,
          estimatedSec: Math.max(3, Math.round((words / 138) * 60)),
        };
        if (p.researchRef) item.researchRef = String(p.researchRef).slice(0, 300);
        if (p.visualCue) item.visualCue = String(p.visualCue).slice(0, 240);
        return item;
      });

    // If model returned plain prose instead of structured JSON, salvage into clean paragraphs
    if (paragraphs.length === 0 && resp.text && resp.text.trim().length > 40) {
      const blocks = resp.text
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .split(/\n\s*\n+/)
        .map((b) => b.trim())
        .filter((b) => b.length > 20 && !b.startsWith('{') && !b.startsWith('}'));
      paragraphs = blocks.slice(0, 9).map((text, i) => {
        const words = text.split(/\s+/).filter(Boolean).length;
        return {
          id: `para_${i + 1}_${Date.now().toString(36)}`,
          heading: i === 0 ? 'Opening Frame' : `Segment ${i + 1}`,
          text,
          estimatedSec: Math.max(3, Math.round((words / 138) * 60)),
        };
      });
    }

    if (paragraphs.length === 0) {
      throw new Error('Script generation returned an empty draft. Please retry.');
    }

    const pronunciationGuide: PronunciationEntry[] = Array.isArray(parsed?.pronunciationGuide)
      ? parsed.pronunciationGuide
          .filter((e: any) => e?.term && e?.phonetic)
          .slice(0, 30)
          .map((e: any) => {
            const entry: PronunciationEntry = {
              term: String(e.term).slice(0, 100),
              phonetic: String(e.phonetic).slice(0, 120),
            };
            if (e.notes) entry.notes = String(e.notes).slice(0, 200);
            return entry;
          })
      : [];

    const wordCount = paragraphs.reduce((acc, p) => acc + p.text.split(/\s+/).filter(Boolean).length, 0);
    const estimatedDurationSec = paragraphs.reduce((acc, p) => acc + p.estimatedSec, 0);

    return { paragraphs, pronunciationGuide, wordCount, estimatedDurationSec };
  }

  async regenerateParagraph(params: {
    topic: string;
    paragraph: ScriptParagraph;
    surroundingContext: string;
    instruction: string;
    language: string;
  }): Promise<ScriptParagraph> {
    const resp = await generateContentWithResilience({
      models: TEXT_MODELS,
      contents: `Rewrite ONLY this single documentary narration paragraph while maintaining seamless continuity with the surrounding script.
Topic: ${params.topic}
Language: ${params.language}
Surrounding script context:
${params.surroundingContext.slice(0, 2500)}

Current paragraph (${params.paragraph.heading}):
${params.paragraph.text}

Revision instruction: ${params.instruction || 'Tighten the spoken rhythm and deepen documentary clarity without changing verified facts.'}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            heading: { type: Type.STRING },
            text: { type: Type.STRING },
            researchRef: { type: Type.STRING },
            visualCue: { type: Type.STRING },
          },
        },
      },
    });

    const parsed = extractJsonFromText<any>(resp.text, {});
    const text = String(parsed?.text || params.paragraph.text).trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      ...params.paragraph,
      heading: String(parsed?.heading || params.paragraph.heading).slice(0, 120),
      text,
      researchRef: parsed?.researchRef ? String(parsed.researchRef).slice(0, 300) : params.paragraph.researchRef,
      visualCue: parsed?.visualCue ? String(parsed.visualCue).slice(0, 240) : params.paragraph.visualCue,
      estimatedSec: Math.max(3, Math.round((words / 138) * 60)),
    };
  }
}

function detectPausesFromWav(buffer: Buffer, totalDurationMs: number): PauseMarker[] {
  const { pcm, sampleRate, bitsPerSample } = extractWavPcmData(buffer);
  if (pcm.length < 400 || bitsPerSample !== 16) return [];

  const windowMs = 40;
  const samplesPerWindow = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const totalSamples = Math.floor(pcm.length / 2);
  const pauses: PauseMarker[] = [];

  let silenceStartMs: number | null = null;
  for (let s = 0; s < totalSamples; s += samplesPerWindow) {
    let sumSq = 0;
    const end = Math.min(totalSamples, s + samplesPerWindow);
    for (let i = s; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - s));
    const currentMs = Math.round((s / sampleRate) * 1000);

    if (rms < 0.015) {
      if (silenceStartMs === null) silenceStartMs = currentMs;
    } else if (silenceStartMs !== null) {
      const dur = currentMs - silenceStartMs;
      if (dur >= 240 && silenceStartMs > 120 && currentMs < totalDurationMs - 120) {
        pauses.push({ startMs: silenceStartMs, endMs: currentMs, durationMs: dur });
      }
      silenceStartMs = null;
    }
  }
  return pauses.slice(0, 80);
}

export function alignWordsToDuration(
  text: string,
  offsetStartMs: number,
  durationMs: number,
  pauses: PauseMarker[] = []
): WordTimestamp[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Weight each word by syllable/character length and punctuation pauses
  const weights = words.map((w) => {
    const clean = w.replace(/[^a-zA-Z0-9]/g, '');
    let weight = Math.max(2, clean.length);
    if (/[.!?]$/.test(w)) weight += 5;
    else if (/[,;:—–-]$/.test(w)) weight += 2.5;
    return weight;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  // Exclude detected internal silences slightly when distributing speech
  const speechMs = Math.max(durationMs * 0.85, durationMs - pauses.reduce((a, p) => a + Math.min(p.durationMs, 300), 0));
  const scale = durationMs / Math.max(1, speechMs);
  let cursor = offsetStartMs;

  return words.map((word, idx) => {
    const span = Math.max(80, Math.round((weights[idx] / totalWeight) * speechMs * Math.min(scale, 1.15)));
    const startMs = Math.min(offsetStartMs + durationMs - 60, Math.round(cursor));
    const endMs = Math.min(offsetStartMs + durationMs, startMs + span);
    cursor = endMs;
    const isProperOrNumeric = /^[A-Z0-9]/.test(word) && idx > 0;
    return {
      word,
      startMs,
      endMs,
      emphasis: isProperOrNumeric || /\d{4}/.test(word),
    };
  });
}

export class GeminiAudioAnalysisService implements IAudioAnalysisService {
  async analyzeAudioBuffer(params: {
    buffer: Buffer;
    mimeType: string;
    knownScriptSegments?: Array<{ id?: string; text: string; durationMs?: number }>;
  }): Promise<AnalyzedAudioResult> {
    const wavInfo = getWavDurationMs(params.buffer);
    const waveformPeaks = computeWaveformPeaks(params.buffer, 180);
    const pauses = detectPausesFromWav(params.buffer, wavInfo.durationMs);

    // If script segments + their true durations are already known (generated WAVs),
    // align exact timestamps directly against actual audio durations + real pause detection.
    if (params.knownScriptSegments && params.knownScriptSegments.length > 0) {
      let cursor = 0;
      const gapMs = 280;
      const segments = params.knownScriptSegments.map((seg, idx) => {
        const dur = seg.durationMs || Math.round(wavInfo.durationMs / params.knownScriptSegments!.length);
        const startMs = cursor;
        const endMs = startMs + dur;
        const segPauses = pauses.filter((p) => p.startMs >= startMs && p.endMs <= endMs);
        const wordTimestamps = alignWordsToDuration(seg.text, startMs, dur, segPauses);
        cursor = endMs + gapMs;
        return {
          orderIndex: idx,
          text: seg.text,
          startMs,
          endMs,
          durationMs: dur,
          wordTimestamps,
          pauseMarkers: segPauses,
        };
      });

      return {
        transcript: segments.map((s) => s.text).join('\n\n'),
        durationMs: Math.max(wavInfo.durationMs, cursor - gapMs),
        sampleRate: wavInfo.sampleRate,
        waveformPeaks,
        segments,
      };
    }

    // Mode C: Uploaded voiceover — transcribe with gemini-3.5-transcribe
    const base64Audio = params.buffer.toString('base64');
    const transcribeResp = await generateContentWithResilience({
      models: ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'],
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType || 'audio/wav',
              data: base64Audio,
            },
          },
          {
            text: 'Transcribe this documentary voiceover accurately with natural sentence punctuation and paragraph breaks.',
          },
        ],
      },
      maxRetriesPerModel: 2,
    });

    const transcript = (transcribeResp.text || '').trim();
    const rawBlocks = transcript
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // If only 1 block, split into balanced 2-3 sentence narration segments
    const blocks: string[] =
      rawBlocks.length >= 2
        ? rawBlocks
        : (transcript.match(/[^.!?]+[.!?]+/g) || [transcript || 'Uploaded narration audio']).reduce<string[]>(
            (acc, sentence) => {
              const last = acc[acc.length - 1];
              if (!last || last.split(/\s+/).length >= 34) {
                acc.push(sentence.trim());
              } else {
                acc[acc.length - 1] = `${last} ${sentence.trim()}`;
              }
              return acc;
            },
            []
          );

    const totalChars = blocks.reduce((a, b) => a + Math.max(1, b.length), 0) || 1;
    let cursor = 0;
    const segments = blocks.map((text, idx) => {
      const share = Math.max(1500, Math.round((text.length / totalChars) * wavInfo.durationMs));
      const startMs = cursor;
      const endMs = idx === blocks.length - 1 ? Math.max(startMs + 1000, wavInfo.durationMs) : startMs + share;
      const dur = endMs - startMs;
      cursor = endMs;
      const segPauses = pauses.filter((p) => p.startMs >= startMs && p.endMs <= endMs);
      return {
        orderIndex: idx,
        text,
        startMs,
        endMs,
        durationMs: dur,
        wordTimestamps: alignWordsToDuration(text, startMs, dur, segPauses),
        pauseMarkers: segPauses,
      };
    });

    return {
      transcript,
      durationMs: wavInfo.durationMs,
      sampleRate: wavInfo.sampleRate,
      waveformPeaks,
      segments,
    };
  }
}

export interface PacedBeatSlice {
  segmentId: string;
  orderIndex: number;
  text: string;
  startMs: number;
  endMs: number;
  wordTimestamps: WordTimestamp[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'they', 'their', 'there', 'were', 'when', 'where',
  'what', 'which', 'would', 'could', 'should', 'into', 'over', 'after', 'before', 'about', 'have',
  'been', 'being', 'more', 'most', 'some', 'such', 'than', 'then', 'very', 'just', 'also', 'only',
  'even', 'still', 'while', 'between', 'under', 'through', 'because', 'during', 'these', 'those',
]);

/**
 * Subdivides narration segments into fast, punchy 2.0–3.6 second modern documentary beats
 * aligned cleanly to exact word timestamps and clause boundaries.
 */
export function subdivideSegmentsIntoPacedBeats(
  segments: Array<{
    id: string;
    orderIndex: number;
    text: string;
    startMs: number;
    endMs: number;
    wordTimestamps?: WordTimestamp[];
  }>,
  targetBeatMs = 2800
): PacedBeatSlice[] {
  const result: PacedBeatSlice[] = [];
  const minBeatMs = 1900;
  const maxBeatMs = 3600;
  let prevEnd = 0;

  for (const seg of segments) {
    const startMs = Math.max(prevEnd, Math.round(Number(seg.startMs) || prevEnd));
    const endMs = Math.max(startMs + 1200, Math.round(Number(seg.endMs) || startMs + 3000));
    const segDur = endMs - startMs;

    const words =
      Array.isArray(seg.wordTimestamps) && seg.wordTimestamps.length > 0
        ? seg.wordTimestamps
        : alignWordsToDuration(seg.text || '', startMs, segDur, []);

    if (segDur <= maxBeatMs || words.length <= 5) {
      result.push({
        segmentId: seg.id,
        orderIndex: result.length,
        text: seg.text.trim(),
        startMs,
        endMs,
        wordTimestamps: words,
      });
      prevEnd = endMs;
      continue;
    }

    const desiredCount = Math.max(2, Math.min(12, Math.round(segDur / targetBeatMs)));
    const targetSliceMs = segDur / desiredCount;
    let sliceStartIdx = 0;
    let sliceStartMs = startMs;

    for (let s = 0; s < desiredCount; s++) {
      const isLast = s === desiredCount - 1;
      if (isLast) {
        const chunkWords = words.slice(sliceStartIdx);
        if (chunkWords.length === 0) break;
        result.push({
          segmentId: seg.id,
          orderIndex: result.length,
          text: chunkWords.map((w) => w.word).join(' ').trim(),
          startMs: sliceStartMs,
          endMs,
          wordTimestamps: chunkWords,
        });
        break;
      }

      const idealEndMs = startMs + Math.round((s + 1) * targetSliceMs);
      const remainingSlices = desiredCount - s - 1;
      const maxAllowedIdx = Math.max(sliceStartIdx + 3, words.length - remainingSlices * 3);

      let bestIdx = Math.min(maxAllowedIdx, sliceStartIdx + Math.max(3, Math.floor((words.length - sliceStartIdx) / (remainingSlices + 1))));
      let bestScore = Number.POSITIVE_INFINITY;

      for (let i = sliceStartIdx + 2; i < Math.min(words.length - 2, maxAllowedIdx + 2); i++) {
        const w = words[i];
        const wEnd = Math.min(endMs, Math.max(sliceStartMs + 500, w.endMs));
        const dur = wEnd - sliceStartMs;
        if (dur < minBeatMs * 0.72) continue;
        if (dur > maxBeatMs * 1.15 && bestScore < Number.POSITIVE_INFINITY) break;

        let penalty = Math.abs(wEnd - idealEndMs);
        if (/[.!?]$/.test(w.word)) penalty -= 1100;
        else if (/[,;:—–-]$/.test(w.word)) penalty -= 550;

        if (penalty < bestScore) {
          bestScore = penalty;
          bestIdx = i + 1;
        }
      }

      bestIdx = Math.max(sliceStartIdx + 2, Math.min(words.length - 2, bestIdx));
      const chunkWords = words.slice(sliceStartIdx, bestIdx);
      const nextWord = words[bestIdx];
      const sliceEndMs = Math.max(
        sliceStartMs + 1400,
        Math.min(endMs - 1400, nextWord ? nextWord.startMs : chunkWords[chunkWords.length - 1]?.endMs || idealEndMs)
      );

      result.push({
        segmentId: seg.id,
        orderIndex: result.length,
        text: chunkWords.map((w) => w.word).join(' ').trim(),
        startMs: sliceStartMs,
        endMs: sliceEndMs,
        wordTimestamps: chunkWords,
      });

      sliceStartIdx = bestIdx;
      sliceStartMs = sliceEndMs;
    }

    prevEnd = endMs;
  }

  return result;
}

function extractDateBadge(text: string): string {
  const fullDate = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/i
  );
  if (fullDate) return fullDate[0].toUpperCase().slice(0, 32);

  const monthYear = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/i
  );
  if (monthYear) return monthYear[0].toUpperCase().slice(0, 32);

  const yearRange = text.match(/\b(1[0-9]{3}|20[0-2][0-9])\s*[–-]\s*(1[0-9]{3}|20[0-2][0-9])\b/);
  if (yearRange) return `${yearRange[1]}–${yearRange[2]}`;

  const year = text.match(/\b(1[0-9]{3}|20[0-2][0-9]|[5-9]\d{2}\s*(?:BCE|CE|AD|BC))\b/i);
  if (year) return year[0].toUpperCase();

  return '';
}

function extractHighlightWords(text: string, triggerWord: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    const clean = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9%$]+$/g, '');
    if (clean.length < 3 || STOP_WORDS.has(clean.toLowerCase())) return;
    if (!seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
  };
  if (triggerWord) add(triggerWord);
  for (const token of text.split(/\s+/)) {
    if (/\d/.test(token) || (/^[A-Z]/.test(token) && token.length >= 4)) {
      add(token);
    }
    if (out.length >= 5) break;
  }
  if (out.length < 3) {
    for (const token of text.split(/\s+/)) {
      const clean = token.replace(/[^a-zA-Z0-9]/g, '');
      if (clean.length >= 6) add(clean);
      if (out.length >= 4) break;
    }
  }
  return out.slice(0, 5);
}

function buildBeatMapSpec(
  region: MapRegionId,
  text: string,
  dateBadge: string,
  idx: number,
  accentHex: string
): BeatMapSpec {
  const regionData = MAP_REGIONS[region] || MAP_REGIONS.world;
  const hubs = regionData.defaultLabels;
  const hubA = hubs[idx % hubs.length] || { text: regionData.label, x: 35, y: 48 };
  const hubB = hubs[(idx + 1) % hubs.length] || { text: 'Target Zone', x: 64, y: 42 };
  const hubC = hubs[(idx + 2) % hubs.length];

  const isConflict = /\b(war|battle|attack|army|march|invad|front|troops|siege|conflict|retreat|offensive)\b/i.test(text);
  const secondaryHex = isConflict ? '#DC2626' : '#2563EB';

  const markers: NonNullable<BeatMapSpec['markers']> = [
    {
      label: hubA.text,
      x: hubA.x,
      y: hubA.y,
      kind: isConflict ? 'battle' : 'city',
      color: accentHex,
    },
    {
      label: hubB.text,
      x: hubB.x,
      y: hubB.y,
      kind: isConflict ? 'event' : 'capital',
      color: secondaryHex,
    },
  ];
  if (hubC && idx % 2 === 1) {
    markers.push({
      label: hubC.text,
      x: hubC.x,
      y: hubC.y,
      kind: 'city',
      color: accentHex,
    });
  }

  return {
    region,
    dateLabel: dateBadge || undefined,
    focusX: Math.max(28, Math.min(72, (hubA.x + hubB.x) / 2)),
    focusY: Math.max(28, Math.min(72, (hubA.y + hubB.y) / 2)),
    zoom: 1.24,
    markers,
    routes: [
      {
        fromX: hubA.x,
        fromY: hubA.y,
        toX: hubB.x,
        toY: hubB.y,
        color: isConflict ? '#EF4444' : accentHex,
        label: isConflict ? 'ADVANCE' : 'ROUTE',
        dashed: !isConflict,
      },
    ],
    territories: [
      {
        label: hubA.text,
        color: accentHex,
        x: hubA.x,
        y: hubA.y,
        radius: 13,
      },
      {
        label: hubB.text,
        color: secondaryHex,
        x: hubB.x,
        y: hubB.y,
        radius: 10,
      },
    ],
  };
}

function buildBeatCallouts(
  text: string,
  calloutLabel: string,
  highlightWords: string[],
  dateBadge: string
): BeatCalloutItem[] {
  const items: BeatCalloutItem[] = [];
  const primary = calloutLabel || highlightWords[0] || '';
  if (primary) {
    items.push({
      label: primary.slice(0, 40),
      value: dateBadge || undefined,
      x: 24,
      y: 27,
      anchorX: 42,
      anchorY: 46,
      appearAt: 0.14,
    });
  }
  const second = highlightWords.find((w) => w.toLowerCase() !== primary.toLowerCase());
  const numMatch = text.match(/\b\d[\d,.]*(?:\s*(?:million|billion|thousand|years|days|miles|km|%|percent|hours|seconds))?\b/i);
  if (second || numMatch) {
    items.push({
      label: (second || 'Key Metric').slice(0, 40),
      value: numMatch ? numMatch[0].slice(0, 24) : undefined,
      x: 77,
      y: 34,
      anchorX: 58,
      anchorY: 52,
      appearAt: 0.38,
    });
  }
  return items.slice(0, 3);
}

function pickDefaultSceneTypeForPreset(
  presetId: VideoStylePresetId,
  text: string,
  idx: number,
  total: number,
  hasAsset: boolean
): BeatSceneType {
  if (idx === 0 && total >= 4) {
    return presetId === 'history_on_maps' ? 'animated_map' : 'kinetic_title';
  }
  const geoMentioned = /\b(map|border|country|nation|empire|region|ocean|sea|island|city|capital|territory|war|march|route|colony|invad|front|mexico|texas|australia|europe|asia|america|britain|france|russia|china|india|egypt|rome)\b/i.test(
    text
  );
  const statMentioned = /\b(\d+%|\d+\s*(?:million|billion|thousand|years|days|times|percent|seconds|hours)|compared|versus|ratio|scale|clock|measure|step|mechanism|how\s+it\s+works)\b/i.test(
    text
  );

  if (presetId === 'history_on_maps') {
    if (idx % 4 === 3 && hasAsset) return 'layered_cutout';
    return 'animated_map';
  }
  if (presetId === 'simple_history') {
    if (geoMentioned && idx % 3 === 1) return 'animated_map';
    if (statMentioned || idx % 3 === 2) return 'diagram_callout';
    return 'illustrated_scene';
  }
  if (presetId === 'ted_ed') {
    if (geoMentioned && idx % 4 === 2) return 'animated_map';
    if (statMentioned && idx % 3 === 1) return 'diagram_callout';
    return 'illustrated_scene';
  }
  if (presetId === 'minute_earth') {
    if (geoMentioned && idx % 4 === 2) return 'animated_map';
    if (statMentioned || idx % 3 === 1) return 'diagram_callout';
    return 'illustrated_scene';
  }
  if (presetId === 'historically') {
    if (/\b(map|outback|continent|border|territory|route)\b/i.test(text) || (geoMentioned && idx % 3 === 1)) {
      return 'animated_map';
    }
    if (statMentioned) return 'diagram_callout';
    return idx % 2 === 0 ? 'layered_cutout' : 'illustrated_scene';
  }
  // archival_documentary
  if (/\bmap\b/i.test(text) || (geoMentioned && idx % 4 === 2)) return 'animated_map';
  return hasAsset ? 'archival_photo' : 'illustrated_scene';
}

function buildUniqueBeatQueryFromNarration(
  topic: string,
  narrationText: string,
  beatIndex: number,
  usedQueries: Set<string>
): string {
  const stopWords = new Set([
    'about', 'after', 'again', 'against', 'almost', 'already', 'always', 'among', 'another',
    'around', 'because', 'before', 'behind', 'being', 'between', 'beyond', 'could', 'during',
    'every', 'first', 'found', 'great', 'however', 'inside', 'into', 'just', 'later', 'little',
    'many', 'might', 'more', 'most', 'never', 'other', 'over', 'people', 'really', 'right',
    'should', 'since', 'small', 'some', 'still', 'story', 'their', 'there', 'these', 'thing',
    'think', 'those', 'three', 'through', 'today', 'under', 'until', 'using', 'very', 'water',
    'where', 'which', 'while', 'within', 'without', 'world', 'would', 'years', 'called', 'became',
  ]);
  const tokens = narrationText
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()));

  const topicHead = topic
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 2)
    .join(' ');

  const uniqueBeatWords: string[] = [];
  for (const w of tokens) {
    if (!uniqueBeatWords.some((u) => u.toLowerCase() === w.toLowerCase())) {
      uniqueBeatWords.push(w);
    }
    if (uniqueBeatWords.length >= 4) break;
  }

  let candidate = `${topicHead} ${uniqueBeatWords.slice(0, 3).join(' ')}`.trim();
  if (!candidate || candidate.length < 4) {
    candidate = `${topic} historical scene ${beatIndex + 1}`;
  }
  const key = candidate.toLowerCase();
  if (usedQueries.has(key)) {
    const extraWord = uniqueBeatWords[3] || tokens[tokens.length - 1] || `archive ${beatIndex + 1}`;
    candidate = `${candidate} ${extraWord}`.trim();
  }
  usedQueries.add(candidate.toLowerCase());
  return candidate.slice(0, 220);
}

function pickStoryboardFirstSceneType(
  presetId: VideoStylePresetId,
  text: string,
  idx: number,
  total: number,
  prevSceneType?: BeatSceneType
): BeatSceneType {
  const geoMentioned = /\b(australia|western australia|europe|america|britain|pacific|atlantic|asia|africa|border|route|coast|outback|continent|map|territory|island|ocean|city|region|miles|kilometers)\b/i.test(
    text
  );
  const statMentioned = /\b(\d{1,3}(?:,\d{3})+|\d+%|\d+\s*(?:million|thousand|billion|rounds|troops|soldiers|emus|ships|miles|years|days|km\/h))\b/i.test(
    text
  );
  const actionMentioned = /\b(march|run|sprint|chase|pursuit|truck|flock|stampede|launch|fly|ship|battle|ambush|gunner|parliament|debate|withdraw|build|fence|farmer|soldier)\b/i.test(
    text
  );

  // Opening beat: kinetic_title or energetic animated_rig hook
  if (idx === 0) {
    return presetId === 'history_on_maps' ? 'animated_map' : 'animated_rig';
  }
  // Map beats when geography is spoken
  if (geoMentioned && prevSceneType !== 'animated_map' && (presetId === 'history_on_maps' || idx % 4 === 1)) {
    return 'animated_map';
  }
  // Cycle thoughtfully across the 4 media pillars: animated_rig, archival_video, archival_photo/layered_cutout, animated_map/diagram_callout
  const cycle: BeatSceneType[] =
    presetId === 'history_on_maps'
      ? ['animated_map', 'animated_rig', 'archival_video', 'layered_cutout', 'diagram_callout']
      : presetId === 'archival_documentary'
      ? ['archival_video', 'layered_cutout', 'animated_rig', 'archival_photo', 'animated_map', 'diagram_callout']
      : ['animated_rig', 'archival_video', 'layered_cutout', 'animated_rig', 'diagram_callout', 'archival_photo'];

  let picked: BeatSceneType;
  if (actionMentioned && prevSceneType !== 'animated_rig' && idx % 2 === 1) {
    picked = 'animated_rig';
  } else if (statMentioned && prevSceneType !== 'diagram_callout') {
    picked = 'diagram_callout';
  } else {
    picked = cycle[idx % cycle.length];
  }

  // Never put two static photo beats back-to-back
  if (
    (picked === 'archival_photo' || picked === 'layered_cutout') &&
    (prevSceneType === 'archival_photo' || prevSceneType === 'layered_cutout')
  ) {
    picked = idx % 2 === 0 ? 'animated_rig' : 'archival_video';
  }
  // Closing beat punctuation
  if (idx === total - 1 && total >= 5 && prevSceneType !== 'kinetic_title') {
    picked = actionMentioned ? 'animated_rig' : 'layered_cutout';
  }
  return picked;
}

export class GeminiStoryboardService implements IStoryboardService {
  async generateStoryboard(params: {
    topic: string;
    researchSummary?: string;
    worldEnvironment: WorldEnvironment;
    videoStylePreset?: VideoStylePresetId;
    visualDirection?: VisualDirection;
    segments: Array<{
      id: string;
      orderIndex: number;
      text: string;
      startMs: number;
      endMs: number;
      wordTimestamps?: WordTimestamp[];
    }>;
    assets?: ArchivalAsset[];
  }): Promise<Array<Omit<StoryboardBeat, 'id' | 'ownerId' | 'projectId' | 'createdAt' | 'updatedAt'>>> {
    const presetId: VideoStylePresetId =
      params.videoStylePreset && VIDEO_STYLE_PRESETS[params.videoStylePreset]
        ? params.videoStylePreset
        : 'historically';
    const preset = VIDEO_STYLE_PRESETS[presetId];

    // Step 1: Subdivide narration segments into fast, punchy 2.0–3.5s modern documentary beats
    const pacedSlices = subdivideSegmentsIntoPacedBeats(
      params.segments,
      presetId === 'archival_documentary' ? 3200 : 2800
    );

    const beatOutline = pacedSlices.map((s, idx) => ({
      i: idx,
      durationSec: Number(((s.endMs - s.startMs) / 1000).toFixed(1)),
      text: s.text.slice(0, 260),
    }));

    const validSceneTypes = new Set<BeatSceneType>([
      'animated_rig',
      'archival_video',
      'animated_map',
      'layered_cutout',
      'diagram_callout',
      'archival_photo',
      'kinetic_title',
    ]);
    const validCam = new Set<StoryboardBeat['cameraMotion']>([
      'push_in',
      'pull_back',
      'pan_left',
      'pan_right',
      'orbit_drift',
      'focus_hold',
    ]);
    const validTrans = new Set<BeatTransitionType>([
      'continuous_glide',
      'pull_reveal',
      'desk_sweep',
      'map_flight',
      'whip_pan',
      'paper_slide',
      'zoom_punch',
      'iris_reveal',
      'cut_pop',
    ]);
    const validSfx = new Set<SfxCueType>([
      'none',
      'paper_slide',
      'document_land',
      'soft_impact',
      'map_pin',
      'whoosh',
      'pop_in',
      'stamp_hit',
      'map_ping',
      'chalk_draw',
    ]);
    const validRegions = new Set<MapRegionId>(Object.keys(MAP_REGIONS) as MapRegionId[]);

    let rawBeats: any[] = [];
    try {
      const resp = await generateContentWithResilience({
        models: TEXT_MODELS,
        attemptTimeoutMs: 45000,
        maxRetriesPerModel: 0,
        contents: `You are an elite YouTube documentary director designing a STORYBOARD-FIRST Shot Blueprint in the "${preset.label}" aesthetic (${preset.referenceChannel}: ${preset.shortDesc}).
Topic: "${params.topic}"
Research Context: "${(params.researchSummary || '').slice(0, 800)}"
Art Direction: ${preset.illustrationStylePrompt}

CRITICAL RULE: We have NOT fetched media yet — Step 5 will fulfill every beat 1-to-1 with a STRICTLY UNIQUE asset (ZERO repeated photos, clips, or rigs!).
Therefore, for EVERY single one of the ${beatOutline.length} narration-synced beats below, plan the EXACT visual that directly matches what the narrator is saying right then!

Mix all four documentary visual mediums thoughtfully across the timeline:
1. "animated_rig" (~35-45% of beats): Code-generated Vox/Kurzgesagt flat-vector moving characters, flocks, vehicles, machines, debates, or dynamic charts.
2. "archival_video" (~15-20% of beats): Real public-domain archival video clip from Wikimedia Commons or NASA matching that beat's motion/setting.
3. "layered_cutout" / "archival_photo" / "diagram_callout" (~25-35% of beats): Authentic unique historical photo, newspaper, or annotated data cutout. NEVER put two identical static photo subjects back-to-back!
4. "animated_map" (~10-15% of beats): Animated vector cartography with route arrows when locations, regions, borders, or journeys are spoken.

Narration Beats (${beatOutline.length}):
${JSON.stringify(beatOutline)}

Return exactly ${beatOutline.length} items in "beats", one per beat index i (0..${beatOutline.length - 1}):
- beatIndex: integer matching i
- sceneType: animated_rig | archival_video | layered_cutout | archival_photo | animated_map | diagram_callout | kinetic_title
- shotBrief: vivid 1-sentence director visual description (10-22 words) explaining EXACTLY what the viewer sees during this beat's spoken words
- assetSearchQuery: hyper-specific, UNIQUE 3-6 word public-archive search query for THIS beat's nouns/entities (e.g. "Lewis machine gun 1930s", "Western Australia wheat harvest 1932", "wild emu running Australia") — EVERY beat MUST have a DIFFERENT search query!
- rigPrompt: concrete 10-20 word animation choreography brief specifying moving flat-vector actors & actions (used for animated_rig beats and smart fallback)
- onScreenText: 0–4 punchy display words (year, place, stat, or bold hook — NEVER repeat the full narration sentence)
- triggerWord: one exact key spoken word from that beat's text
- dateBadge: concise year/date badge if a year/era applies (e.g. "NOV 1932", "1932") or ""
- calloutLabel: 1–3 word diagram/callout tag (e.g. "20,000 EMUS", "50 KM/H SPRINT") or ""
- mapRegion: world | north_america | europe | australia | asia | middle_east | south_america | pacific | atlantic
- cameraMotion: push_in | pull_back | pan_left | pan_right | orbit_drift | focus_hold
- transition: ${preset.defaultTransition} | whip_pan | paper_slide | zoom_punch | iris_reveal | cut_pop | map_flight | continuous_glide
- sfxCue: whoosh | pop_in | paper_slide | stamp_hit | map_ping | chalk_draw | document_land | soft_impact | map_pin | none`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              beats: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    beatIndex: { type: Type.INTEGER },
                    sceneType: { type: Type.STRING },
                    shotBrief: { type: Type.STRING },
                    assetSearchQuery: { type: Type.STRING },
                    rigPrompt: { type: Type.STRING },
                    onScreenText: { type: Type.STRING },
                    triggerWord: { type: Type.STRING },
                    dateBadge: { type: Type.STRING },
                    calloutLabel: { type: Type.STRING },
                    mapRegion: { type: Type.STRING },
                    cameraMotion: { type: Type.STRING },
                    transition: { type: Type.STRING },
                    sfxCue: { type: Type.STRING },
                  },
                  required: [
                    'beatIndex',
                    'sceneType',
                    'shotBrief',
                    'assetSearchQuery',
                    'rigPrompt',
                    'onScreenText',
                    'triggerWord',
                    'cameraMotion',
                    'transition',
                    'sfxCue',
                  ],
                },
              },
            },
            required: ['beats'],
          },
        },
      });

      const parsed = extractJsonFromText<any>(resp.text, {});
      rawBeats = Array.isArray(parsed?.beats) ? parsed.beats : [];
    } catch (err) {
      console.warn('Storyboard-First LLM blueprint fell back to deterministic director planner:', err);
      rawBeats = [];
    }

    const byBeatIndex = new Map<number, any>();
    for (let i = 0; i < rawBeats.length; i++) {
      const b = rawBeats[i];
      const bIdx = Number.isInteger(b?.beatIndex) ? b.beatIndex : i;
      if (!byBeatIndex.has(bIdx)) {
        byBeatIndex.set(bIdx, b);
      }
    }

    const camCycle: StoryboardBeat['cameraMotion'][] = [
      'push_in',
      'pan_right',
      'pull_back',
      'orbit_drift',
      'pan_left',
      'focus_hold',
    ];
    const presetSfxPalette: Record<VideoStylePresetId, SfxCueType[]> = {
      ted_ed: ['whoosh', 'pop_in', 'chalk_draw', 'soft_impact'],
      simple_history: ['stamp_hit', 'paper_slide', 'whoosh', 'document_land'],
      history_on_maps: ['map_ping', 'whoosh', 'map_pin', 'soft_impact'],
      minute_earth: ['chalk_draw', 'pop_in', 'paper_slide', 'whoosh'],
      historically: ['whoosh', 'pop_in', 'stamp_hit', 'map_ping'],
      archival_documentary: ['document_land', 'paper_slide', 'soft_impact', 'map_pin'],
    };
    const sfxCycle = presetSfxPalette[presetId];

    let runningDate = extractDateBadge(params.topic);
    const usedQueries = new Set<string>();
    let prevSceneType: BeatSceneType | undefined;

    return pacedSlices.map((slice, idx) => {
      const dir = byBeatIndex.get(idx) || rawBeats[idx] || {};

      const words = slice.text.split(/\s+/).filter(Boolean);
      const rawTrigger = String(dir.triggerWord || '').trim();
      const triggerWord = (rawTrigger || words[Math.min(2, Math.max(0, words.length - 1))] || '').slice(0, 80);

      const detectedDate = String(dir.dateBadge || '').trim().slice(0, 40) || extractDateBadge(slice.text);
      if (detectedDate) runningDate = detectedDate;
      const dateBadge = detectedDate || (presetId === 'history_on_maps' ? runningDate : '');

      let sceneType: BeatSceneType = validSceneTypes.has(dir.sceneType)
        ? dir.sceneType
        : pickStoryboardFirstSceneType(presetId, slice.text, idx, pacedSlices.length, prevSceneType);

      // Avoid three identical scene types in a row to keep modern pacing punchy and varied
      if (sceneType === prevSceneType && sceneType !== 'animated_rig' && idx > 0) {
        sceneType = pickStoryboardFirstSceneType(presetId, slice.text, idx, pacedSlices.length, prevSceneType);
      }
      prevSceneType = sceneType;

      // Ensure unique assetSearchQuery per beat
      const rawQuery = String(dir.assetSearchQuery || '').trim().slice(0, 240);
      let assetSearchQuery = rawQuery;
      if (!assetSearchQuery || usedQueries.has(assetSearchQuery.toLowerCase())) {
        assetSearchQuery = buildUniqueBeatQueryFromNarration(params.topic, slice.text, idx, usedQueries);
      } else {
        usedQueries.add(assetSearchQuery.toLowerCase());
      }

      const shotBrief =
        String(dir.shotBrief || '').trim().slice(0, 560) ||
        `${sceneType.replace('_', ' ')} visualizing: ${slice.text.slice(0, 160)}`;

      const rigPrompt =
        String(dir.rigPrompt || '').trim().slice(0, 560) ||
        `Animated flat-vector scene depicting ${shotBrief}`;

      const rawOnScreen = String(dir.onScreenText || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(' ')
        .slice(0, 120);

      const fallbackOnScreen =
        sceneType === 'kinetic_title'
          ? params.topic.split(/\s+/).slice(0, 4).join(' ').toUpperCase()
          : dateBadge || '';

      const onScreenText = rawOnScreen || fallbackOnScreen;
      const highlightWords = extractHighlightWords(slice.text, triggerWord);

      const objectType: BeatObjectType =
        sceneType === 'animated_rig'
          ? 'animated_rig'
          : sceneType === 'archival_video'
          ? 'video_clip'
          : sceneType === 'animated_map'
          ? 'map'
          : sceneType === 'layered_cutout'
          ? 'cutout'
          : sceneType === 'diagram_callout'
          ? 'diagram'
          : sceneType === 'kinetic_title'
          ? 'title_card'
          : 'photo';

      const cameraMotion: StoryboardBeat['cameraMotion'] = validCam.has(dir.cameraMotion)
        ? dir.cameraMotion
        : camCycle[idx % camCycle.length];

      const transition: BeatTransitionType = validTrans.has(dir.transition)
        ? dir.transition
        : sceneType === 'animated_map'
        ? 'map_flight'
        : sceneType === 'animated_rig'
        ? idx % 2 === 0
          ? 'zoom_punch'
          : 'whip_pan'
        : preset.defaultTransition;

      const sfxCue: SfxCueType = validSfx.has(dir.sfxCue)
        ? dir.sfxCue
        : sceneType === 'animated_map'
        ? 'map_ping'
        : sceneType === 'animated_rig'
        ? idx % 2 === 0
          ? 'whoosh'
          : 'pop_in'
        : sfxCycle[idx % sfxCycle.length];

      const regionCandidate = String(dir.mapRegion || '').trim() as MapRegionId;
      const mapRegion: MapRegionId = validRegions.has(regionCandidate)
        ? regionCandidate
        : detectMapRegionFromText(`${params.topic} ${slice.text}`);

      const mapSpec =
        sceneType === 'animated_map'
          ? buildBeatMapSpec(mapRegion, slice.text, dateBadge, idx, preset.palette.accent)
          : undefined;

      const calloutLabel = String(dir.calloutLabel || '').trim().slice(0, 48);
      const calloutItems =
        sceneType === 'diagram_callout' || sceneType === 'layered_cutout'
          ? buildBeatCallouts(slice.text, calloutLabel, highlightWords, dateBadge)
          : undefined;

      const wave = idx % 3 === 0 ? -150 : idx % 3 === 1 ? 140 : -40;
      const tilt = idx % 2 === 0 ? -2.2 : 2.4;

      const plannedTitle =
        sceneType === 'animated_rig'
          ? `Planned Rig: ${onScreenText || triggerWord || `Beat ${idx + 1}`}`
          : sceneType === 'archival_video'
          ? `Planned Video: ${assetSearchQuery.slice(0, 60)}`
          : sceneType === 'animated_map'
          ? `${MAP_REGIONS[mapRegion].label} Cartography`
          : sceneType === 'diagram_callout'
          ? `Planned Diagram: ${calloutLabel || assetSearchQuery.slice(0, 50)}`
          : sceneType === 'kinetic_title'
          ? `Kinetic Title: ${onScreenText || params.topic.slice(0, 48)}`
          : `Planned Photo: ${assetSearchQuery.slice(0, 60)}`;

      return {
        orderIndex: idx,
        segmentId: slice.segmentId,
        startMs: slice.startMs,
        endMs: slice.endMs,
        narrationText: slice.text.slice(0, 1800),
        heroAssetId: '',
        heroAssetUrl: '',
        heroVideoUrl: '',
        heroAssetTitle: plannedTitle.slice(0, 280),
        shotBrief,
        assetSearchQuery,
        rigPrompt,
        fulfillmentStatus: 'planned',
        onScreenText,
        triggerWord,
        objectType,
        sceneType,
        illustrationPrompt: shotBrief,
        dateBadge: dateBadge || undefined,
        mapSpec,
        calloutItems,
        highlightWords,
        wordTimestamps: slice.wordTimestamps,
        worldX: 420 + idx * 640,
        worldY: wave,
        worldRotation: tilt,
        worldScale: 1.0,
        cameraMotion,
        cameraZoom: cameraMotion === 'push_in' ? 1.12 : cameraMotion === 'pull_back' ? 0.94 : 1.06,
        transition,
        sfxCue,
        notes: `${preset.label} · ${sceneType.replace('_', ' ')} · ${((slice.endMs - slice.startMs) / 1000).toFixed(1)}s`,
      };
    });
  }
}
