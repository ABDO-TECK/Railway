const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const soundLib = require('../lib/soundLibrary');
const audioFrom = require('../lib/audioFromAttachment');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-sound')
    .setDescription('رفع صوت دخول (يُضاف للمكتبة ويُفعَّل — استخدم /sound للمزيد)')
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('MP3 أو MP4 (صوت فقط من الفيديو)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const file = interaction.options.getAttachment('file');

    if (!audioFrom.isAllowedExtension(file.name)) {
      return interaction.reply({
        content: 'مسموح بملفات **MP3** أو **MP4** فقط (من MP4 يُستخرج الصوت فقط).',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const response = await fetch(file.url);
    if (!response.ok) {
      return interaction.editReply({ content: 'تعذّر تحميل الملف.' });
    }
    const rawBuf = Buffer.from(await response.arrayBuffer());
    const prepared = audioFrom.prepareJoinSoundBuffer(rawBuf, file.name);
    if (!prepared.ok) {
      const msg =
        prepared.error === 'unsupported'
          ? 'صيغة غير مدعومة.'
          : 'تعذّر استخراج الصوت من الفيديو. تأكد أن الملف يحتوي على مسار صوتي.';
      return interaction.editReply({ content: msg });
    }
    const { name } = soundLib.addSound(interaction.user.id, prepared.buffer, '', {
      activate: true
    });

    const who =
      interaction.member?.displayName ??
      interaction.user.globalName ??
      interaction.user.username;
    const fromMp4 = file.name.toLowerCase().endsWith('.mp4');
    const note = fromMp4 ? ' (صوت مستخرج من الفيديو)' : '';
    await interaction.editReply({
      content:
        `تمت الإضافة لـ **${who}** باسم **${name}** (مفعّل كصوت دخول)${note}.\n` +
        `الحد الأقصى للطول: **${audioFrom.MAX_AUDIO_SECONDS}** ثانية (يُقصّ تلقائياً إن لزم).\n` +
        'لإدارة الأصوات: `/sound list` — `/sound select` — `/sound remove`.'
    });
  }
};