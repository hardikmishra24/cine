import fs from 'fs/promises';
import path from 'path';
import type { IFileStorageService } from './interfaces.ts';

const STORAGE_ROOT = path.resolve(process.cwd(), 'cineforge_storage');

function sanitizeSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 120);
}

export class LocalFileStorageService implements IFileStorageService {
  async saveFile(params: {
    ownerId: string;
    projectId: string;
    folder: 'audio' | 'uploads' | 'renders';
    fileName: string;
    buffer: Buffer;
  }): Promise<{ relativePath: string; publicUrl: string; sizeBytes: number }> {
    const safeOwner = sanitizeSegment(params.ownerId);
    const safeProject = sanitizeSegment(params.projectId);
    const safeFile = sanitizeSegment(params.fileName);
    const relativePath = path.posix.join(safeOwner, safeProject, params.folder, safeFile);
    const fullPath = this.resolveSafePath(relativePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, params.buffer);

    return {
      relativePath,
      publicUrl: `/api/media/file/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeProject)}/${params.folder}/${encodeURIComponent(safeFile)}`,
      sizeBytes: params.buffer.length,
    };
  }

  resolveSafePath(relativePath: string): string {
    const normalized = path.resolve(STORAGE_ROOT, relativePath);
    if (!normalized.startsWith(STORAGE_ROOT + path.sep)) {
      throw new Error('Forbidden path traversal attempt.');
    }
    return normalized;
  }

  async readFile(relativePath: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(relativePath);
    return fs.readFile(fullPath);
  }
}

export function getWavDurationMs(buffer: Buffer): { durationMs: number; sampleRate: number; channels: number; bitsPerSample: number } {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    // Fallback estimate for 24kHz mono 16-bit PCM
    const bytesPerSec = 24000 * 2;
    return {
      durationMs: Math.max(500, Math.round((buffer.length / bytesPerSec) * 1000)),
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
    };
  }
  const channels = buffer.readUInt16LE(22) || 1;
  const sampleRate = buffer.readUInt32LE(24) || 24000;
  const bitsPerSample = buffer.readUInt16LE(34) || 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);

  // Locate 'data' subchunk
  let offset = 12;
  let dataSize = buffer.length - 44;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, buffer.length - (offset + 8));
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  const durationMs = byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 1000;
  return { durationMs: Math.max(250, durationMs), sampleRate, channels, bitsPerSample };
}

export function extractWavPcmData(buffer: Buffer): { pcm: Buffer; sampleRate: number; channels: number; bitsPerSample: number } {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    return { pcm: buffer, sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  }
  const channels = buffer.readUInt16LE(22) || 1;
  const sampleRate = buffer.readUInt32LE(24) || 24000;
  const bitsPerSample = buffer.readUInt16LE(34) || 16;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const start = offset + 8;
      const end = Math.min(buffer.length, start + chunkSize);
      return { pcm: buffer.subarray(start, end), sampleRate, channels, bitsPerSample };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return { pcm: buffer.subarray(44), sampleRate, channels, bitsPerSample };
}

export function buildWavFromPcm(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function concatenateWavBuffers(buffers: Buffer[], gapMs = 280): {
  wavBuffer: Buffer;
  totalDurationMs: number;
  sampleRate: number;
  segmentOffsets: Array<{ startMs: number; endMs: number; durationMs: number }>;
} {
  if (buffers.length === 0) {
    const empty = buildWavFromPcm(Buffer.alloc(0), 24000, 1, 16);
    return { wavBuffer: empty, totalDurationMs: 0, sampleRate: 24000, segmentOffsets: [] };
  }

  const first = extractWavPcmData(buffers[0]);
  const { sampleRate, channels, bitsPerSample } = first;
  const bytesPerSample = channels * (bitsPerSample / 8);
  const gapBytes = Math.round((gapMs / 1000) * sampleRate) * bytesPerSample;
  const silenceGap = Buffer.alloc(gapBytes);

  const chunks: Buffer[] = [];
  const segmentOffsets: Array<{ startMs: number; endMs: number; durationMs: number }> = [];
  let cursorMs = 0;

  buffers.forEach((buf, idx) => {
    const extracted = extractWavPcmData(buf);
    const durMs = Math.round((extracted.pcm.length / (sampleRate * bytesPerSample)) * 1000);
    segmentOffsets.push({
      startMs: cursorMs,
      endMs: cursorMs + durMs,
      durationMs: durMs,
    });
    chunks.push(extracted.pcm);
    cursorMs += durMs;
    if (idx < buffers.length - 1) {
      chunks.push(silenceGap);
      cursorMs += gapMs;
    }
  });

  const mergedPcm = Buffer.concat(chunks);
  return {
    wavBuffer: buildWavFromPcm(mergedPcm, sampleRate, channels, bitsPerSample),
    totalDurationMs: cursorMs,
    sampleRate,
    segmentOffsets,
  };
}

export function computeWaveformPeaks(wavBuffer: Buffer, numBuckets = 160): number[] {
  const { pcm, bitsPerSample } = extractWavPcmData(wavBuffer);
  if (pcm.length < 4 || bitsPerSample !== 16) {
    return Array.from({ length: numBuckets }, (_, i) => Number((0.2 + 0.3 * Math.abs(Math.sin(i * 0.4))).toFixed(3)));
  }
  const sampleCount = Math.floor(pcm.length / 2);
  const samplesPerBucket = Math.max(1, Math.floor(sampleCount / numBuckets));
  const peaks: number[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(sampleCount, start + samplesPerBucket);
    let maxAmp = 0;
    const step = Math.max(1, Math.floor((end - start) / 120));
    for (let i = start; i < end; i += step) {
      const val = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
      if (val > maxAmp) maxAmp = val;
    }
    peaks.push(Number(Math.min(1, maxAmp).toFixed(3)));
  }
  return peaks;
}
