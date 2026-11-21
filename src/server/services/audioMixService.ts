import type { AmbientBedId, AudioMixerSettings, SfxCueType } from '../../types/cineforge.ts';
import { extractWavPcmData } from './fileStorageService.ts';

export interface BeatSfxEvent {
  timeMs: number;
  cue: SfxCueType;
}

const TARGET_SAMPLE_RATE = 48000;

function clampSample(v: number): number {
  if (v > 0.98) return 0.98 * Math.tanh(v / 0.98);
  if (v < -0.98) return 0.98 * Math.tanh(v / 0.98);
  return v;
}

function encodeStereoWav48k(left: Float32Array, right: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Buffer {
  const numFrames = left.length;
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.round(clampSample(left[i]) * 32767);
    const r = Math.round(clampSample(right[i]) * 32767);
    buf.writeInt16LE(l, offset);
    buf.writeInt16LE(r, offset + 2);
    offset += 4;
  }
  return buf;
}

function seededNoise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Renders a continuous, musical style-matched background score into stereo Float32 buffers.
 */
export function synthesizeMusicBedStereo(
  bed: AmbientBedId,
  durationSec: number,
  sampleRate = TARGET_SAMPLE_RATE
): { left: Float32Array; right: Float32Array } {
  const totalSamples = Math.max(sampleRate, Math.ceil(durationSec * sampleRate));
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  if (bed === 'none') {
    return { left, right };
  }

  // Musical pattern definitions per reference channel style
  type BedConfig = {
    bpm: number;
    chords: number[][];
    arp: number[];
    padGain: number;
    pluckGain: number;
    percGain: number;
    warmth: number;
  };

  const configs: Record<Exclude<AmbientBedId, 'none'>, BedConfig> = {
    ted_ed_marimba: {
      bpm: 108,
      chords: [
        [130.81, 196.0, 261.63, 329.63], // Cmaj7 feel
        [110.0, 164.81, 220.0, 261.63],  // Am
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [146.83, 220.0, 293.66, 349.23], // Dm7
      ],
      arp: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 523.25, 440.0],
      padGain: 0.085,
      pluckGain: 0.12,
      percGain: 0.045,
      warmth: 0.72,
    },
    simple_history_march: {
      bpm: 96,
      chords: [
        [98.0, 146.83, 196.0, 233.08],  // Gm
        [77.78, 116.54, 155.56, 233.08], // Eb
        [87.31, 130.81, 174.61, 220.0],  // F
        [73.42, 110.0, 146.83, 220.0],   // Dm
      ],
      arp: [293.66, 349.23, 392.0, 349.23, 311.13, 293.66, 261.63, 293.66],
      padGain: 0.11,
      pluckGain: 0.075,
      percGain: 0.095,
      warmth: 0.55,
    },
    maps_cartography_pulse: {
      bpm: 112,
      chords: [
        [110.0, 164.81, 220.0, 261.63],
        [87.31, 130.81, 174.61, 261.63],
        [130.81, 196.0, 261.63, 329.63],
        [98.0, 146.83, 196.0, 246.94],
      ],
      arp: [440.0, 523.25, 659.25, 523.25, 392.0, 440.0, 523.25, 659.25],
      padGain: 0.09,
      pluckGain: 0.1,
      percGain: 0.08,
      warmth: 0.65,
    },
    minute_earth_plucky: {
      bpm: 120,
      chords: [
        [146.83, 220.0, 293.66, 369.99], // D
        [110.0, 164.81, 220.0, 277.18],  // A
        [123.47, 185.0, 246.94, 293.66], // Bm
        [98.0, 146.83, 196.0, 246.94],   // G
      ],
      arp: [587.33, 739.99, 880.0, 739.99, 659.25, 587.33, 493.88, 587.33],
      padGain: 0.065,
      pluckGain: 0.135,
      percGain: 0.055,
      warmth: 0.8,
    },
    historically_upbeat: {
      bpm: 118,
      chords: [
        [130.81, 196.0, 261.63, 311.13], // Cm
        [103.83, 155.56, 207.65, 261.63], // Ab
        [116.54, 174.61, 233.08, 293.66], // Bb
        [98.0, 146.83, 196.0, 246.94],   // G
      ],
      arp: [523.25, 622.25, 783.99, 622.25, 587.33, 523.25, 466.16, 523.25],
      padGain: 0.095,
      pluckGain: 0.115,
      percGain: 0.105,
      warmth: 0.6,
    },
    obsidian_drone: {
      bpm: 72,
      chords: [
        [55.0, 110.0, 164.81, 220.0],
        [49.0, 98.0, 146.83, 196.0],
      ],
      arp: [220.0, 261.63, 246.94, 220.0],
      padGain: 0.12,
      pluckGain: 0.025,
      percGain: 0.0,
      warmth: 0.85,
    },
    investigative_pulse: {
      bpm: 100,
      chords: [
        [65.41, 130.81, 196.0, 233.08],
        [58.27, 116.54, 174.61, 233.08],
      ],
      arp: [261.63, 311.13, 392.0, 311.13],
      padGain: 0.1,
      pluckGain: 0.06,
      percGain: 0.05,
      warmth: 0.7,
    },
    historical_strings: {
      bpm: 80,
      chords: [
        [65.41, 98.0, 146.83, 196.0],
        [73.42, 110.0, 164.81, 220.0],
        [55.0, 82.41, 130.81, 196.0],
        [65.41, 98.0, 146.83, 196.0],
      ],
      arp: [293.66, 329.63, 392.0, 329.63],
      padGain: 0.13,
      pluckGain: 0.04,
      percGain: 0.015,
      warmth: 0.8,
    },
    archive_room_tone: {
      bpm: 64,
      chords: [[48.0, 72.0, 144.0]],
      arp: [192.0],
      padGain: 0.06,
      pluckGain: 0.0,
      percGain: 0.0,
      warmth: 0.9,
    },
  };

  const cfg = configs[bed] || configs.historically_upbeat;
  const beatDur = 60 / cfg.bpm;
  const barDur = beatDur * 4;
  const eighthDur = beatDur / 2;
  const fadeInSamples = Math.min(totalSamples, Math.floor(sampleRate * 0.8));
  const fadeOutSamples = Math.min(totalSamples, Math.floor(sampleRate * 1.2));

  let lpL = 0;
  let lpR = 0;
  const alpha = 0.08 + (1 - cfg.warmth) * 0.25;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const barIndex = Math.floor(t / barDur);
    const chord = cfg.chords[barIndex % cfg.chords.length];
    const barFrac = (t % barDur) / barDur;
    const barEnv = Math.sin(Math.min(1, barFrac * 8) * (Math.PI / 2)) * (1 - 0.15 * barFrac);

    // Warm stereo harmonic pad
    let padL = 0;
    let padR = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = chord[c];
      const phaseL = 2 * Math.PI * f * t;
      const phaseR = 2 * Math.PI * (f * (c % 2 === 0 ? 1.0018 : 0.9984)) * t;
      const w = 1 / chord.length;
      padL += Math.sin(phaseL) * w;
      padR += Math.sin(phaseR) * w;
    }

    // Marimba / Pizzicato melodic pluck on 8th-note grid
    let pluckL = 0;
    let pluckR = 0;
    if (cfg.pluckGain > 0) {
      const stepIdx = Math.floor(t / eighthDur);
      const stepTime = t - stepIdx * eighthDur;
      if (stepIdx % 8 !== 3 && stepIdx % 8 !== 7) {
        const note = cfg.arp[stepIdx % cfg.arp.length];
        const env = Math.exp(-stepTime * 11.5) * Math.min(1, stepTime / 0.008);
        const tone = Math.sin(2 * Math.PI * note * stepTime) + 0.25 * Math.sin(4 * Math.PI * note * stepTime);
        const pan = stepIdx % 2 === 0 ? 0.62 : 0.38;
        pluckL = tone * env * pan;
        pluckR = tone * env * (1 - pan);
      }
    }

    // Soft rhythmic pulse (kick/snare brush) for historical & dynamic explainers
    let perc = 0;
    if (cfg.percGain > 0) {
      const beatIdx = Math.floor(t / beatDur);
      const bt = t - beatIdx * beatDur;
      if (beatIdx % 4 === 0 || beatIdx % 4 === 2) {
        // Soft low tom / kick
        const kEnv = Math.exp(-bt * 24);
        const kFreq = 54 + 62 * Math.exp(-bt * 38);
        perc += Math.sin(2 * Math.PI * kFreq * bt) * kEnv * 0.7;
      } else {
        // Soft brush snare / shaker
        const sEnv = Math.exp(-bt * 34);
        perc += seededNoise(i) * sEnv * 0.28;
      }
    }

    const rawL = padL * cfg.padGain * barEnv + pluckL * cfg.pluckGain + perc * cfg.percGain;
    const rawR = padR * cfg.padGain * barEnv + pluckR * cfg.pluckGain + perc * cfg.percGain;

    // Gentle 1-pole lowpass warmth so music sits smoothly under spoken voice
    lpL += alpha * (rawL - lpL);
    lpR += alpha * (rawR - lpR);

    let masterEnv = 1;
    if (i < fadeInSamples) masterEnv *= i / fadeInSamples;
    if (i > totalSamples - fadeOutSamples) masterEnv *= Math.max(0, (totalSamples - i) / fadeOutSamples);

    left[i] = lpL * masterEnv;
    right[i] = lpR * masterEnv;
  }

  return { left, right };
}

