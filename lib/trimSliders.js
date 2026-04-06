const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection
} = require('@discordjs/voice');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const audioFrom = require('./audioFromAttachment');
const pendingTrim = require('./pendingTrim');
const soundLib = require('./soundLibrary');

/** منع معاينات متزامنة في نفس السيرفر (يُزال عند انتهاء التشغيل). */
const previewGuildBusy = new Set();

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
      ? 'قص مقطع الدخول (set-sound)'
      : 'قص مقطع جديد (sound add)';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(
      '**كيف تختار المقطع؟**\n' +
        '• **بداية المقطع** = من أي ثانية يبدأ الصوت الذي سيُحفظ.\n' +
        '• **طول المقطع** = كم ثانية تُسجَّل من تلك البداية (بحد أقصى **' +
        audioFrom.MAX_AUDIO_SECONDS +
        '** ث).\n' +
        '• اضغط **▶ معاينة** وأنت داخل **روم صوتي** لتسمع النتيجة قبل الحفظ.\n\n' +
        `**الملف كامل:** ~${total.toFixed(1)} ث\n` +
        `**المقطع المختار:** من **${fmtTime(state.startSec)}** إلى **${fmtTime(end)}** (${state.durationSec.toFixed(1)} ث)\n\n` +
        `\`${bar}\` _تقريبي_`
    )
    .setFooter({ text: 'تنتهي الجلسة بعد 10 دقائق. يمكنك أيضاً إدخال start_second و duration_second في الأمر.' });
}

function buildRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:start:-5')
        .setLabel('بداية −5 ث')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:-1')
        .setLabel('بداية −1')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:1')
        .setLabel('بداية +1')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('trim:start:5')
        .setLabel('بداية +5 ث')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:dur:-1')
        .setLabel('طول −1 ث')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:-0.5')
        .setLabel('طول −0.5')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:0.5')
        .setLabel('طول +0.5')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:dur:1')
        .setLabel('طول +1 ث')
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('trim:play')
        .setLabel('▶ معاينة')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('trim:save')
        .setLabel('✓ حفظ في المكتبة')
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

async function playTrimPreview(interaction, state) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: 'المعاينة تعمل داخل السيرفر فقط.',
      ephemeral: true
    });
  }

  const channel = interaction.member?.voice?.channel;
  if (!channel?.isVoiceBased()) {
    return interaction.reply({
      content:
        '**ادخل روم صوتي** في هذا السيرفر، ثم اضغط **▶ معاينة** مرة أخرى.\n' +
        'البوت يشغّل الصوت في نفس الروم الذي أنت فيه.',
      ephemeral: true
    });
  }

  if (!channel.joinable) {
    return interaction.reply({
      content:
        'البوت لا يستطيع الدخول لهذا الروم. أعطِ البوت صلاحيتَي **الاتصال** و**عرض القناة**.',
      ephemeral: true
    });
  }

  if (previewGuildBusy.has(guild.id)) {
    return interaction.reply({
      content: 'معاينة قيد التشغيل في السيرفر. انتظر حتى تنتهي ثم جرّب مجدداً.',
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  const prepared = audioFrom.prepareJoinSoundBuffer(state.buffer, state.fileName, {
    startSec: state.startSec,
    durationSec: state.durationSec
  });
  if (!prepared.ok) {
    return interaction.followUp({
      content: prepared.detail || 'تعذّر تجهيز المقطع للمعاينة.',
      ephemeral: true
    });
  }

  const tmpPath = path.join(
    os.tmpdir(),
    `trim-preview-${Date.now()}-${interaction.user.id}.mp3`
  );
  fs.writeFileSync(tmpPath, prepared.buffer);

  previewGuildBusy.add(guild.id);

  let connection;
  try {
    const existing = getVoiceConnection(guild.id);
    if (existing) {
      try {
        existing.destroy();
      } catch (_) {
        /* ignore */
      }
    }

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 25_000);

    const player = createAudioPlayer();
    const resource = createAudioResource(tmpPath);
    connection.subscribe(player);
    player.play(resource);

    await interaction.followUp({
      content:
        `تشغيل معاينة (~**${prepared.usedDuration.toFixed(1)}** ث) في **${channel.name}**.\n` +
        'إذا كان الصوت مناسباً اضغط **حفظ في المكتبة**، وإلا عدّل البداية أو الطول.',
      ephemeral: true
    });

    const cleanup = () => {
      previewGuildBusy.delete(guild.id);
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {
        /* ignore */
      }
      try {
        connection.destroy();
      } catch (_) {
        /* ignore */
      }
    };

    player.once('idle', cleanup);
    player.once('error', err => {
      console.error('Trim preview play error:', err);
      cleanup();
    });
  } catch (err) {
    console.error('Trim preview failed:', err);
    previewGuildBusy.delete(guild.id);
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
    try {
      connection?.destroy();
    } catch (_) {
      /* ignore */
    }
    await interaction
      .followUp({
        content: 'تعذّر الاتصال بالروم الصوتي أو تشغيل المعاينة. تحقق من الصلاحيات.',
        ephemeral: true
      })
      .catch(() => {});
  }
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

  if (id === 'trim:play') {
    return playTrimPreview(interaction, state);
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
