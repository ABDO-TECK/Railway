const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder
} = require('discord.js');
const soundLib = require('../lib/soundLibrary');
const {
  canUseSoundBackup,
  isAllowlistMode,
  canBulkBackup
} = require('../lib/soundBackupAccess');

let builder = new SlashCommandBuilder()
  .setName('sound-backup')
  .setDescription(
    'نسخ احتياطي لمكتبة أصوات الدخول (شخصي أو جماعي لكل المستخدمين للمطوّر)'
  )
  .setDMPermission(true)
  .addSubcommand(sub =>
    sub.setName('export').setDescription('تحميل نسخة احتياطية لأصواتك أنت فقط')
  )
  .addSubcommand(sub =>
    sub
      .setName('import')
      .setDescription('استعادة مكتبتك من ملف نسخة شخصية')
      .addAttachmentOption(a =>
        a
          .setName('file')
          .setDescription('ملف من أمر التصدير (.json أو .json.gz)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName('mode')
          .setDescription('علاقة النسخة بمكتبتك الحالية')
          .setRequired(true)
          .addChoices(
            { name: 'استبدال كامل (تحذف الحالية)', value: 'replace' },
            { name: 'دمج (تبقي الحالية وتضيف من النسخة)', value: 'merge' }
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('export-all')
      .setDescription(
        'تصدير أصوات كل المستخدمين المسجّلين في البوت (للمطوّر — ملف واحد)'
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('import-all')
      .setDescription(
        'استيراد النسخة الجماعية وتوزيعها على المستخدمين حسب معرّفات ديسكورد'
      )
      .addAttachmentOption(a =>
        a
          .setName('file')
          .setDescription('ملف من export-all (.json أو .json.gz)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName('mode')
          .setDescription('لكل مستخدم: استبدال مكتبته أو دمج مع الموجود')
          .setRequired(true)
          .addChoices(
            { name: 'استبدال كامل لكل مستخدم', value: 'replace' },
            { name: 'دمج مع مكتبة كل مستخدم', value: 'merge' }
          )
      )
  );

if (!isAllowlistMode()) {
  builder = builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

module.exports = {
  data: builder,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isBulk = sub === 'export-all' || sub === 'import-all';

    if (isBulk) {
      if (!canBulkBackup(interaction)) {
        return interaction.reply({
          content:
            '**التصدير/الاستيراد الجماعي** للمطوّر فقط.\n\n' +
            'عيّن في بيئة البوت أحد الخيارين:\n' +
            '• **`BOT_OWNER_ID`** = معرّف حسابك في ديسكورد\n' +
            '• أو **`BULK_EXPORT_USER_IDS`** = معرّفات مفصولة بفواصل لمن يُسمح له\n\n' +
            'ثم أعد تشغيل البوت.',
          flags: MessageFlags.Ephemeral
        });
      }
    } else if (!canUseSoundBackup(interaction)) {
      return interaction.reply({
        content:
          'لا يمكنك استخدام **/sound-backup** هنا.\n\n' +
          '• إذا كان المالك عيّن **SOUND_BACKUP_USER_IDS**: يجب أن يكون **معرّفك** في تلك القائمة.\n' +
          '• وإلا: تحتاج صلاحية **مسؤول (Administrator)** في السيرفر.\n' +
          '• أو نفّذ الأمر من **رسالة خاصة** مع البوت (تصدير/استيراد مكتبتك فقط).',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'export') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const r = soundLib.createBackupBuffer(interaction.user.id);
      if (!r.ok) {
        return interaction.editReply({ content: r.detail || 'تعذّر التصدير.' });
      }
      const att = new AttachmentBuilder(r.buffer, { name: r.filename });
      return interaction.editReply({
        content:
          `تم تجهيز **${r.tracks}** صوتًا — **احفظ الملف بعيداً عن ديسكورد** (قرص أو سحابة).\n` +
          (r.compressed ? '_استُخدم ضغط gzip لأن الحجم كبير._\n' : '') +
          'للاستعادة: \`/sound-backup import\` واختر **استبدال** أو **دمج**.',
        files: [att]
      });
    }

    if (sub === 'import') {
      const att = interaction.options.getAttachment('file', true);
      const mode = interaction.options.getString('mode', true);
      const lower = (att.name || '').toLowerCase();
      if (!lower.endsWith('.json') && !lower.endsWith('.gz')) {
        return interaction.reply({
          content: 'ارفع ملفاً ينتهي بـ **.json** أو **.json.gz** (من أمر التصدير).',
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetch(att.url);
      if (!res.ok) {
        return interaction.editReply({ content: 'تعذّر تحميل الملف من ديسكورد.' });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const result = soundLib.importBackup(interaction.user.id, buf, mode);
      if (!result.ok) {
        return interaction.editReply({
          content: result.detail || 'فشل الاستيراد.'
        });
      }
      if (mode === 'replace') {
        return interaction.editReply({
          content:
            `تم **استبدال** المكتبة بمحتوى النسخة (**${result.count}** صوت).\n` +
            (result.activeName
              ? `الصوت المفعّل للدخول الآن: **${result.activeName}**.`
              : '')
        });
      }
      return interaction.editReply({
        content:
          `تم **دمج** النسخة: أُضيف **${result.count}** صوت (كلها غير مفعّلة). استخدم \`/sound select\` للتفعيل.`
      });
    }

    if (sub === 'export-all') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const r = soundLib.createBulkBackupBuffer();
      if (!r.ok) {
        return interaction.editReply({ content: r.detail || 'تعذّر التصدير الجماعي.' });
      }
      const att = new AttachmentBuilder(r.buffer, { name: r.filename });
      return interaction.editReply({
        content:
          `**نسخة جماعية:** **${r.userCount}** مستخدمًا، **${r.totalTracks}** مقطعًا.\n` +
          (r.compressed
            ? `_ضغط gzip — الحجم الخام ~${(r.rawJsonBytes / 1024 / 1024).toFixed(1)} ميغابايت JSON._\n`
            : '') +
          'للاستعادة على استضافة جديدة: `/sound-backup import-all` مع نفس الملف.',
        files: [att]
      });
    }

    if (sub === 'import-all') {
      const att = interaction.options.getAttachment('file', true);
      const mode = interaction.options.getString('mode', true);
      const lower = (att.name || '').toLowerCase();
      if (!lower.endsWith('.json') && !lower.endsWith('.gz')) {
        return interaction.reply({
          content: 'ارفع ملفاً من **export-all** (.json أو .json.gz).',
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetch(att.url);
      if (!res.ok) {
        return interaction.editReply({ content: 'تعذّر تحميل الملف من ديسكورد.' });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const result = soundLib.importBulkBackup(buf, mode);
      if (!result.ok) {
        return interaction.editReply({ content: result.detail || 'فشل الاستيراد الجماعي.' });
      }
      let msg =
        `تمت معالجة **${result.restoredUsers}** مستخدمًا (**${result.restoredTracks}** مقطع).\n` +
        `الوضع: **${mode === 'replace' ? 'استبدال' : 'دمج'}** لكل مستخدم.`;
      if (result.errorCount > 0) {
        msg += `\n\nتحذير: **${result.errorCount}** فشل جزئي.`;
        if (result.errors?.length) {
          msg += `\n\`\`\`${result.errors.join('\n').slice(0, 1500)}\`\`\``;
        }
      }
      return interaction.editReply({ content: msg.slice(0, 2000) });
    }
  }
};
