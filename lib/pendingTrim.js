/** جلسات قص الصوت المؤقتة (حتى يضغط المستخدم حفظ/إلغاء). */
const TTL_MS = 10 * 60 * 1000;

const store = new Map();

function set(userId, data) {
  store.set(String(userId), {
    ...data,
    createdAt: Date.now()
  });
}

function get(userId) {
  const id = String(userId);
  const x = store.get(id);
  if (!x) return null;
  if (Date.now() - x.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return x;
}

function del(userId) {
  store.delete(String(userId));
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}, 60_000);

module.exports = { set, get, del };