/**
 * Adds a synthesized transition / callout SFX cue directly into stereo buffers at startSample.
 */
export function mixSfxCueIntoBuffers(
  left: Float32Array,
  right: Float32Array,
  cue: SfxCueType,
  startSample: number,
  gain = 0.5,
  sampleRate = TARGET_SAMPLE_RATE
): void {
  if (cue === 'none' || gain <= 0.005) return;
  const maxLen = left.length;

  const durationSec =
    cue === 'whoosh'
      ? 0.26
      : cue === 'paper_slide'
      ? 0.24
      : cue === 'chalk_draw'
      ? 0.22
      : cue === 'stamp_hit' || cue === 'soft_impact'
      ? 0.25
      : 0.16;

  const count = Math.floor(durationSec * sampleRate);
  let lp = 0;

  for (let i = 0; i < count; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= maxLen) continue;
    const t = i / sampleRate;
    const frac = i / count;
    let s = 0;

    if (cue === 'whoosh') {
      const env = Math.sin(frac * Math.PI) * Math.exp(-frac * 1.4);
      const noise = seededNoise(idx + 31);
      const cutoff = 0.04 + 0.22 * Math.sin(frac * Math.PI);
      lp += cutoff * (noise - lp);
      s = (lp * 0.7 + Math.sin(2 * Math.PI * (140 + 260 * Math.sin(frac * Math.PI)) * t) * 0.15) * env;
    } else if (cue === 'pop_in') {
      const env = Math.exp(-t * 28) * Math.min(1, t / 0.006);
      const freq = 320 + 520 * Math.min(1, t / 0.045);
      s = Math.sin(2 * Math.PI * freq * t) * env * 0.55;
    } else if (cue === 'stamp_hit' || cue === 'soft_impact') {
      const env = Math.exp(-t * 16);
      const freq = 130 * Math.exp(-t * 9) + 42;
      s = (Math.sin(2 * Math.PI * freq * t) * 0.72 + seededNoise(idx) * Math.exp(-t * 50) * 0.22) * env;
    } else if (cue === 'map_ping' || cue === 'map_pin') {
      const env = Math.exp(-t * 20);
      const freq = cue === 'map_ping' ? 880 - 220 * frac : 660 - 200 * frac;
      s = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t)) * env * 0.35;
    } else if (cue === 'chalk_draw') {
      const env = Math.sin(frac * Math.PI) * (0.75 + 0.25 * Math.sin(t * 90));
      const n = seededNoise(idx + 17);
      lp += 0.32 * (n - lp);
      s = (n - lp) * env * 0.28;
    } else {
      // paper_slide / document_land
      const env = Math.sin(frac * Math.PI);
      const n = seededNoise(idx + 7);
      const alpha = cue === 'paper_slide' ? 0.25 : 0.12;
      lp += alpha * (n - lp);
      s = lp * env * 0.48;
    }

    left[idx] += s * gain;
    right[idx] += s * gain;
  }
}

