/** أقل مدة بين انتهاء آخر تشغيل وبدء تشغيل جديد في نفس السيرفر (مللي ثانية). */
const JOIN_SOUND_COOLDOWN_MS = 10_000;

const busyOrPending = new Set();
const lastEndedAtByGuild = new Map();

/**
 * يحجز السيرفر: لا يمرّ إلا إن لم يكن هناك تشغيل/انتظار، ومضى وقت كافٍ بعد آخر انتهاء.
 */
function tryAcquireJoinSound(guildId) {
  const id = String(guildId);
  if (busyOrPending.has(id)) return false;
  const lastEnd = lastEndedAtByGuild.get(id) || 0;
  if (Date.now() - lastEnd < JOIN_SOUND_COOLDOWN_MS) return false;
  busyOrPending.add(id);
  return true;
}

/** إذا فشل الدخول أو التشغيل قبل الانتهاء الطبيعي */
function releaseJoinSoundSlot(guildId) {
  busyOrPending.delete(String(guildId));
}

/** عند انتهاء الصوت (idle) أو خطأ في المشغّل */
function markJoinSoundFinished(guildId) {
  const id = String(guildId);
  busyOrPending.delete(id);
  lastEndedAtByGuild.set(id, Date.now());
}

module.exports = {
  JOIN_SOUND_COOLDOWN_MS,
  tryAcquireJoinSound,
  releaseJoinSoundSlot,
  markJoinSoundFinished
};
