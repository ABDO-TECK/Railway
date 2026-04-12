const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const BACKUP_FORMAT_VERSION = 1;
const BULK_BACKUP_FORMAT_VERSION = 1;
const BULK_BACKUP_FORMAT = 'join-sound-library-bulk';
const MAX_BACKUP_TRACKS = 50;
const MAX_ONE_MP3_BYTES = 6 * 1024 * 1024;
const MAX_IMPORT_UNCOMPRESSED = 32 * 1024 * 1024;
/** حد تقريبي لحجم النسخة الجماعية بعد فك الضغط (كل المستخدمين). */
const MAX_BULK_IMPORT_UNCOMPRESSED = 256 * 1024 * 1024;
const MAX_BULK_USERS = 10_000;
/** حد آمن لمرفق ديسكورد (غالباً 8 ميغا للبوتات العادية). */
const MAX_DISCORD_ATTACHMENT_BYTES = Number(process.env.BULK_BACKUP_MAX_BYTES) || 8 * 1024 * 1024;

/**
 * محلياً: مجلد sounds بجانب المشروع.
 * على Railway: عيّن SOUNDS_DIR لمسار Volume دائم (مثل /data/sounds) وإلا تُفقد الملفات عند كل redeploy.
 */
const soundsDir = process.env.SOUNDS_DIR
  ? path.resolve(process.env.SOUNDS_DIR)
  : path.join(__dirname, '..', 'sounds');

function userDir(userId) {
  return path.join(soundsDir, String(userId));
}

function libraryPath(userId) {
  return path.join(userDir(userId), 'library.json');
}

function prefsPath(userId) {
  return path.join(userDir(userId), 'prefs.json');
}

function loadPrefs(userId) {
  const p = prefsPath(userId);
  if (!fs.existsSync(p)) {
    return { joinSoundEnabled: true };
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof j !== 'object' || j === null) {
      return { joinSoundEnabled: true };
    }
    return { joinSoundEnabled: j.joinSoundEnabled !== false };
  } catch {
    return { joinSoundEnabled: true };
  }
}

function isJoinSoundEnabled(userId) {
  return loadPrefs(userId).joinSoundEnabled;
}

function setJoinSoundEnabled(userId, enabled) {
  fs.mkdirSync(userDir(userId), { recursive: true });
  let base = {};
  if (fs.existsSync(prefsPath(userId))) {
    try {
      const parsed = JSON.parse(fs.readFileSync(prefsPath(userId), 'utf8'));
      if (parsed && typeof parsed === 'object') base = { ...parsed };
    } catch {
      /* ignore */
    }
  }
  base.joinSoundEnabled = !!enabled;
  fs.writeFileSync(prefsPath(userId), JSON.stringify(base, null, 2));
}

function migrateLegacy(userId) {
  const legacy = path.join(soundsDir, `${userId}.mp3`);
  const dir = userDir(userId);
  if (!fs.existsSync(legacy) || fs.existsSync(libraryPath(userId))) return;

  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const file = `${id}.mp3`;
  fs.copyFileSync(legacy, path.join(dir, file));
  const lib = {
    activeId: id,
    items: [{ id, name: 'Default', file }]
  };
  fs.writeFileSync(libraryPath(userId), JSON.stringify(lib, null, 2));
  fs.unlinkSync(legacy);
}

