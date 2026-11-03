/**
 * Gemini Live emits 16-bit little-endian PCM, mono, at a low sample rate
 * (24 kHz for the Live models). Discord's voice gateway expects 48 kHz stereo
 * s16le. This transform does the conversion in pure JS so the bot never needs
 * ffmpeg on the host.
 *
 * The resampler is streaming-safe: chunk boundaries can fall anywhere, and the
 * fractional output position is carried across writes so the playback stream
 * never drifts or clicks at chunk edges.
 */

import { Transform } from 'node:stream';

const DISCORD_SAMPLE_RATE = 48_000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_FRAME = 4; // two channels, s16le
const DEFAULT_INPUT_RATE = 24_000;

export class PcmToDiscord extends Transform {
  private readonly ratio: number;
  private pending = 0;
  private carry: Buffer = Buffer.alloc(0);
  private previousSample = 0;
  private hasPrevious = false;

  constructor(inputRate?: number) {
    super();
    const rate =
      typeof inputRate === 'number' && Number.isFinite(inputRate) && inputRate > 0
        ? inputRate
        : DEFAULT_INPUT_RATE;
    this.ratio = DISCORD_SAMPLE_RATE / rate;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
      const usable = buffer.length - (buffer.length % BYTES_PER_SAMPLE);
      this.carry = usable === buffer.length ? Buffer.alloc(0) : buffer.subarray(usable);

      const sampleCount = usable / BYTES_PER_SAMPLE;
      if (sampleCount === 0) {
        callback();
        return;
      }

      // A rate below Discord's needs several frames per sample; 24 kHz needs 2.
      const maxFrames = Math.ceil(sampleCount * this.ratio) + 1;
      const output = Buffer.allocUnsafe(maxFrames * BYTES_PER_FRAME);
      let offset = 0;
      let pending = this.pending;

      for (let i = 0; i < sampleCount; i += 1) {
        const current = buffer.readInt16LE(i * BYTES_PER_SAMPLE);
        // Half-way value keeps the doubled stream smooth instead of stepped.
        const interpolated = this.hasPrevious
          ? (this.previousSample + current) >> 1
          : current;

        pending += this.ratio;
        let emitted = 0;
        while (pending >= 1) {
          pending -= 1;
          const value = emitted === 0 && this.hasPrevious ? interpolated : current;
          output.writeInt16LE(value, offset);
          output.writeInt16LE(value, offset + 2);
          offset += BYTES_PER_FRAME;
          emitted += 1;
        }

        this.previousSample = current;
        this.hasPrevious = true;
      }

      this.pending = pending;
      if (offset > 0) this.push(output.subarray(0, offset));
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: () => void): void {
    this.carry = Buffer.alloc(0);
    callback();
  }
}

/**
 * Discord receive streams deliver 48 kHz stereo s16le. Gemini expects 16 kHz
 * mono, so every three stereo frames collapse into one averaged mono sample.
 */
export class DiscordPcmTo16k extends Transform {
  private carry: Buffer = Buffer.alloc(0);

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
      const groupBytes = 12; // three stereo frames
      const usable = buffer.length - (buffer.length % groupBytes);
      this.carry = usable === buffer.length ? Buffer.alloc(0) : buffer.subarray(usable);

      const groups = usable / groupBytes;
      if (groups === 0) {
        callback();
        return;
      }

      const output = Buffer.allocUnsafe(groups * BYTES_PER_SAMPLE);
      for (let group = 0; group < groups; group += 1) {
        const base = group * groupBytes;
        let sum = 0;
        for (let sample = 0; sample < 6; sample += 1) {
          sum += buffer.readInt16LE(base + sample * BYTES_PER_SAMPLE);
        }
        output.writeInt16LE(Math.round(sum / 6), group * BYTES_PER_SAMPLE);
      }

      this.push(output);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: () => void): void {
    this.carry = Buffer.alloc(0);
    callback();
  }
}

