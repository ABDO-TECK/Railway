const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');

const soundLib = require('../lib/soundLibrary');
const joinCooldown = require('../lib/joinSoundCooldown');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const prevCh = oldState.channelId ?? null;
    const nextCh = newState.channelId ?? null;
    if (!nextCh || prevCh === nextCh) return;

    const userId = newState.id;

    let user = newState.member?.user;
    if (!user) {
      try {
        user = await newState.client.users.fetch(userId);
      } catch {
        return;
      }
    }
    if (user.bot) return;

    if (!soundLib.isJoinSoundEnabled(userId)) return;

    const filePath = soundLib.getActiveFilePath(userId);
    if (!filePath) return;

    let channel = newState.channel;
    if (!channel) {
      try {
        channel = await newState.guild.channels.fetch(nextCh);
      } catch {
        console.warn(`[voice] لا يمكن جلب القناة ${nextCh} — البوت لا يملك صلاحية رؤيتها.`);
        return;
      }
    }
    if (!channel) {
      console.warn(`[voice] القناة ${nextCh} غير مرئية للبوت — أضف صلاحيتَي View Channel + Connect.`);
      return;
    }
    if (!channel.isVoiceBased()) return;

    if (!channel.joinable) {
      console.warn(`[voice] البوت لا يستطيع الدخول لـ "${channel.name}" — تحقق من صلاحيتَي View Channel + Connect.`);
      return;
    }

    if (!joinCooldown.tryAcquireJoinSound(newState.guild.id)) {
      return;
    }

    const guildId = newState.guild.id;

    let connection;
    try {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId,
        adapterCreator: newState.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 25_000);
    } catch (err) {
      console.error('Voice connection failed:', err);
      joinCooldown.releaseJoinSoundSlot(guildId);
      try {
        connection?.destroy();
      } catch (_) {
        /* ignore */
      }
      return;
    }

    try {
      const player = createAudioPlayer();
      const resource = createAudioResource(filePath);

      connection.subscribe(player);
      player.play(resource);

      const cleanup = () => {
        joinCooldown.markJoinSoundFinished(guildId);
        try {
          connection.destroy();
        } catch (_) {
          /* ignore */
        }
      };

      player.once('idle', cleanup);
      player.once('error', err => {
        console.error('Audio player error:', err);
        cleanup();
      });
    } catch (err) {
      console.error('Voice play failed:', err);
      joinCooldown.releaseJoinSoundSlot(guildId);
      try {
        connection.destroy();
      } catch (_) {
        /* ignore */
      }
    }
  }
};
