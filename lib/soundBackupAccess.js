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

function parseBulkExportAllowlist() {
  const v = process.env.BULK_EXPORT_USER_IDS;
  if (!v || !String(v).trim()) return null;
  return new Set(
    String(v)
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

/**
 * تصدير/استيراد **جميع** المستخدمين — حساس.
 * يُسمح إذا كان المعرّف = BOT_OWNER_ID أو ضمن BULK_EXPORT_USER_IDS.
 */
function canBulkBackup(interaction) {
  const owner = process.env.BOT_OWNER_ID;
  if (owner && String(owner).trim() === interaction.user.id) {
    return true;
  }
  const bulk = parseBulkExportAllowlist();
  if (bulk && bulk.size > 0) {
    return bulk.has(interaction.user.id);
  }
  return false;
}

function isBulkBackupConfigured() {
  const owner = process.env.BOT_OWNER_ID;
  const bulk = parseBulkExportAllowlist();
  return !!(owner && String(owner).trim()) || !!(bulk && bulk.size > 0);
}

module.exports = {
  parseAllowlist,
  isAllowlistMode,
  canUseSoundBackup,
  canBulkBackup,
  isBulkBackupConfigured
};
