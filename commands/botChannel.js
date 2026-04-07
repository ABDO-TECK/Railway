const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  EmbedBuilder
} = require('discord.js');
const guildChannel = require('../lib/guildCommandChannel');

const TEXT_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-channel')
    .setDescription('تحديد قناة نصية واحدة لاستخدام أوامر البوت (أو إلغاء التقييد)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('السماح بأوامر البوت في هذه القناة فقط (وخيوطها)')
        .addChannelOption(o =>
          o
            .setName('channel')
            .setDescription('قناة الشات أو الإعلانات أو المنتدى')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('إلغاء التقييد — الأوامر تُستخدم من أي قناة نصية')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('عرض القناة المحددة حالياً لهذا السيرفر')
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('قائمة قنوات النص/الإعلانات/المنتدى (للمساعدة عند الاختيار)')
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: 'هذا الأمر داخل السيرفر فقط.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      await guild.channels.fetch().catch(() => {});
      const lines = guild.channels.cache
        .filter(c => TEXT_TYPES.includes(c.type))
        .sort((a, b) => {
          const ap = a.parent?.rawPosition ?? -1;
          const bp = b.parent?.rawPosition ?? -1;
          if (ap !== bp) return ap - bp;
          return a.rawPosition - b.rawPosition;
        })
        .map(c => `${c.toString()} — \`${c.id}\``)
        .slice(0, 45);

      const extra =
        guild.channels.cache.filter(c => TEXT_TYPES.includes(c.type)).size > 45
          ? `\n… و**${guild.channels.cache.filter(c => TEXT_TYPES.includes(c.type)).size - 45}** قناة أخرى`
          : '';

      const desc = lines.length
        ? lines.join('\n') + extra
        : 'لا توجد قنوات نصية ظاهرة للبوت في هذا السيرفر.';
      const embed = new EmbedBuilder()
        .setTitle('قنوات الشات (نص / إعلان / منتدى)')
        .setDescription(desc.slice(0, 3900))
        .setColor(0x5865f2)
        .setFooter({
          text: 'للتعيين استخدم: /bot-channel set channel:'
        });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'status') {
      const locked = guildChannel.getLockedChannelId(guild.id);
      if (!locked) {
        return interaction.reply({
          content:
            '**التقييد معطّل** — أوامر البوت (`/sound`، `/set-sound`، `/sound-backup`، …) تعمل من **أي قناة**.',
          flags: MessageFlags.Ephemeral
        });
      }
      const ch = await guild.channels.fetch(locked).catch(() => null);
      const mention = ch ? ch.toString() : `<#${locked}>`;
      return interaction.reply({
        content:
          `الأوامر مقيدة حالياً بـ ${mention} (وبخيوط هذه القناة)، **بما فيها** \`/bot-channel\` (مثل \`clear\` و\`status\`).`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'clear') {
      guildChannel.setLockedChannelId(guild.id, null);
      return interaction.reply({
        content:
          'تم **إلغاء التقييد**. يمكن استخدام أوامر البوت من أي قناة نصية يراها البوت.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!TEXT_TYPES.includes(channel.type)) {
        return interaction.reply({
          content: 'اختر قناة **نص** أو **إعلانات** أو **منتدى** فقط.',
          flags: MessageFlags.Ephemeral
        });
      }
      guildChannel.setLockedChannelId(guild.id, channel.id);
      return interaction.reply({
        content:
          `تم التعيين: أوامر البوت (` +
            '`/sound`، `/set-sound`، `/sound-backup`، `/bot-channel`' +
            `) تعمل فقط في ${channel.toString()} **وفي خيوط هذه القناة**.\n` +
            'لتغيير الإعداد أو **إلغاء التقييد** (`clear`) استخدم نفس القناة (أو خيطها).',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
