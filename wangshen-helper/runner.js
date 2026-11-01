// 在指定标签页里注入 content.js 并执行填写 / 上传（弹窗和后台共用）
// 资料从本机存储读出，作为参数交给页面里的填写脚本；不会发到任何服务器
async function wszsRunInTab(tabId, opts) {
  const st = await chrome.storage.local.get(['profile', 'files']);
  const args = { ...opts, profile: st.profile };
  if (opts.mode === 'upload') args.files = st.files || {};
  let target = { tabId, allFrames: true };
  // 在页面环境里运行，这样 React / Vue / antd 组件才能收到键盘、输入事件
  try {
    await chrome.scripting.executeScript({ target, files: ['content.js'], world: 'MAIN' });
  } catch (e) {
    target = { tabId }; // 某些跨域 iframe 没有权限时，只填主页面
    await chrome.scripting.executeScript({ target, files: ['content.js'], world: 'MAIN' });
  }
  const res = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: (o) => (window.__WSZS ? window.__WSZS.run(o) : null),
    args: [args],
  });
  return res.map((r) => r.result).filter(Boolean);
}

// 把各个 iframe 的结果合并成一份
function wszsMerge(results) {
  const m = { filled: 0, filledList: [], failed: [], skipped: 0, missingRequired: [], userOnly: [], log: [], sections: [], msg: [], diag: [], url: '' };
  for (const r of results) {
    if (r.ok === false) { m.msg.push(r.msg); continue; }
    m.filled += r.filled || 0;
    m.skipped += r.skipped || 0;
    for (const k of ['filledList', 'failed', 'missingRequired', 'userOnly', 'log', 'sections', 'diag']) m[k].push(...(r[k] || []));
    if (r.eduOrder === 'desc') m.eduOrder = 'desc';
    if (r.url && !m.url) m.url = r.url;
    if (r.msg) m.msg.push(r.msg);
  }
  m.missingRequired = [...new Set(m.missingRequired)];
  m.userOnly = [...new Set(m.userOnly)];
  m.sections = [...new Set(m.sections)];
  return m;
}

// wszs.set 的结果：同一个标签在各框架里只要有一个找到并填上就算成功
function wszsMergeSet(results, fields) {
  const byKey = {};
  const missing = [];
  for (const r of results) {
    if (!r || r.ok === false) continue;
    for (const x of r.results || []) {
      const cur = byKey[x.key];
      if (!cur || (!cur.ok && (x.ok || (x.found && !cur.found)))) byKey[x.key] = x;
    }
    missing.push(...(r.missingRequired || []));
  }
  const list = Object.keys(fields || {}).map((k) => byKey[k] || { key: k, ok: false, found: false, msg: '没找到这个字段' });
  return { ok: true, set: list.filter((x) => x.ok).length, failed: list.filter((x) => !x.ok).map((x) => `${x.key}：${x.msg || '没填上'}`), results: list, missingRequired: [...new Set(missing)] };
}
