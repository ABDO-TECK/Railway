const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const soundsDir = path.join(__dirname, '..', 'sounds');

function userDir(userId) {
  return path.join(soundsDir, String(userId));
}

function libraryPath(userId) {
  return path.join(userDir(userId), 'library.json');
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
  if (!lib?.items?.length) return null;
  let item = lib.items.find(i => i.id === lib.activeId);
  if (!item) item = lib.items[0];
  if (!item) return null;
  const fp = path.join(userDir(userId), item.file);
  return fs.existsSync(fp) ? fp : null;
}

function addSound(userId, buffer, name) {
  migrateLegacy(userId);
  const id = crypto.randomUUID();
  const file = `${id}.mp3`;
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buffer);

  let lib = loadLibrary(userId);
  if (!lib) lib = { activeId: id, items: [] };
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
  lib.activeId = id;
  saveLibrary(userId, lib);
  return { id, name: finalName };
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

module.exports = {
  soundsDir,
  migrateLegacy,
  loadLibrary,
  getActiveFilePath,
  addSound,
  removeSound,
  setActiveSound,
  listItems,
  listUserIdsWithSounds,
  findItem
};
