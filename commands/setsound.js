const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const soundsDir = path.join(__dirname, '..', 'sounds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setsound')
    .setDescription('Upload your join sound')
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

    fs.mkdirSync(soundsDir, { recursive: true });

    const response = await fetch(file.url);
    if (!response.ok) {
      return interaction.editReply({ content: 'تعذّر تحميل الملف.' });
    }
    const buffer = await response.arrayBuffer();

    const userId = interaction.user.id;
    const outPath = path.join(soundsDir, `${userId}.mp3`);
    fs.writeFileSync(outPath, Buffer.from(buffer));

    const who =
      interaction.member?.displayName ??
      interaction.user.globalName ??
      interaction.user.username;
    await interaction.editReply({
      content:
        `تم حفظ صوت الدخول لـ **${who}**.\n` +
        `عند دخولك أي روم صوتي سيُشغَّل الملف \`${userId}.mp3\`.`
    });
  }
};