// 旧版本默认值 → 新版本默认值（只替换用户没改过的）
const WSZS_MIGRATIONS = [];
// 新版本新增的条目（用户资料里还没有同类条目时补上）。格式：{ list: 'languages', test: (x) => 判断已有同类条目, item: {...} }
const WSZS_NEW_ITEMS = [];
function wszsAddItems(profile) {
  for (const n of WSZS_NEW_ITEMS) {
    const arr = profile[n.list];
    if (Array.isArray(arr) && !arr.some(n.test)) arr.push(JSON.parse(JSON.stringify(n.item)));
  }
  return profile;
}
// 新版本新增的自定义问答（用户资料里没有同名题目时补上）。答案里的 {phone} 填写时换成资料里的手机号
const WSZS_NEW_CUSTOM = [{"q": "微信号", "a": "{phone}"}];
// 插件升级后，把新版本初始资料里新增的字段补进用户已保存的资料里。
// 只补“缺少的字段”，用户改过的内容一律不动。
function wszsMergeMissing(stored, def) {
  const MATCH_KEYS = ['school', 'company', 'name', 'org', 'relation', 'language', 'q'];
  function merge(s, d) {
    if (s === undefined) return [JSON.parse(JSON.stringify(d)), true];
    if (Array.isArray(d)) {
      if (!Array.isArray(s)) return [s, false];
      let changed = false;
      for (const item of s) {
        if (!item || typeof item !== 'object') continue;
        const k = MATCH_KEYS.find((key) => item[key]);
        const src = k && d.find((x) => x && x[k] === item[k]);
        if (!src) continue;
        for (const key of Object.keys(src)) if (!(key in item)) { item[key] = src[key]; changed = true; }
      }
      return [s, changed];
    }
    if (d && typeof d === 'object') {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return [s, false];
      let changed = false;
      for (const key of Object.keys(d)) {
        if (key.startsWith('_')) continue;
        const [v, c] = merge(s[key], d[key]);
        s[key] = v; changed = changed || c;
      }
      return [s, changed];
    }
    return [s, false];
  }
  return merge(stored, def);
}

async function wszsLoadProfile() {
  const def = await (await fetch(chrome.runtime.getURL('profile.default.json'))).json();
  const st = await chrome.storage.local.get(['profile', 'profileDefaultVersion']);
  const ver = chrome.runtime.getManifest().version;
  if (!st.profile) {
    await chrome.storage.local.set({ profile: def, profileDefaultVersion: ver });
    return def;
  }
  if (st.profileDefaultVersion === ver) return st.profile;
  const [merged] = wszsMergeMissing(st.profile, def);
  wszsApplyMigrations(merged);
  wszsAddItems(merged);
  if (Array.isArray(merged.custom)) for (const c of WSZS_NEW_CUSTOM) if (!merged.custom.some((x) => x && x.q === c.q)) merged.custom.push({ ...c });
  await chrome.storage.local.set({ profile: merged, profileDefaultVersion: ver });
  return merged;
}

function wszsApplyMigrations(profile) {
  for (const m of WSZS_MIGRATIONS) {
    let o = profile;
    for (let i = 0; i < m.path.length - 1 && o; i++) {
      const k = m.path[i];
      if (k && typeof k === 'object') { const [kk, vv] = Object.entries(k)[0]; o = Array.isArray(o) ? o.find((x) => x && x[kk] === vv) : null; }
      else o = o[k];
    }
    const last = m.path[m.path.length - 1];
    if (o && o[last] === m.from) o[last] = m.to;
  }
  return profile;
}