/**
 * Mixes a mono/stereo WAV voiceover buffer with style-matched procedural background music
 * (with automatic speech-envelope ducking) and beat-synced transition SFX into a 48 kHz stereo WAV.
 */
export function mixNarrationWithMusicAndSfx(params: {
  voiceWavBuffer?: Buffer | null;
  durationSec: number;
  mixer: AudioMixerSettings;
  sfxEvents: BeatSfxEvent[];
}): {
  wavBuffer: Buffer;
  durationSec: number;
  sampleRate: number;
  peakAmplitude: number;
  rmsDb: number;
} {
  const sampleRate = TARGET_SAMPLE_RATE;

  // Decode optional voice WAV and resample linearly to 48 kHz mono float
  let voiceFloat: Float32Array | null = null;
  let actualDurSec = Math.max(1, params.durationSec);

  if (params.voiceWavBuffer && params.voiceWavBuffer.length > 44) {
    const parsed = extractWavPcmData(params.voiceWavBuffer);
    if (parsed.pcm.length >= 2 && parsed.bitsPerSample === 16) {
      const srcChannels = Math.max(1, parsed.channels || 1);
      const srcFrames = Math.floor(parsed.pcm.length / (2 * srcChannels));
      const srcDur = srcFrames / Math.max(8000, parsed.sampleRate);
      actualDurSec = Math.max(actualDurSec, srcDur);
      const outFrames = Math.ceil(actualDurSec * sampleRate);
      voiceFloat = new Float32Array(outFrames);

      const ratio = parsed.sampleRate / sampleRate;
      for (let i = 0; i < outFrames; i++) {
        const srcPos = i * ratio;
        const idx0 = Math.floor(srcPos);
        if (idx0 >= srcFrames) break;
        const idx1 = Math.min(srcFrames - 1, idx0 + 1);
        const frac = srcPos - idx0;

        let s0 = 0;
        let s1 = 0;
        for (let c = 0; c < srcChannels; c++) {
          s0 += parsed.pcm.readInt16LE((idx0 * srcChannels + c) * 2) / 32768;
          s1 += parsed.pcm.readInt16LE((idx1 * srcChannels + c) * 2) / 32768;
        }
        voiceFloat[i] = ((s0 + (s1 - s0) * frac) / srcChannels);
      }
    }
  }

  const totalFrames = Math.max(sampleRate, Math.ceil(actualDurSec * sampleRate));
  const music = synthesizeMusicBedStereo(params.mixer.ambientBed, actualDurSec, sampleRate);
  const outL = new Float32Array(totalFrames);
  const outR = new Float32Array(totalFrames);

  const voiceGain = Math.max(0, Math.min(1.2, params.mixer.voiceVolume ?? 1.0));
  const musicGain = Math.max(0, Math.min(0.85, params.mixer.musicVolume ?? 0.24));
  const duckRatio = params.mixer.autoDucking
    ? Math.pow(10, -(Math.abs(params.mixer.duckingDepthDb || 11) / 20))
    : 1.0;

  // Envelope follower on narration so music ducks smoothly during speech and swells in pauses
  let speechEnv = 0;
  let duckGain = 1.0;

  for (let i = 0; i < totalFrames; i++) {
    const v = voiceFloat && i < voiceFloat.length ? voiceFloat[i] : 0;
    const absV = Math.abs(v);
    speechEnv = absV > speechEnv ? speechEnv * 0.96 + absV * 0.04 : speechEnv * 0.9994 + absV * 0.0006;

    const targetDuck = speechEnv > 0.018 ? duckRatio : 1.0;
    duckGain = targetDuck < duckGain ? duckGain * 0.992 + targetDuck * 0.008 : duckGain * 0.9992 + targetDuck * 0.0008;

    const mL = i < music.left.length ? music.left[i] : 0;
    const mR = i < music.right.length ? music.right[i] : 0;

    outL[i] = v * voiceGain + mL * musicGain * duckGain;
    outR[i] = v * voiceGain + mR * musicGain * duckGain;
  }

  // Layer transition & pop-in SFX at exact beat timestamps
  const sfxGain = Math.max(0, Math.min(1, params.mixer.sfxVolume ?? 0.48)) * 0.65;
  for (const ev of params.sfxEvents) {
    const sampleOffset = Math.round((ev.timeMs / 1000) * sampleRate);
    mixSfxCueIntoBuffers(outL, outR, ev.cue, sampleOffset, sfxGain, sampleRate);
  }

  // Measure peak & RMS for automated QA verification
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < totalFrames; i++) {
    const l = clampSample(outL[i]);
    const r = clampSample(outR[i]);
    outL[i] = l;
    outR[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSq += (l * l + r * r) * 0.5;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, totalFrames));
  const rmsDb = rms > 1e-6 ? Number((20 * Math.log10(rms)).toFixed(2)) : -96;

  return {
    wavBuffer: encodeStereoWav48k(outL, outR, sampleRate),
    durationSec: Number((totalFrames / sampleRate).toFixed(2)),
    sampleRate,
    peakAmplitude: Number(peak.toFixed(4)),
    rmsDb,
  };
}
