const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const soundLib = require('../lib/soundLibrary');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join-sound')
    .setDescription('تشغيل أو إيقاف صوت الدخول عند انضمامك لروم صوتي (مكتبتك لا تتغير)')
    .setDMPermission(true)
    .addSubcommand(sub =>
      sub
        .setName('on')
        .setDescription('تشغيل صوت الدخول عند الدخول للكول (الوضع الافتراضي)')
    )
    .addSubcommand(sub =>
      sub
        .setName('off')
        .setDescription('إيقاف صوت الدخول مؤقتاً عند دخولك للكول')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    if (sub === 'on') {
      soundLib.setJoinSoundEnabled(uid, true);
      return interaction.reply({
        content:
          'تم **تشغيل** صوت الدخول. عند دخولك لروم صوتي سيُشغَّل صوتك المفعّل في `/sound list` إن وُجد.',
        flags: MessageFlags.Ephemeral
      });
    }

    soundLib.setJoinSoundEnabled(uid, false);
    return interaction.reply({
      content:
        'تم **إيقاف** صوت الدخول لحسابك. لن يدخل البوت أو يشغّل صوتاً عند دخولك للكول حتى تستخدم `/join-sound on`.\n' +
        '(مكتبتك والصوت المفعّل كما هما — فقط التشغيل عند الدخول متوقف.)',
      flags: MessageFlags.Ephemeral
    });
  }
};
