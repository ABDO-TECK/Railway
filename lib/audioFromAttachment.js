const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/** أقصى طول للمقطع المحفوظ والمُشغَّل (ثوانٍ). */
const MAX_AUDIO_SECONDS = 15;

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = null;
}

function isAllowedExtension(filename) {
  const l = (filename || '').toLowerCase();
  return l.endsWith('.mp3') || l.endsWith('.mp4');
}

function probeDurationSeconds(filePath) {
  if (!ffmpegPath) return null;
  const r = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-i', filePath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }
  );
  const stderr = `${r.stderr || ''}${r.stdout || ''}`;
  const m = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(stderr);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const frac = parseInt(m[4], 10);
  return hh * 3600 + mm * 60 + ss + frac / 100;
}

function extractSegmentToMp3(inputPath, outPath, startSec, durationSec, isMp4) {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath
  ];
  if (isMp4) args.push('-vn');
  args.push(
    '-ss',
    String(startSec),
    '-t',
    String(durationSec),
    '-c:a',
    'libmp3lame',
    '-q:a',
    '4',
    outPath
  );
  const r = spawnSync(ffmpegPath, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true
  });
  return r.status === 0 && fs.existsSync(outPath);
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {{ startSec?: number|null, durationSec?: number|null }} opts
 *   - ملف أطول من 15 ثانية: يجب تحديد **duration_second** (واختياريًا start_second).
 *   - بدون قص تلقائي للملفات الطويلة.
 */
function prepareJoinSoundBuffer(buffer, originalName, opts = {}) {
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg', detail: 'ffmpeg-static not available' };
  }

  const lower = (originalName || '').toLowerCase();
  if (!lower.endsWith('.mp3') && !lower.endsWith('.mp4')) {
    return { ok: false, error: 'unsupported' };
  }

  const isMp4 = lower.endsWith('.mp4');
  const ext = isMp4 ? '.mp4' : '.mp3';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-audio-'));
  const inPath = path.join(tmpDir, `in${ext}`);
  const outPath = path.join(tmpDir, 'out.mp3');

  try {
    fs.writeFileSync(inPath, buffer);

    const totalDur = probeDurationSeconds(inPath);
    if (totalDur == null || totalDur <= 0) {
      return { ok: false, error: 'ffmpeg', detail: 'تعذّر قراءة مدة الملف.' };
    }

    const startSec = Math.max(0, Number(opts.startSec) || 0);
    if (startSec >= totalDur) {
      return {
        ok: false,
        error: 'range',
        detail: 'بداية المقطع (start) أكبر من أو تساوي طول الملف.'
      };
    }

    const hasDurationOpt =
      opts.durationSec !== undefined &&
      opts.durationSec !== null &&
      !Number.isNaN(Number(opts.durationSec));

    if (totalDur > MAX_AUDIO_SECONDS && !hasDurationOpt) {
      return {
        ok: false,
        error: 'needs_segment',
        totalDuration: totalDur,
        maxSeconds: MAX_AUDIO_SECONDS
      };
    }

    let durationSec;
    if (hasDurationOpt) {
      durationSec = Math.min(
        Number(opts.durationSec),
        MAX_AUDIO_SECONDS,
        totalDur - startSec
      );
    } else {
      durationSec = Math.min(totalDur - startSec, MAX_AUDIO_SECONDS);
    }

    if (durationSec <= 0) {
      return {
        ok: false,
        error: 'range',
        detail: 'مدة المقطع غير صالحة أو تخرج عن الملف.'
      };
    }

    const ok = extractSegmentToMp3(inPath, outPath, startSec, durationSec, isMp4);
    if (!ok) {
      return {
        ok: false,
        error: 'ffmpeg',
        detail: isMp4
          ? 'فشل استخراج الصوت من الفيديو أو القص.'
          : 'فشل قص/تحويل MP3.'
      };
    }

    const outBuf = fs.readFileSync(outPath);
    if (!outBuf.length) {
      return { ok: false, error: 'ffmpeg', detail: 'مخرجات فارغة.' };
    }

    return {
      ok: true,
      buffer: outBuf,
      usedStart: startSec,
      usedDuration: durationSec,
      sourceDuration: totalDur
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  MAX_AUDIO_SECONDS,
  isAllowedExtension,
  prepareJoinSoundBuffer
};
