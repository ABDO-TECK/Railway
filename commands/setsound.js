const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const soundLib = require('../lib/soundLibrary');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setsound')
    .setDescription('رفع صوت دخول (يُضاف للمكتبة ويُفعَّل — استخدم /sound للمزيد)')
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('MP3 file')
        .setRequired(true)
    ),

  async execute(interaction) {
    const file = interaction.options.getAttachment('file');
    const lower = file.name.toLowerCase();

    if (!lower.endsWith('.mp3')) {
      return interaction.reply({
        content: 'مسموح بملفات MP3 فقط.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const response = await fetch(file.url);
    if (!response.ok) {
      return interaction.editReply({ content: 'تعذّر تحميل الملف.' });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const { name } = soundLib.addSound(interaction.user.id, buffer, '', {
      activate: true
    });

    const who =
      interaction.member?.displayName ??
      interaction.user.globalName ??
      interaction.user.username;
    await interaction.editReply({
      content:
        `تمت الإضافة لـ **${who}** باسم **${name}** (مفعّل كصوت دخول).\n` +
        'لإدارة الأصوات: `/sound list` — `/sound select` — `/sound remove`.'
    });
  }
};