const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder
} = require('discord.js');
const soundLib = require('../lib/soundLibrary');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sound')
    .setDescription('إدارة أصوات الدخول (مكتبتك خاصة بك)')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('إضافة صوت للمكتبة فقط (بدون تفعيل — استخدم select)')
        .addAttachmentOption(o =>
          o.setName('file').setDescription('ملف MP3').setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('اسم تعريفي للصوت (اختياري)')
            .setMaxLength(32)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('rename')
        .setDescription('تغيير اسم صوت في المكتبة')
        .addStringOption(o =>
          o
            .setName('pick')
            .setDescription('الصوت')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o =>
          o
            .setName('new_name')
            .setDescription('الاسم الجديد')
            .setRequired(true)
            .setMaxLength(32)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('حذف صوت من مكتبتك')
        .addStringOption(o =>
          o
            .setName('pick')
            .setDescription('اختر الصوت')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('عرض كل أصواتك والصوت المفعّل (لا يراه غيرك)')
    )
    .addSubcommand(sub =>
      sub
        .setName('select')
        .setDescription('تغيير صوت الدخول من المكتبة')
        .addStringOption(o =>
          o
            .setName('pick')
            .setDescription('اختر الصوت')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('stats')
        .setDescription('كم شخص لديه صوت مسجّل وأسماؤهم في السيرفر')
    ),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'remove' && sub !== 'select' && sub !== 'rename') {
      return interaction.respond([]);
    }
    const lib = soundLib.loadLibrary(interaction.user.id);
    const items = lib?.items || [];
    const focused = interaction.options.getFocused(true);
    const q = (focused.value || '').toLowerCase();
    const filtered = items
      .filter(i => i.name.toLowerCase().includes(q) || i.id.startsWith(focused.value))
      .slice(0, 25)
      .map(i => ({
        name: `${i.name}${i.id === lib.activeId ? ' ★' : ''}`.slice(0, 100),
        value: i.id
      }));
    await interaction.respond(filtered.length ? filtered : [{ name: '— لا توجد أصوات —', value: 'none' }]);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'stats') {
      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({
          content: 'الإحصائيات تعمل داخل السيرفر فقط.',
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply();
      const allIds = soundLib.listUserIdsWithSounds();
      const inGuild = [];
      for (const uid of allIds) {
        const m = await guild.members.fetch(uid).catch(() => null);
        if (m) inGuild.push(m);
      }
      const lines = [];
      const slice = inGuild.slice(0, 50);
      for (let i = 0; i < slice.length; i++) {
        const m = slice[i];
        const u = m.user;
        const label = `${u.globalName ?? u.username}`;
        lines.push(`${i + 1}. ${label}`);
      }
      const more =
        inGuild.length > 50 ? `\n… و${inGuild.length - 50} آخرين في السيرفر` : '';
      const embed = new EmbedBuilder()
        .setTitle('أعضاء هذا السيرفر لديهم صوت محفوظ')
        .setDescription(
          `**العدد في السيرفر:** ${inGuild.length}\n` +
            `**(إجمالي مسجّل في البوت عالمياً: ${allIds.length})**\n\n` +
            (lines.length
              ? lines.join('\n') + more
              : 'لا يوجد أحد في هذا السيرفر لديه صوت محفوظ بعد.')
        )
        .setColor(0x5865f2);
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'list') {
      const items = soundLib.listItems(interaction.user.id);
      if (!items.length) {
        return interaction.reply({
          content: 'لا توجد أصوات في مكتبتك. استخدم `/sound add`.',
          flags: MessageFlags.Ephemeral
        });
      }
      const text = items
        .map((row, i) => `${i + 1}. **${row.name}**${row.active ? ' ← مفعّل' : ''}`)
        .join('\n');
      return interaction.reply({
        content: `مكتبتك (لا يراها غيرك):\n${text}`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'add') {
      const file = interaction.options.getAttachment('file');
      const name = interaction.options.getString('name');
      if (!file.name.toLowerCase().endsWith('.mp3')) {
        return interaction.reply({
          content: 'مسموح بملفات MP3 فقط.',
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetch(file.url);
      if (!res.ok) {
        return interaction.editReply({ content: 'تعذّر تحميل الملف.' });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const { name: savedName } = soundLib.addSound(interaction.user.id, buf, name, {
        activate: false
      });
      return interaction.editReply({
        content:
          `تمت إضافة **${savedName}** للمكتبة **بدون تفعيل**.\n` +
          'لتشغيله عند الدخول للروم استخدم `/sound select`.'
      });
    }

    if (sub === 'rename') {
      const pick = interaction.options.getString('pick', true);
      const newName = interaction.options.getString('new_name', true);
      if (pick === 'none') {
        return interaction.reply({
          content: 'لا توجد أصوات.',
          flags: MessageFlags.Ephemeral
        });
      }
      const result = soundLib.renameSound(interaction.user.id, pick, newName);
      if (!result.ok) {
        const map = {
          empty: 'مكتبتك فارغة.',
          notfound: 'لم يُعثر على هذا الصوت.',
          emptyname: 'الاسم الجديد فارغ.',
          duplicate: 'يوجد صوت آخر بنفس الاسم.'
        };
        return interaction.reply({
          content: map[result.reason] || 'تعذّر التسمية.',
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: `تم تغيير الاسم من **${result.oldName}** إلى **${result.newName}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const pick = interaction.options.getString('pick', true);
    if (pick === 'none') {
      return interaction.reply({
        content: 'لا توجد أصوات.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'remove') {
      const result = soundLib.removeSound(interaction.user.id, pick);
      if (!result.ok) {
        const msg =
          result.reason === 'empty'
            ? 'مكتبتك فارغة.'
            : 'لم يُعثر على هذا الصوت.';
        return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      if (result.empty) {
        return interaction.reply({
          content: `تم حذف **${result.removed}**. لا توجد أصوات متبقية.`,
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: `تم حذف **${result.removed}** من المكتبة.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'select') {
      const result = soundLib.setActiveSound(interaction.user.id, pick);
      if (!result.ok) {
        const msg =
          result.reason === 'empty'
            ? 'لا توجد أصوات. استخدم `/sound add`.'
            : 'لم يُعثر على هذا الصوت.';
        return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: `صوت الدخول الآن: **${result.name}**.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
