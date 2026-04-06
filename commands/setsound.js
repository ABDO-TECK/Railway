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
    )
    .addNumberOption(o =>
      o
        .setName('start_second')
        .setDescription('بداية المقطع بالثواني (افتراضي 0)')
        .setMinValue(0)
    )
    .addNumberOption(o =>
      o
        .setName('duration_second')
        .setDescription('طول المقطع حتى 15 ث — مطلوب إن كان الملف أطول من 15 ث')
        .setMinValue(0.1)
        .setMaxValue(15)
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
    const startOpt = interaction.options.getNumber('start_second');
    const durationOpt = interaction.options.getNumber('duration_second');
    const prepared = audioFrom.prepareJoinSoundBuffer(rawBuf, file.name, {
      startSec: startOpt ?? undefined,
      durationSec: durationOpt ?? undefined
    });
    if (!prepared.ok) {
      if (prepared.error === 'needs_segment') {
        return interaction.editReply({
          content:
            `مدة الملف **~${prepared.totalDuration.toFixed(1)}** ثانية (أكثر من **${prepared.maxSeconds}** ث).\n` +
            'حدّد المقطع: **`duration_second`** (حتى 15 ث) واختياريًا **`start_second`**.'
        });
      }
      if (prepared.error === 'range') {
        return interaction.editReply({ content: prepared.detail || 'نطاق المقطع غير صالح.' });
      }
      const msg =
        prepared.error === 'unsupported'
          ? 'صيغة غير مدعومة.'
          : prepared.detail || 'تعذّر معالجة الملف.';
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
    const seg =
      prepared.usedStart > 0 || prepared.usedDuration < prepared.sourceDuration
        ? `\nالمقطع: من **${prepared.usedStart.toFixed(1)}** ث، طول **${prepared.usedDuration.toFixed(1)}** ث (من أصل ~${prepared.sourceDuration.toFixed(1)} ث).`
        : '';
    await interaction.editReply({
      content:
        `تمت الإضافة لـ **${who}** باسم **${name}** (مفعّل كصوت دخول)${note}.${seg}\n` +
        `الحد الأقصى لطول المقطع: **${audioFrom.MAX_AUDIO_SECONDS}** ثانية.\n` +
        'لإدارة الأصوات: `/sound list` — `/sound select` — `/sound remove`.'
    });
  }
};