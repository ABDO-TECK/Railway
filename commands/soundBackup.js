const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder
} = require('discord.js');
const soundLib = require('../lib/soundLibrary');
const { canUseSoundBackup, isAllowlistMode } = require('../lib/soundBackupAccess');

let builder = new SlashCommandBuilder()
  .setName('sound-backup')
  .setDescription(
    'تصدير أو استيراد مكتبة أصوات الدخول الخاصة بك (للنسخ قبل تغيير الاستضافة)'
  )
  .setDMPermission(true)
  .addSubcommand(sub =>
    sub.setName('export').setDescription('تحميل ملف نسخة احتياطية لأصواتك')
  )
  .addSubcommand(sub =>
    sub
      .setName('import')
      .setDescription('استعادة مكتبتك من ملف نسخة احتياطية')
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
  );

if (!isAllowlistMode()) {
  builder = builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

module.exports = {
  data: builder,
  async execute(interaction) {
    if (!canUseSoundBackup(interaction)) {
      return interaction.reply({
        content:
          'لا يمكنك استخدام **/sound-backup** هنا.\n\n' +
          '• إذا كان المالك عيّن **SOUND_BACKUP_USER_IDS**: يجب أن يكون **معرّفك** في تلك القائمة.\n' +
          '• وإلا: تحتاج صلاحية **مسؤول (Administrator)** في السيرفر.\n' +
          '• أو نفّذ الأمر من **رسالة خاصة** مع البوت (تصدير/استيراد مكتبتك فقط).',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

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
      if (
        !lower.endsWith('.json') &&
        !lower.endsWith('.gz')
      ) {
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
  }
};
