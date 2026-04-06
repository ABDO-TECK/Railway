const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder
} = require('discord.js');
const soundLib = require('../lib/soundLibrary');
const audioFrom = require('../lib/audioFromAttachment');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sound')
    .setDescription('إدارة أصوات الدخول (مكتبتك خاصة بك)')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('إضافة صوت للمكتبة فقط (بدون تفعيل — استخدم select)')
        .addAttachmentOption(o =>
          o
            .setName('file')
            .setDescription('MP3 أو MP4 (يُستخرج الصوت فقط من الفيديو)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('اسم تعريفي للصوت (اختياري)')
            .setMaxLength(32)
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
      if (!audioFrom.isAllowedExtension(file.name)) {
        return interaction.reply({
          content: 'مسموح بملفات **MP3** أو **MP4** فقط (من MP4 يُستخرج الصوت فقط).',
          flags: MessageFlags.Ephemeral
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetch(file.url);
      if (!res.ok) {
        return interaction.editReply({ content: 'تعذّر تحميل الملف.' });
      }
      const rawBuf = Buffer.from(await res.arrayBuffer());
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
              'حدّد المقطع يدوياً: **`duration_second`** (حتى 15 ث) واختياريًا **`start_second`** (من أي ثانية تبدأ).'
          });
        }
        if (prepared.error === 'range') {
          return interaction.editReply({ content: prepared.detail || 'نطاق المقطع غير صالح.' });
        }
        const msg =
          prepared.error === 'unsupported'
            ? 'صيغة غير مدعومة.'
            : prepared.detail ||
              'تعذّر معالجة الملف. جرّب MP3 أو MP4 بصوت واضح.';
        return interaction.editReply({ content: msg });
      }
      const fromMp4 = file.name.toLowerCase().endsWith('.mp4');
      const { name: savedName } = soundLib.addSound(
        interaction.user.id,
        prepared.buffer,
        name,
        { activate: false }
      );
      const note = fromMp4 ? '\n(صوت مستخرج من الفيديو وحُفظ كـ MP3.)' : '';
      const seg =
        prepared.usedStart > 0 || prepared.usedDuration < prepared.sourceDuration
          ? `\nالمقطع: من **${prepared.usedStart.toFixed(1)}** ث طول **${prepared.usedDuration.toFixed(1)}** ث (من أصل ~${prepared.sourceDuration.toFixed(1)} ث).`
          : '';
      return interaction.editReply({
        content:
          `تمت إضافة **${savedName}** للمكتبة **بدون تفعيل**.${note}${seg}\n` +
          `الحد الأقصى لطول المقطع المحفوظ: **${audioFrom.MAX_AUDIO_SECONDS}** ثانية.\n` +
          'لتشغيله عند الدخول للروم: `/sound select`.'
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