function loadLibrary(userId) {
  migrateLegacy(userId);
  const p = libraryPath(userId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveLibrary(userId, lib) {
  fs.mkdirSync(userDir(userId), { recursive: true });
  fs.writeFileSync(libraryPath(userId), JSON.stringify(lib, null, 2));
}

function getActiveFilePath(userId) {
  const lib = loadLibrary(userId);
  if (!lib?.items?.length || !lib.activeId) return null;
  const item = lib.items.find(i => i.id === lib.activeId);
  if (!item) return null;
  const fp = path.join(userDir(userId), item.file);
  return fs.existsSync(fp) ? fp : null;
}

function addSound(userId, buffer, name, { activate = false } = {}) {
  migrateLegacy(userId);
  const id = crypto.randomUUID();
  const file = `${id}.mp3`;
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buffer);

  let lib = loadLibrary(userId);
  if (!lib) lib = { activeId: null, items: [] };
  lib.items = lib.items || [];

  const raw = (name || '').trim().slice(0, 32);
  const displayName =
    raw ||
    `صوت ${lib.items.length + 1}`;

  const taken = new Set(lib.items.map(i => i.name.toLowerCase()));
  let finalName = displayName;
  let n = 2;
  while (taken.has(finalName.toLowerCase())) {
    finalName = `${displayName} (${n})`;
    n += 1;
  }

  lib.items.push({ id, name: finalName, file });
  if (activate) lib.activeId = id;
  saveLibrary(userId, lib);
  return { id, name: finalName };
}

function renameSound(userId, soundIdOrName, newName) {
  const lib = loadLibrary(userId);
  if (!lib?.items?.length) return { ok: false, reason: 'empty' };
  const item = findItem(lib, soundIdOrName);
  if (!item) return { ok: false, reason: 'notfound' };

  const trimmed = String(newName || '').trim().slice(0, 32);
  if (!trimmed) return { ok: false, reason: 'emptyname' };

  const lower = trimmed.toLowerCase();
  const duplicate = lib.items.some(
    i => i.id !== item.id && i.name.toLowerCase() === lower
  );
  if (duplicate) return { ok: false, reason: 'duplicate' };

  const oldName = item.name;
  item.name = trimmed;
  saveLibrary(userId, lib);
  return { ok: true, oldName, newName: trimmed };
}

function findItem(lib, soundIdOrName) {
  if (!lib?.items?.length) return null;
  const q = String(soundIdOrName).trim();
  const byId = lib.items.find(i => i.id === q);
  if (byId) return byId;
  const lower = q.toLowerCase();
  return lib.items.find(i => i.name.toLowerCase() === lower) || null;
}

function removeSound(userId, soundIdOrName) {
  const lib = loadLibrary(userId);
  if (!lib?.items?.length) return { ok: false, reason: 'empty' };
  const item = findItem(lib, soundIdOrName);
  if (!item) return { ok: false, reason: 'notfound' };

  const fp = path.join(userDir(userId), item.file);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {
    /* ignore */
  }

  lib.items = lib.items.filter(i => i.id !== item.id);
  if (lib.activeId === item.id) {
    lib.activeId = lib.items[0]?.id ?? null;
  }
  if (!lib.items.length) {
    try {
      fs.unlinkSync(libraryPath(userId));
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(userDir(userId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { ok: true, removed: item.name, empty: true };
  }
  saveLibrary(userId, lib);
  return { ok: true, removed: item.name, empty: false };
}

function setActiveSound(userId, soundIdOrName) {
  const lib = loadLibrary(userId);
  if (!lib?.items?.length) return { ok: false, reason: 'empty' };
  const item = findItem(lib, soundIdOrName);
  if (!item) return { ok: false, reason: 'notfound' };
  lib.activeId = item.id;
  saveLibrary(userId, lib);
  return { ok: true, name: item.name };
}

function listItems(userId) {
  const lib = loadLibrary(userId);
  if (!lib?.items?.length) return [];
  return lib.items.map(i => ({
    id: i.id,
    name: i.name,
    active: i.id === lib.activeId
  }));
}

function listUserIdsWithSounds() {
  fs.mkdirSync(soundsDir, { recursive: true });
  const ids = new Set();
  for (const name of fs.readdirSync(soundsDir)) {
    const p = path.join(soundsDir, name);
    if (name === '.gitkeep') continue;
    if (fs.statSync(p).isDirectory()) {
      const lp = path.join(p, 'library.json');
      if (fs.existsSync(lp)) {
        try {
          const lib = JSON.parse(fs.readFileSync(lp, 'utf8'));
          if (lib.items?.length) ids.add(name);
        } catch {
          /* ignore */
        }
      }
    } else if (/^\d+\.mp3$/i.test(name)) {
      ids.add(name.replace(/\.mp3$/i, ''));
    }
  }
  return [...ids];
}

function wipeUserSounds(userId) {
  const dir = userDir(userId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createBackupBuffer(userId) {
  migrateLegacy(userId);
  const lib = loadLibrary(userId);
  if (!lib?.items?.length) {
    return {
      ok: false,
      detail: 'مكتبتك فارغة — لا شيء للتصدير.'
    };
  }
  const items = [];
  for (const item of lib.items) {
    const fp = path.join(userDir(userId), item.file);
    if (!fs.existsSync(fp)) continue;
    const buf = fs.readFileSync(fp);
    if (buf.length > MAX_ONE_MP3_BYTES) {
      return {
        ok: false,
        detail: `الملف **${item.name}** أكبر من حد النسخ الاحتياطي عبر ديسكورد. احذفه أو استبدله.`
      };
    }
    items.push({
      id: item.id,
      name: item.name,
      audioBase64: buf.toString('base64')
    });
  }
  if (!items.length) {
    return {
      ok: false,
      detail: 'لم يُعثر على ملفات MP3 على القرص.'
    };
  }
  const payload = {
    format: 'join-sound-library',
    v: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    ownerDiscordUserId: String(userId),
    activeId: lib.activeId,
    items
  };
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  let outBuf = jsonBuf;
  let compressed = false;
  if (jsonBuf.length > 6 * 1024 * 1024) {
    outBuf = zlib.gzipSync(jsonBuf);
    compressed = true;
  }
  const ext = compressed ? 'json.gz' : 'json';
  return {
    ok: true,
    buffer: outBuf,
    filename: `join-sounds-backup-${String(userId).slice(-4)}-${Date.now()}.${ext}`,
    tracks: items.length,
    compressed
  };
}

function parseBackupFile(buf) {
  let raw = buf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    raw = zlib.gunzipSync(buf);
  }
  if (raw.length > MAX_IMPORT_UNCOMPRESSED) {
    return { ok: false, detail: 'الملف بعد فك الضغط كبير جداً.' };
  }
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, detail: 'الملف ليس JSON صالحاً.' };
  }
  if (data.format !== 'join-sound-library' || data.v !== BACKUP_FORMAT_VERSION) {
    return { ok: false, detail: 'ليس ملف نسخة احتياطية صادراً من هذا البوت (الصيغة غير متطابقة).' };
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { ok: false, detail: 'لا توجد أصوات داخل الملف.' };
  }
  if (data.items.length > MAX_BACKUP_TRACKS) {
    return { ok: false, detail: `الحد الأقصى ${MAX_BACKUP_TRACKS} صوتاً في نسخة واحدة.` };
  }
  const items = [];
  let total = 0;
  for (const it of data.items) {
    const name =
      String(it.name || '')
        .trim()
        .slice(0, 32) || 'صوت';
    const b64 = it.audioBase64;
    if (typeof b64 !== 'string') {
      return { ok: false, detail: 'بيانات صوت ناقصة في النسخة.' };
    }
    let audio;
    try {
      audio = Buffer.from(b64, 'base64');
    } catch {
      return { ok: false, detail: 'تعذّر فك ترميز أحد الملفات.' };
    }
    if (!audio.length) {
      return { ok: false, detail: 'أحد المقاطع فارغ.' };
    }
    if (audio.length > MAX_ONE_MP3_BYTES) {
      return { ok: false, detail: 'أحد المقاطع يتجاوز الحد الآمن للحجم.' };
    }
    total += audio.length;
    if (total > MAX_IMPORT_UNCOMPRESSED) {
      return { ok: false, detail: 'الحجم الإجمالي للأصوات كبير جداً.' };
    }
    items.push({
      oldId: String(it.id || ''),
      name,
      buffer: audio
    });
  }
  return {
    ok: true,
    data: {
      activeId: data.activeId ? String(data.activeId) : null,
      items
    }
  };
}

function importBackupReplace(userId, data) {
  wipeUserSounds(userId);
  const idMap = new Map();
  const libItems = [];
  fs.mkdirSync(userDir(userId), { recursive: true });
  for (const it of data.items) {
    const id = crypto.randomUUID();
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(userDir(userId), file), it.buffer);
    if (it.oldId) idMap.set(it.oldId, id);
    libItems.push({ id, name: it.name, file });
  }
  let activeId =
    (data.activeId && idMap.get(data.activeId)) || libItems[0]?.id || null;
  if (activeId && !libItems.some(i => i.id === activeId)) {
    activeId = libItems[0]?.id ?? null;
  }
  saveLibrary(userId, { activeId, items: libItems });
  const activeItem = libItems.find(i => i.id === activeId);
  return {
    ok: true,
    count: libItems.length,
    activeName: activeItem?.name ?? null
  };
}

function importBackupMerge(userId, data) {
  for (const it of data.items) {
    addSound(userId, it.buffer, it.name, { activate: false });
  }
  return { ok: true, count: data.items.length };
}

function importBackup(userId, fileBuf, mode) {
  const parsed = parseBackupFile(fileBuf);
  if (!parsed.ok) return parsed;
  if (mode === 'replace') {
    return importBackupReplace(userId, parsed.data);
  }
  return importBackupMerge(userId, parsed.data);
}

/**
 * تحويل مصفوفة items من JSON إلى buffers مع التحقق من الحجم الإجمالي.
 */
function normalizeItemsFromPayload(itemsInput, activeIdStr, cumulativeBytes, maxTotal) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    return { ok: false, detail: 'قائمة أصوات فارغة.' };
  }
  if (itemsInput.length > MAX_BACKUP_TRACKS) {
    return { ok: false, detail: `الحد الأقصى ${MAX_BACKUP_TRACKS} صوتاً لكل مستخدم.` };
  }
  const items = [];
  let total = cumulativeBytes;
  for (const it of itemsInput) {
    const name =
      String(it.name || '')
        .trim()
        .slice(0, 32) || 'صوت';
    const b64 = it.audioBase64;
    if (typeof b64 !== 'string') {
      return { ok: false, detail: 'بيانات صوت ناقصة.' };
    }
    let audio;
    try {
      audio = Buffer.from(b64, 'base64');
    } catch {
      return { ok: false, detail: 'تعذّر فك ترميز أحد الملفات.' };
    }
    if (!audio.length) {
      return { ok: false, detail: 'أحد المقاطع فارغ.' };
    }
    if (audio.length > MAX_ONE_MP3_BYTES) {
      return { ok: false, detail: 'أحد المقاطع يتجاوز الحد الآمن للحجم.' };
    }
    total += audio.length;
    if (total > maxTotal) {
      return { ok: false, detail: 'الحجم الإجمالي للنسخة الجماعية كبير جداً.' };
    }
    items.push({
      oldId: String(it.id || ''),
      name,
      buffer: audio
    });
  }
  return {
    ok: true,
    data: {
      activeId: activeIdStr ? String(activeIdStr) : null,
      items
    },
    totalBytes: total
  };
}

