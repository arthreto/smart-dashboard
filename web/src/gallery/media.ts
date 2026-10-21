// Flux « SDV1 » de la tablette → fichier MP4 lisible partout (H.264 + AAC).
// Format (voir firmware/app/recorder.h) :
//   "SDV1" | u32 LE longueur | JSON {w, h, fps, rate, ch, asc}
//   puis paquets : u8 type (1 vidéo, 2 son) | u8 drapeaux (1 = clé) | i64 LE µs | u32 LE longueur | données
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface StreamHead {
  w: number;
  h: number;
  fps: number;
  rate: number;
  ch: number;
  asc: string;
}

export interface Packet {
  video: boolean;
  key: boolean;
  pts: number; // µs
  data: Uint8Array;
}

/** Lit l'en-tête et tous les paquets complets (un flux tronqué donne les paquets entiers). */
export function parseStream(buf: Uint8Array): { head: StreamHead; packets: Packet[] } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 8 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'SDV1') throw new Error('Vidéo illisible (format inconnu).');
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hl))) as StreamHead;
  const packets: Packet[] = [];
  let o = 8 + hl;
  while (o + 14 <= buf.length) {
    const type = buf[o];
    const flags = buf[o + 1];
    const pts = Number(dv.getBigInt64(o + 2, true));
    const len = dv.getUint32(o + 10, true);
    if (o + 14 + len > buf.length) break;
    packets.push({ video: type === 1, key: (flags & 1) === 1, pts, data: buf.subarray(o + 14, o + 14 + len) });
    o += 14 + len;
  }
  return { head, packets };
}

/** Unités NAL d'une image H.264 Annex B (codes de début 00 00 01 / 00 00 00 01). */
function nalUnits(data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  let i = 0;
  while (i + 2 < data.length) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) {
        let end = i;
        if (end > start && data[end - 1] === 0) end--; // code de début sur 4 octets
        out.push(data.subarray(start, end));
      }
      start = i + 3;
      i += 3;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < data.length) out.push(data.subarray(start));
  return out.filter((n) => n.length > 0);
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function avcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff], 0);
  out.set(sps, 8);
  let o = 8 + sps.length;
  out.set([1, pps.length >> 8, pps.length & 0xff], o);
  out.set(pps, o + 3);
  return out;
}

function hexBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * Construit le MP4. `maxVideoFrames` limite la vidéo (vignettes) ; sans son dans ce cas.
 * Les paquets avant la première image clé sont ignorés (illisibles seuls).
 */
export function toMp4(head: StreamHead, packets: Packet[], maxVideoFrames = Infinity): { mp4: Uint8Array; durationMs: number } {
  // Paramètres H.264 (SPS/PPS) de la première image clé.
  let sps: Uint8Array | null = null;
  let pps: Uint8Array | null = null;
  const frames: { data: Uint8Array; key: boolean; pts: number }[] = [];
  for (const p of packets) {
    if (!p.video) continue;
    const nals = nalUnits(p.data);
    const keep: Uint8Array[] = [];
    let idr = false;
    for (const n of nals) {
      const type = n[0] & 0x1f;
      if (type === 7) {
        if (!sps) sps = n;
      } else if (type === 8) {
        if (!pps) pps = n;
      } else if (type !== 9) {
        if (type === 5) idr = true;
        keep.push(n);
      }
    }
    if (!keep.length) continue;
    if (!frames.length && !idr) continue;
    const size = keep.reduce((s, n) => s + 4 + n.length, 0);
    const avcc = new Uint8Array(size);
    let o = 0;
    for (const n of keep) {
      new DataView(avcc.buffer).setUint32(o, n.length);
      avcc.set(n, o + 4);
      o += 4 + n.length;
    }
    frames.push({ data: avcc, key: idr, pts: p.pts });
    if (frames.length >= maxVideoFrames) break;
  }
  if (!sps || !pps || !frames.length) throw new Error('Aucune image lisible dans cette vidéo.');

  const withAudio = head.rate > 0 && maxVideoFrames === Infinity && packets.some((p) => !p.video);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: head.w, height: head.h },
    audio: withAudio ? { codec: 'aac', numberOfChannels: head.ch || 1, sampleRate: head.rate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });

  const codec = `avc1.${hex2(sps[1])}${hex2(sps[2])}${hex2(sps[3])}`;
  const frameUs = Math.round(1_000_000 / (head.fps || 30));
  const t0 = frames[0].pts;
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const duration = next ? Math.max(1, next.pts - f.pts) : frameUs;
    muxer.addVideoChunkRaw(
      f.data,
      f.key ? 'key' : 'delta',
      f.pts - t0,
      duration,
      i === 0 ? { decoderConfig: { codec, codedWidth: head.w, codedHeight: head.h, description: avcC(sps!, pps!) } } : undefined,
    );
  });

  let end = frames[frames.length - 1].pts - t0 + frameUs;
  if (withAudio) {
    const frameDur = Math.round((1024 * 1_000_000) / head.rate);
    const asc = hexBytes(head.asc || '1188');
    let first = true;
    for (const p of packets) {
      if (p.video || p.pts < t0) continue;
      muxer.addAudioChunkRaw(
        p.data,
        'key',
        p.pts - t0,
        frameDur,
        first ? { decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: head.ch || 1, sampleRate: head.rate, description: asc } } : undefined,
      );
      first = false;
      end = Math.max(end, p.pts - t0 + frameDur);
    }
  }
  muxer.finalize();
  return { mp4: new Uint8Array(target.buffer), durationMs: Math.round(end / 1000) };
}

/** Image de la vidéo (vignette) à partir d'un petit MP4, en data URL JPEG. */
export function posterFrom(mp4: Uint8Array, width = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([mp4], { type: 'video/mp4' }));
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const cleanup = () => URL.revokeObjectURL(url);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('vignette : délai dépassé'));
    }, 8000);
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.2, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      clearTimeout(timer);
      const h = Math.round((width * video.videoHeight) / (video.videoWidth || 16));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = h || Math.round((width * 9) / 16);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('vignette illisible'));
    };
    video.src = url;
  });
}
