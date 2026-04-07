const fs = require('fs');
const path = require('path');

const storePath = process.env.GUILD_COMMAND_CHANNEL_PATH
  ? path.resolve(process.env.GUILD_COMMAND_CHANNEL_PATH)
  : path.join(__dirname, '..', 'data', 'guildCommandChannel.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(obj) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(obj, null, 2), 'utf8');
}

function getLockedChannelId(guildId) {
  if (!guildId) return null;
  const row = readStore()[String(guildId)];
  const id = row?.channelId;
  return typeof id === 'string' && id.length ? id : null;
}

function setLockedChannelId(guildId, channelId) {
  const gid = String(guildId);
  const all = readStore();
  if (channelId == null || channelId === '') {
    delete all[gid];
  } else {
    all[gid] = { channelId: String(channelId) };
  }
  writeStore(all);
}

const SETUP_COMMAND_NAME = 'bot-channel';

function isSetupCommand(name) {
  return name === SETUP_COMMAND_NAME;
}

/**
 * هل هذا السياق مسموح لتنفيذ أوامر البوت (غير أمر الإعداد)؟
 */
async function passesCommandChannelGate(client, guildId, channelId) {
  if (!guildId || !channelId) return true;
  const locked = getLockedChannelId(guildId);
  if (!locked) return true;
  if (channelId === locked) return true;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (ch?.isThread?.() && ch.parentId === locked) return true;
  return false;
}

module.exports = {
  getLockedChannelId,
  setLockedChannelId,
  passesCommandChannelGate,
  isSetupCommand,
  SETUP_COMMAND_NAME
};
