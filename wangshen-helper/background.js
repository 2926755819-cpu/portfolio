// 网申助手后台：接收页面里 window.wszs 发来的指令（来自对话里的 Claude），
// 执行“填写 / 上传附件 / 清除颜色 / 重新加载插件”，把结果送回页面。
// 只在 manifest 里列出的招聘网站上生效；永远不会点“提交 / 投递”。
importScripts('profile-merge.js', 'runner.js');

let injectLog = [];
async function injectBridges(why) {
  const log = { why, at: new Date().toISOString(), tabs: [] };
  injectLog = [log, ...injectLog].slice(0, 5);
  // 插件重新加载后，已打开的招聘页面里旧的桥接脚本会失效，这里给它们补上新的。
  // 同一次加载里只补一次（gen 存在 storage.session，重新加载插件后会清空）
  const st = await chrome.storage.session.get('bridgeGen');
  let gen = st.bridgeGen;
  if (!gen) { gen = String(Date.now()); await chrome.storage.session.set({ bridgeGen: gen }); }
  const matches = chrome.runtime.getManifest().content_scripts[0].matches;
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: matches }); } catch (e) { log.err = String(e.message || e); }
  log.found = tabs.length;
  // 各标签页各自处理、互不等待：Edge 会冻结后台标签页，注入要等它恢复（切到前台）后才执行，不能拖住其他页面。
  // 已被丢弃（discarded）的标签页切回来时会重新加载，届时 manifest 里的桥接脚本会自动注入。
  for (const t of tabs) {
    const row = { id: t.id, host: (t.url || '').split('/')[2], state: t.discarded ? 'discarded' : t.frozen ? 'frozen' : 'live' };
    log.tabs.push(row);
    if (t.discarded) continue;
    (async () => {
      try {
        const [{ result: has }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: (g) => { const had = window.__wszsGen === g; window.__wszsGen = g; return had; }, args: [gen] });
        if (has) { row.skip = true; return; }
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['bridge.js'] });
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['bridge-main.js'], world: 'MAIN' });
        row.ok = true;
      } catch (e) { row.err = String(e.message || e).slice(0, 120); }
    })();
  }
}
chrome.runtime.onInstalled.addListener((d) => { injectBridges('installed:' + d.reason); });
injectBridges('startup'); // 后台每次启动都检查一遍（Edge 里手动点“重新加载”不一定触发 onInstalled）

async function handle(msg, sender) {
  const version = chrome.runtime.getManifest().version;
  const action = msg.action;
  if (action === 'ping') return { ok: true, version, injectLog };
  if (action === 'inject') { await injectBridges('manual'); return { ok: true, version, injectLog }; }
  if (action === 'reload') {
    setTimeout(() => chrome.runtime.reload(), 300);
    return { ok: true, version, reloading: true };
  }
  if (action === 'set') {
    const fields = (msg.opts && msg.opts.fields) || {};
    const m = wszsMergeSet(await wszsRunInTab(sender.tab.id, { mode: 'set', fields }), fields);
    m.version = version;
    return m;
  }
  if (action === 'fill' || action === 'upload' || action === 'clear' || action === 'todo') {
    await wszsLoadProfile();
    const saved = (await chrome.storage.local.get('popupOpts')).popupOpts || {};
    const o = msg.opts || {};
    const opts = action === 'fill'
      ? { mode: 'fill', overwrite: o.overwrite ?? saved.overwrite ?? false, addEntries: o.addEntries ?? saved.addEntries ?? true, eduOrder: o.eduOrder }
      : { mode: action };
    const m = wszsMerge(await wszsRunInTab(sender.tab.id, opts));
    m.version = version;
    return m;
  }
  return { ok: false, msg: '未知指令：' + action };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wszs-relay' || !sender.tab) return;
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, msg: String((e && e.message) || e) }));
  return true;
});