function createBulkBackupBuffer() {
  const userIds = listUserIdsWithSounds();
  const users = [];
  for (const userId of userIds) {
    migrateLegacy(userId);
    const lib = loadLibrary(userId);
    if (!lib?.items?.length) continue;
    const items = [];
    for (const item of lib.items) {
      const fp = path.join(userDir(userId), item.file);
      if (!fs.existsSync(fp)) continue;
      const buf = fs.readFileSync(fp);
      if (buf.length > MAX_ONE_MP3_BYTES) {
        return {
          ok: false,
          detail: `ملف كبير جداً للمستخدم ${userId}: **${item.name}** — احذفه أو قصّه ثم أعد المحاولة.`
        };
      }
      items.push({
        id: item.id,
        name: item.name,
        audioBase64: buf.toString('base64')
      });
    }
    if (items.length) {
      users.push({
        discordUserId: String(userId),
        activeId: lib.activeId,
        items
      });
    }
  }
  if (!users.length) {
    return { ok: false, detail: 'لا توجد مكتبات مسجّلة لأي مستخدم.' };
  }
  if (users.length > MAX_BULK_USERS) {
    return { ok: false, detail: `عدد المستخدمين يتجاوز الحد (${MAX_BULK_USERS}).` };
  }
  const payload = {
    format: BULK_BACKUP_FORMAT,
    v: BULK_BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    users
  };
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  let outBuf = jsonBuf;
  let compressed = false;
  if (jsonBuf.length > 512 * 1024) {
    outBuf = zlib.gzipSync(jsonBuf);
    compressed = true;
  }
  if (outBuf.length > MAX_DISCORD_ATTACHMENT_BYTES) {
    return {
      ok: false,
      detail:
        `حجم الملف بعد الضغط (~${(outBuf.length / 1024 / 1024).toFixed(1)} ميغابايت) يتجاوز حد ديسكورد (~${(MAX_DISCORD_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)} ميغابايت).\n` +
        '**الحل:** انسخ مجلد التخزين **SOUNDS_DIR** يدوياً من السيرفر أو زِد **BULK_BACKUP_MAX_BYTES** إن كان لديك رفع أكبر.'
    };
  }
  const ext = compressed ? 'json.gz' : 'json';
  return {
    ok: true,
    buffer: outBuf,
    filename: `join-sounds-bulk-all-${Date.now()}.${ext}`,
    userCount: users.length,
    totalTracks: users.reduce((n, u) => n + u.items.length, 0),
    compressed,
    rawJsonBytes: jsonBuf.length
  };
}

