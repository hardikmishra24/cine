import type { AmbientBedId, AudioMixerSettings, SfxCueType } from '../types/cineforge';

const BED_SCALES: Record<Exclude<AmbientBedId, 'none'>, { bpm: number; notes: number[]; wave: OscillatorType; cutoff: number }> = {
  ted_ed_marimba: { bpm: 108, notes: [261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 329.63, 293.66], wave: 'sine', cutoff: 1400 },
  simple_history_march: { bpm: 96, notes: [146.83, 174.61, 220.0, 196.0, 146.83, 220.0, 174.61, 164.81], wave: 'triangle', cutoff: 760 },
  maps_cartography_pulse: { bpm: 112, notes: [130.81, 196.0, 155.56, 196.0, 174.61, 196.0, 146.83, 196.0], wave: 'triangle', cutoff: 820 },
  minute_earth_plucky: { bpm: 118, notes: [329.63, 392.0, 493.88, 587.33, 493.88, 392.0, 440.0, 392.0], wave: 'sine', cutoff: 1600 },
  historically_upbeat: { bpm: 122, notes: [220.0, 261.63, 329.63, 293.66, 392.0, 329.63, 261.63, 246.94], wave: 'triangle', cutoff: 1200 },
  obsidian_drone: { bpm: 60, notes: [55.0, 82.41, 110.0, 82.41], wave: 'sine', cutoff: 320 },
  investigative_pulse: { bpm: 92, notes: [55.0, 55.0, 82.41, 65.41], wave: 'triangle', cutoff: 420 },
  historical_strings: { bpm: 68, notes: [130.81, 164.81, 196.0, 146.83], wave: 'sine', cutoff: 620 },
  archive_room_tone: { bpm: 50, notes: [48.0, 72.0], wave: 'sine', cutoff: 260 },
};

function scheduleSfxOnContext(
  ctx: BaseAudioContext,
  destination: AudioNode,
  cue: SfxCueType,
  startTime: number,
  volume: number
) {
  if (cue === 'none' || volume <= 0.01) return;
  const master = ctx.createGain();
  master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * 0.65, startTime);
  master.connect(destination);

  if (cue === 'paper_slide' || cue === 'document_land' || cue === 'whoosh' || cue === 'chalk_draw') {
    const duration = cue === 'whoosh' ? 0.28 : cue === 'chalk_draw' ? 0.22 : cue === 'paper_slide' ? 0.24 : 0.14;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1337;
    for (let i = 0; i < sampleCount; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = (seed / 1073741823.5) - 1;
      const env = Math.sin((i / sampleCount) * Math.PI);
      data[i] = white * env * (cue === 'whoosh' ? 0.42 : 0.34);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    if (cue === 'whoosh') {
      filter.frequency.setValueAtTime(340, startTime);
      filter.frequency.exponentialRampToValueAtTime(1900, startTime + duration * 0.5);
      filter.frequency.exponentialRampToValueAtTime(420, startTime + duration);
      filter.Q.value = 1.6;
    } else if (cue === 'chalk_draw') {
      filter.frequency.setValueAtTime(2400, startTime);
      filter.Q.value = 2.6;
    } else {
      filter.frequency.setValueAtTime(cue === 'paper_slide' ? 1800 : 650, startTime);
      filter.Q.value = 1.4;
    }

    src.connect(filter);
    filter.connect(master);
    src.start(startTime);
  } else if (cue === 'soft_impact' || cue === 'stamp_hit') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cue === 'stamp_hit' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(cue === 'stamp_hit' ? 165 : 115, startTime);
    osc.frequency.exponentialRampToValueAtTime(38, startTime + 0.24);
    gain.gain.setValueAtTime(0.4, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);
    osc.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + 0.3);
  } else if (cue === 'pop_in') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, startTime);
    osc.frequency.exponentialRampToValueAtTime(760, startTime + 0.085);
    gain.gain.setValueAtTime(0.26, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
    osc.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + 0.13);
  } else if (cue === 'map_pin' || cue === 'map_ping') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cue === 'map_ping' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(cue === 'map_ping' ? 880 : 660, startTime);
    osc.frequency.exponentialRampToValueAtTime(cue === 'map_ping' ? 1320 : 440, startTime + 0.14);
    gain.gain.setValueAtTime(0.22, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);
    osc.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + 0.24);
  }
}

