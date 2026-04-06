const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const audioFrom = require('./audioFromAttachment');
const pendingTrim = require('./pendingTrim');
const soundLib = require('./soundLibrary');

function fmtTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const f = Math.round((s % 1) * 10) / 10;
  const whole = r + (f > 0 && f < 1 ? f : 0);
  return `${m}:${String(Math.floor(whole)).padStart(2, '0')}`;
}

function clamp(state) {
  const total = state.totalDur;
  state.startSec = Math.max(0, Math.min(state.startSec, total - 0.1));
  const maxDur = Math.min(audioFrom.MAX_AUDIO_SECONDS, total - state.startSec);
  state.durationSec = Math.max(0.1, Math.min(state.durationSec, maxDur));
}

function buildEmbed(state) {
  const total = state.totalDur;
  const end = state.startSec + state.durationSec;
  const barLen = 14;
  const startIdx =
    total > 0 ? Math.min(barLen - 1, Math.floor((state.startSec / total) * barLen)) : 0;
  const span = Math.max(
    1,
    total > 0
      ? Math.ceil((state.durationSec / total) * barLen)
      : 1
  );
  let bar = '';
  for (let i = 0; i < barLen; i++) {
    if (i === startIdx) bar += '●';
    else if (i > startIdx && i < startIdx + span) bar += '▓';
    else bar += '░';
  }

  const title =
    state.mode === 'set-sound'
      ? 'قص الصوت — set-sound'
      : 'قص الصوت — sound add';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(
      `**طول الملف:** ~${total.toFixed(1)} ث (${fmtTime(total)})\n` +
        `**البداية:** ${state.startSec.toFixed(1)} ث (${fmtTime(state.startSec)})\n` +
        `**طول المقطع:** ${state.durationSec.toFixed(1)} ث (الحد ${audioFrom.MAX_AUDIO_SECONDS} ث)\n` +
        `**من ${fmtTime(state.startSec)} إلى ${fmtTime(end)}**\n\n` +
        `\`${bar}\`\n` +
        '_استخدم الأزرار كسلايدر تقريبي — أدق من الأرقام في الأمر نفسه._'
    )
    .setFooter({ text: 'يُلغى الجلسة بعد 10 دقائق.' });
}

function buildRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:start:-5')
        .setLabel('◀ -5 ث')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:-1')
        .setLabel('◀ -1')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:1')
        .setLabel('+1 ▶')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:5')
        .setLabel('+5 ث ▶')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:dur:-1')
        .setLabel('طول −1')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:-0.5')
        .setLabel('−0.5')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:0.5')
        .setLabel('+0.5')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:1')
        .setLabel('طول +1')
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:save')
        .setLabel('حفظ في المكتبة')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('trim:cancel')
        .setLabel('إلغاء')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildEmbedAndRows(state) {
  clamp(state);
  return { embed: buildEmbed(state), components: buildRows() };
}

async function handleTrimInteraction(interaction) {
  const uid = interaction.user.id;
  const state = pendingTrim.get(uid);
  if (!state) {
    return interaction.reply({
      content: 'انتهت جلسة القص أو غير موجودة. أعد رفع الملف.',
      ephemeral: true
    });
  }

  const id = interaction.customId;

  if (id === 'trim:cancel') {
    pendingTrim.del(uid);
    await interaction.update({
      embeds: [],
      components: [],
      content: 'تم الإلغاء.'
    });
    return;
  }

  if (id === 'trim:save') {
    await interaction.deferUpdate();
    const prepared = audioFrom.prepareJoinSoundBuffer(state.buffer, state.fileName, {
      startSec: state.startSec,
      durationSec: state.durationSec
    });
    pendingTrim.del(uid);
    if (!prepared.ok) {
      return interaction.editReply({
        embeds: [],
        components: [],
        content: prepared.detail || 'فشل حفظ المقطع.'
      });
    }

    try {
      if (state.mode === 'set-sound') {
        const { name } = soundLib.addSound(uid, prepared.buffer, '', {
          activate: true
        });
        return interaction.editReply({
          embeds: [],
          components: [],
          content:
            `تم الحفظ باسم **${name}** (مفعّل).\n` +
            `المقطع: ${prepared.usedStart.toFixed(1)} ث → ${(prepared.usedStart + prepared.usedDuration).toFixed(1)} ث`
        });
      }
      const displayName = state.displayName;
      const { name: savedName } = soundLib.addSound(uid, prepared.buffer, displayName, {
        activate: false
      });
      return interaction.editReply({
        embeds: [],
        components: [],
        content:
          `تمت إضافة **${savedName}** للمكتبة (غير مفعّل). استخدم \`/sound select\`.\n` +
          `المقطع: ${prepared.usedStart.toFixed(1)} ث، طول ${prepared.usedDuration.toFixed(1)} ث`
      });
    } catch (e) {
      console.error(e);
      return interaction.editReply({
        embeds: [],
        components: [],
        content: 'حدث خطأ أثناء الحفظ.'
      });
    }
  }

  const m = /^trim:(start|dur):(-?\d+(?:\.\d+)?)$/.exec(id);
  if (!m) {
    return interaction.reply({ content: 'زر غير صالح.', ephemeral: true });
  }

  const [, kind, rawVal] = m;
  const delta = parseFloat(rawVal);
  if (Number.isNaN(delta)) {
    return interaction.reply({ content: 'قيمة غير صالحة.', ephemeral: true });
  }

  if (kind === 'start') {
    state.startSec = Math.max(
      0,
      Math.min(state.startSec + delta, state.totalDur - state.durationSec)
    );
  } else {
    state.durationSec = state.durationSec + delta;
  }

  clamp(state);
  const { embed, components } = buildEmbedAndRows(state);
  pendingTrim.set(uid, state);

  await interaction.update({ embeds: [embed], components });
}

module.exports = {
  buildEmbedAndRows,
  handleTrimInteraction
};
