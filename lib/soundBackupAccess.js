const { PermissionFlagsBits } = require('discord.js');

function parseAllowlist() {
  const v = process.env.SOUND_BACKUP_USER_IDS;
  if (!v || !String(v).trim()) return null;
  const ids = String(v)
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return new Set(ids);
}

function isAllowlistMode() {
  const s = parseAllowlist();
  return s !== null && s.size > 0;
}

/** من يستطيع تنفيذ `/sound-backup`. */
function canUseSoundBackup(interaction) {
  const set = parseAllowlist();
  if (set && set.size > 0) {
    return set.has(interaction.user.id);
  }
  if (!interaction.guild) {
    return true;
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

module.exports = {
  parseAllowlist,
  isAllowlistMode,
  canUseSoundBackup
};
