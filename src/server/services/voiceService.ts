import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { NARRATION_PRESETS } from '../../types/cineforge.ts';
import type { AudioPostProcessing, VoiceProfile } from '../../types/cineforge.ts';
import { generateContentWithResilience } from './geminiClient.ts';
import { buildWavFromPcm, getWavDurationMs } from './fileStorageService.ts';
import type {
  IVoiceGenerationService,
  SynthesizedAudioResult,
  SynthesizeSpeechParams,
} from './interfaces.ts';

const execFileAsync = promisify(execFile);

function buildVoiceDirectionPrompt(profile: VoiceProfile, pronunciationHint?: string): string {
  const preset = NARRATION_PRESETS[profile.preset] || NARRATION_PRESETS.investigative;
  const parts = [
    preset.styleInstruction,
    `Language: ${profile.language || 'English'}.`,
    profile.regionalAccent ? `Regional accent: ${profile.regionalAccent}.` : '',
    `Vocal register: ${profile.vocalDepth || 'baritone'} (${profile.gender}).`,
    `Speaking pace: ${profile.speakingSpeed < 0.94 ? 'deliberate and unhurried' : profile.speakingSpeed > 1.04 ? 'crisp and brisk' : 'measured documentary pace'} (${profile.speakingSpeed.toFixed(2)}x).`,
    profile.emotionalCharacter ? `Emotional character: ${profile.emotionalCharacter}.` : '',
    profile.narrationStyle ? `Direction: ${profile.narrationStyle}.` : '',
    pronunciationHint ? `Pronunciation guidance: ${pronunciationHint}.` : '',
    'Deliver natural human documentary phrasing with authentic micro-pauses, zero robotic cadence, no melodrama, and clean sentence endings.',
  ];
  return parts.filter(Boolean).join(' ');
}

export async function applyBroadcastAudioPostProcessing(
  wavBuffer: Buffer,
  post?: AudioPostProcessing
): Promise<Buffer> {
  if (
    !post ||
    (!post.loudnessNormalization &&
      !post.warmEq &&
      !post.gentleCompression &&
      !post.deEsser &&
      !post.noiseReduction)
  ) {
    return wavBuffer;
  }

  const filters: string[] = [];
  if (post.noiseReduction) {
    filters.push('highpass=f=75');
  }
  if (post.warmEq) {
    filters.push('equalizer=f=180:width_type=o:width=1.2:g=1.6,equalizer=f=3200:width_type=o:width=1.4:g=1.2');
  }
  if (post.deEsser) {
    filters.push('equalizer=f=6800:width_type=o:width=0.9:g=-2.4');
  }
  if (post.gentleCompression) {
    filters.push('acompressor=threshold=-20dB:ratio=2.4:attack=15:release=140:makeup=1.5');
  }
  if (post.loudnessNormalization) {
    const target = Number.isFinite(post.targetLufs) ? Math.max(-24, Math.min(-12, post.targetLufs)) : -16;
    filters.push(`loudnorm=I=${target}:TP=-1.5:LRA=11`);
  }

  if (filters.length === 0) return wavBuffer;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cineforge-dsp-'));
  const inPath = path.join(tmpDir, 'in.wav');
  const outPath = path.join(tmpDir, 'out.wav');
  try {
    await fs.writeFile(inPath, wavBuffer);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', inPath, '-af', filters.join(','), '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', outPath],
      { timeout: 25000 }
    );
    return await fs.readFile(outPath);
  } catch (err) {
    console.warn('FFmpeg DSP post-processing fallback to dry WAV:', err);
    return wavBuffer;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export class GeminiTtsService implements IVoiceGenerationService {
  readonly providerName = 'gemini' as const;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async synthesize(params: SynthesizeSpeechParams): Promise<SynthesizedAudioResult> {
    const style = buildVoiceDirectionPrompt(params.voiceProfile, params.pronunciationHint);
    const voiceName = params.voiceProfile.voiceName || 'Charon';
    const ttsConfig = {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    };
    const ttsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

    let response;
    try {
      // Gemini 3.8 TTS requires v1beta for speechConfig & speechMetadata
      response = await generateContentWithResilience({
        models: ttsModels,
        apiVersion: 'v1beta',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: params.text,
                speechMetadata: {
                  style,
                },
              } as any,
            ],
          },
        ],
        config: ttsConfig,
        maxRetriesPerModel: 1,
        attemptTimeoutMs: 35000,
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('speechMetadata')) {
        // Fallback if an upstream variant rejects speechMetadata on parts
        response = await generateContentWithResilience({
          models: ttsModels,
          apiVersion: 'v1beta',
          contents: [
            {
              role: 'user',
              parts: [{ text: params.text }],
            },
          ],
          config: ttsConfig,
          maxRetriesPerModel: 1,
          attemptTimeoutMs: 35000,
        });
      } else {
        throw err;
      }
    }

    const parts = response.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('No audio data returned from Gemini TTS.');
    }

    let wavBuffer: Buffer = Buffer.from(base64Audio, 'base64');
    // Unary Gemini 3.8 TTS returns a complete RIFF WAV file; guard against headerless PCM just in case
    if (wavBuffer.length < 44 || wavBuffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
      wavBuffer = buildWavFromPcm(wavBuffer, 24000, 1, 16);
    }
    wavBuffer = await applyBroadcastAudioPostProcessing(wavBuffer, params.postProcessing);
    const info = getWavDurationMs(wavBuffer);

    return {
      audioBuffer: wavBuffer,
      mimeType: 'audio/wav',
      durationMs: info.durationMs,
      sampleRate: info.sampleRate,
    };
  }
}

export class ElevenLabsTtsService implements IVoiceGenerationService {
  readonly providerName = 'elevenlabs' as const;

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim().length > 5);
  }

  async synthesize(params: SynthesizeSpeechParams): Promise<SynthesizedAudioResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ElevenLabs API key is not configured on the server. Using Gemini TTS instead.');
    }

    // Standard documentary voices in ElevenLabs (Adam / Rachel)
    const voiceId =
      params.voiceProfile.gender === 'female'
        ? '21m00Tcm4TlvDq8ikWAM'
        : 'pNInz6obpgDQGcFmaJgB';

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: params.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.62,
          similarity_boost: 0.78,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`ElevenLabs synthesis failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const pcm = Buffer.from(await resp.arrayBuffer());
    const { buildWavFromPcm } = await import('./fileStorageService.ts');
    let wavBuffer = buildWavFromPcm(pcm, 24000, 1, 16);
    wavBuffer = await applyBroadcastAudioPostProcessing(wavBuffer, params.postProcessing);
    const info = getWavDurationMs(wavBuffer);

    return {
      audioBuffer: wavBuffer,
      mimeType: 'audio/wav',
      durationMs: info.durationMs,
      sampleRate: info.sampleRate,
    };
  }
}

export class VoiceServiceRegistry {
  private providers: Map<'gemini' | 'elevenlabs', IVoiceGenerationService>;

  constructor() {
    this.providers = new Map<'gemini' | 'elevenlabs', IVoiceGenerationService>([
      ['gemini', new GeminiTtsService()],
      ['elevenlabs', new ElevenLabsTtsService()],
    ]);
  }

  getProvider(preferred: 'gemini' | 'elevenlabs'): IVoiceGenerationService {
    const provider = this.providers.get(preferred);
    if (provider && provider.isConfigured()) {
      return provider;
    }
    return this.providers.get('gemini')!;
  }

  getProviderStatus() {
    return {
      gemini: this.providers.get('gemini')!.isConfigured(),
      elevenlabs: this.providers.get('elevenlabs')!.isConfigured(),
    };
  }
}
