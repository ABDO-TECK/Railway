/**
 * تصدير/استيراد **جميع** المستخدمين — حساس.
 * يُسمح إذا كان المعرّف = BOT_OWNER_ID أو ضمن BULK_EXPORT_USER_IDS.
 */
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
  canBulkBackup,
  isBulkBackupConfigured
};