/**
 * Procedural Web Audio documentary & explainer sound design engine.
 * Synthesizes style-matched musical beds (TED-Ed marimba, Simple History march,
 * History on Maps pulse, MinuteEarth plucky, Historically upbeat, archival beds)
 * and transition SFX with automatic narration ducking.
 */
export class DocumentarySoundEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private stepTimer: number | null = null;
  private activeBed: AmbientBedId = 'none';
  private isPlaying = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  startAmbientBed(mixer: AudioMixerSettings, isVoiceSpeaking = true) {
    this.stopAmbientBed();
    if (mixer.ambientBed === 'none' || mixer.musicVolume <= 0.01) return;

    const ctx = this.ensureContext();
    this.activeBed = mixer.ambientBed;
    this.isPlaying = true;
    const spec = BED_SCALES[mixer.ambientBed] || BED_SCALES.historically_upbeat;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.cutoff;
    filter.connect(this.musicGain!);

    // Warm root pad
    const rootFreq = spec.notes[0] / 2;
    const padOsc = ctx.createOscillator();
    const padGain = ctx.createGain();
    padOsc.type = 'sine';
    padOsc.frequency.value = Math.max(48, rootFreq);
    padGain.gain.value = 0.09;
    padOsc.connect(padGain);
    padGain.connect(filter);
    padOsc.start();
    this.oscillators = [padOsc];

    // Rhythmic musical pulse for the 5 YouTube explainer presets
    const isMelodic =
      mixer.ambientBed === 'ted_ed_marimba' ||
      mixer.ambientBed === 'simple_history_march' ||
      mixer.ambientBed === 'maps_cartography_pulse' ||
      mixer.ambientBed === 'minute_earth_plucky' ||
      mixer.ambientBed === 'historically_upbeat';

    if (isMelodic) {
      let stepIdx = 0;
      const stepMs = Math.round((60 / spec.bpm) * 500); // eighth-note groove
      const triggerNote = () => {
        if (!this.isPlaying || !this.ctx || !this.musicGain) return;
        const now = this.ctx.currentTime;
        const freq = spec.notes[stepIdx % spec.notes.length];
        stepIdx++;

        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();
        osc.type = spec.wave;
        osc.frequency.setValueAtTime(freq, now);
        noteGain.gain.setValueAtTime(0.001, now);
        noteGain.gain.linearRampToValueAtTime(0.11, now + 0.015);
        noteGain.gain.exponentialRampToValueAtTime(0.001, now + Math.min(0.32, (stepMs / 1000) * 0.9));
        osc.connect(noteGain);
        noteGain.connect(filter);
        osc.start(now);
        osc.stop(now + 0.35);
      };
      triggerNote();
      this.stepTimer = window.setInterval(triggerNote, stepMs);
    } else {
      // Classic sustained harmonic pad
      spec.notes.slice(1).forEach((f, i) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.value = f;
        osc.detune.value = (i - 1) * 4;
        oscGain.gain.value = 0.04;
        osc.connect(oscGain);
        oscGain.connect(filter);
        osc.start();
        this.oscillators.push(osc);
      });
    }

    this.updateMix(mixer, isVoiceSpeaking);
  }

  updateMix(mixer: AudioMixerSettings, isVoiceSpeaking: boolean) {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const duckMultiplier =
      mixer.autoDucking && isVoiceSpeaking
        ? Math.pow(10, -(Math.abs(mixer.duckingDepthDb || 10) / 20))
        : 1.0;
    const targetMusic = Math.max(0, Math.min(1, mixer.musicVolume)) * 0.45 * duckMultiplier;
    this.musicGain.gain.setTargetAtTime(targetMusic, now, 0.18);
    this.sfxGain.gain.setTargetAtTime(Math.max(0, Math.min(1, mixer.sfxVolume)) * 0.65, now, 0.08);
  }

  stopAmbientBed() {
    this.isPlaying = false;
    if (this.stepTimer !== null) {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
    });
    this.oscillators = [];
  }

  triggerSfx(cue: SfxCueType, sfxVolume = 0.5) {
    if (cue === 'none' || sfxVolume <= 0.01) return;
    const ctx = this.ensureContext();
    scheduleSfxOnContext(ctx, this.sfxGain!, cue, ctx.currentTime, sfxVolume);
  }

  getActiveBed() {
    return this.isPlaying ? this.activeBed : 'none';
  }

  dispose() {
    this.stopAmbientBed();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

/**
 * Deterministically renders voiceover + style-matched music bed + transition SFX
 * with automatic speech ducking into a 48 kHz stereo AudioBuffer for WebCodecs AAC muxing.
 */
export async function renderMixedMasterAudioBuffer(params: {
  voiceBuffer: AudioBuffer | null;
  durationSec: number;
  mixer: AudioMixerSettings;
  sfxEvents: Array<{ timeMs: number; cue: SfxCueType }>;
}): Promise<AudioBuffer | null> {
  const sampleRate = 48000;
  const totalSec = Math.max(
    1,
    params.durationSec,
    params.voiceBuffer ? params.voiceBuffer.duration : 0
  );
  const totalFrames = Math.ceil(totalSec * sampleRate);

  const offline = new OfflineAudioContext(2, totalFrames, sampleRate);

  // 1. Voiceover track
  if (params.voiceBuffer) {
    const vSrc = offline.createBufferSource();
    vSrc.buffer = params.voiceBuffer;
    const vGain = offline.createGain();
    vGain.gain.value = Math.max(0, Math.min(1.2, params.mixer.voiceVolume ?? 1.0));
    vSrc.connect(vGain);
    vGain.connect(offline.destination);
    vSrc.start(0);
  }

  // 2. Style-matched procedural music bed (auto-ducked under narration)
  if (params.mixer.ambientBed !== 'none' && (params.mixer.musicVolume ?? 0) > 0.01) {
    const spec = BED_SCALES[params.mixer.ambientBed] || BED_SCALES.historically_upbeat;
    const duckMult =
      params.mixer.autoDucking && params.voiceBuffer
        ? Math.pow(10, -(Math.abs(params.mixer.duckingDepthDb || 10) / 20))
        : 1.0;
    const bedLevel = Math.max(0, Math.min(1, params.mixer.musicVolume)) * 0.36 * duckMult;

    const bedGain = offline.createGain();
    bedGain.gain.setValueAtTime(0.0001, 0);
    bedGain.gain.linearRampToValueAtTime(bedLevel, Math.min(0.8, totalSec * 0.2));
    bedGain.gain.setValueAtTime(bedLevel, Math.max(0.8, totalSec - 0.8));
    bedGain.gain.linearRampToValueAtTime(0.0001, totalSec);

    const filter = offline.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.cutoff;
    filter.connect(bedGain);
    bedGain.connect(offline.destination);

    // Subtle warm root pad
    const pad = offline.createOscillator();
    const padGain = offline.createGain();
    pad.type = 'sine';
    pad.frequency.value = Math.max(48, spec.notes[0] / 2);
    padGain.gain.value = 0.22;
    pad.connect(padGain);
    padGain.connect(filter);
    pad.start(0);
    pad.stop(totalSec);

    // Eighth-note melodic pulse
    const stepSec = (60 / spec.bpm) * 0.5;
    let step = 0;
    for (let t = 0; t < totalSec - 0.05; t += stepSec) {
      const freq = spec.notes[step % spec.notes.length];
      step++;
      const osc = offline.createOscillator();
      const g = offline.createGain();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, Math.min(totalSec, t + stepSec * 0.88));
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(Math.min(totalSec, t + stepSec * 0.92));
    }
  }

  // 3. Beat transition SFX cues
  if ((params.mixer.sfxVolume ?? 0) > 0.01) {
    for (const ev of params.sfxEvents) {
      const tSec = Math.max(0, ev.timeMs / 1000);
      if (tSec < totalSec - 0.05) {
        scheduleSfxOnContext(offline, offline.destination, ev.cue, tSec, params.mixer.sfxVolume);
      }
    }
  }

  return offline.startRendering();
}
