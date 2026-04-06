const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/** أقصى طول للصوت المحفوظ والمُشغَّل (ثوانٍ). */
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

/**
 * يعيد Buffer بصيغة MP3 جاهز للحفظ، بحد أقصى MAX_AUDIO_SECONDS.
 */
function prepareJoinSoundBuffer(buffer, originalName) {
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.mp3')) {
    return trimMp3BufferToMaxSeconds(buffer, MAX_AUDIO_SECONDS);
  }
  if (lower.endsWith('.mp4')) {
    return mp4BufferToMp3(buffer);
  }
  return { ok: false, error: 'unsupported' };
}

function trimMp3BufferToMaxSeconds(inputBuffer, maxSeconds) {
  if (!ffmpegPath) {
    return {
      ok: false,
      error: 'ffmpeg',
      detail: 'ffmpeg-static not available'
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-audio-'));
  const inPath = path.join(tmpDir, 'in.mp3');
  const outPath = path.join(tmpDir, 'out.mp3');

  try {
    fs.writeFileSync(inPath, inputBuffer);

    const r = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inPath,
        '-t',
        String(maxSeconds),
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        outPath
      ],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, windowsHide: true }
    );

    if (r.status !== 0 || !fs.existsSync(outPath)) {
      return {
        ok: false,
        error: 'ffmpeg',
        detail: (r.stderr || r.error?.message || `exit ${r.status}`).slice(0, 500)
      };
    }

    const outBuf = fs.readFileSync(outPath);
    if (!outBuf.length) {
      return { ok: false, error: 'ffmpeg', detail: 'empty output' };
    }
    return { ok: true, buffer: outBuf };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function mp4BufferToMp3(inputBuffer) {
  if (!ffmpegPath) {
    return {
      ok: false,
      error: 'ffmpeg',
      detail: 'ffmpeg-static not available'
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-audio-'));
  const inPath = path.join(tmpDir, 'in.mp4');
  const outPath = path.join(tmpDir, 'out.mp3');

  try {
    fs.writeFileSync(inPath, inputBuffer);

    const r = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inPath,
        '-vn',
        '-t',
        String(MAX_AUDIO_SECONDS),
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        outPath
      ],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, windowsHide: true }
    );

    if (r.status !== 0 || !fs.existsSync(outPath)) {
      return {
        ok: false,
        error: 'ffmpeg',
        detail: (r.stderr || r.error?.message || `exit ${r.status}`).slice(0, 500)
      };
    }

    const outBuf = fs.readFileSync(outPath);
    if (!outBuf.length) {
      return { ok: false, error: 'ffmpeg', detail: 'empty output' };
    }
    return { ok: true, buffer: outBuf };
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