function parseBulkBackupFile(buf) {
  let raw = buf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    raw = zlib.gunzipSync(buf);
  }
  if (raw.length > MAX_BULK_IMPORT_UNCOMPRESSED) {
    return { ok: false, detail: 'الملف بعد فك الضغط أكبر من الحد المسموح.' };
  }
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, detail: 'الملف ليس JSON صالحاً.' };
  }
  if (data.format !== BULK_BACKUP_FORMAT || data.v !== BULK_BACKUP_FORMAT_VERSION) {
    return { ok: false, detail: 'ليس ملف نسخة جماعية صادراً من هذا البوت.' };
  }
  if (!Array.isArray(data.users) || data.users.length === 0) {
    return { ok: false, detail: 'لا يوجد مستخدمون في النسخة.' };
  }
  if (data.users.length > MAX_BULK_USERS) {
    return { ok: false, detail: 'عدد المستخدمين في الملف كبير جداً.' };
  }
  const normalized = [];
  let cumulative = 0;
  for (const u of data.users) {
    const uid = String(u.discordUserId ?? '').trim();
    if (!/^\d{17,20}$/.test(uid)) {
      return { ok: false, detail: `معرّف مستخدم غير صالح: ${u.discordUserId}` };
    }
    const r = normalizeItemsFromPayload(
      u.items,
      u.activeId,
      cumulative,
      MAX_BULK_IMPORT_UNCOMPRESSED
    );
    if (!r.ok) {
      return { ok: false, detail: `${r.detail} (المستخدم ${uid})` };
    }
    cumulative = r.totalBytes;
    normalized.push({ discordUserId: uid, data: r.data });
  }
  return { ok: true, users: normalized };
}

function importBulkBackup(fileBuf, mode) {
  const parsed = parseBulkBackupFile(fileBuf);
  if (!parsed.ok) return parsed;
  let restoredUsers = 0;
  let restoredTracks = 0;
  const errors = [];
  for (const entry of parsed.users) {
    try {
      const result =
        mode === 'replace'
          ? importBackupReplace(entry.discordUserId, entry.data)
          : importBackupMerge(entry.discordUserId, entry.data);
      restoredUsers += 1;
      restoredTracks += result.count;
    } catch (e) {
      errors.push(`${entry.discordUserId}: ${e.message || 'خطأ'}`);
    }
  }
  return {
    ok: true,
    restoredUsers,
    restoredTracks,
    errors: errors.slice(0, 5),
    errorCount: errors.length
  };
}

module.exports = {
  soundsDir,
  migrateLegacy,
  loadLibrary,
  isJoinSoundEnabled,
  setJoinSoundEnabled,
  getActiveFilePath,
  addSound,
  renameSound,
  removeSound,
  setActiveSound,
  listItems,
  listUserIdsWithSounds,
  findItem,
  createBackupBuffer,
  importBackup,
  createBulkBackupBuffer,
  importBulkBackup
};
