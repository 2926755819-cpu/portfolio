const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function ensureProfile() {
  return wszsLoadProfile(); // 见 profile-merge.js：首次使用写入初始资料，升级后补上新增字段
}

async function runInTab(opts) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:|^file:/.test(tab.url || '')) throw new Error('这个页面不能填写（请在网申表单页面上使用）。');
  return wszsRunInTab(tab.id, opts); // 见 runner.js
}

const merge = wszsMerge;

function list(title, arr, cls, open) {
  if (!arr.length) return '';
  return `<details ${open ? 'open' : ''}><summary class="${cls}">${title}（${arr.length}）</summary><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
}

function show(m) {
  const out = $('out');
  if (m.msg.length && !m.filled && !m.log.length && !m.failed.length) { out.innerHTML = `<div class="bad">${esc(m.msg.join('；'))}</div>`; return; }
  out.innerHTML =
    `<div class="sum"><span class="ok">已填 ${m.filled} 项</span>` +
    (m.failed.length ? `　<span class="bad">没填上 ${m.failed.length} 项</span>` : '') +
    (m.skipped ? `　<span class="sub">原有内容保留 ${m.skipped} 项</span>` : '') + '</div>' +
    list('没填上（请手动处理）', m.failed, 'bad', true) +
    list('还空着的必填项（页面上已标橙色框）', m.missingRequired, 'bad', true) +
    list('附件', m.log, '', true) +
    list('已填写', m.filledList, 'ok', false) +
    (m.sections.length ? `<div class="sub" style="margin-top:6px">识别到的板块：${esc(m.sections.join('、'))}</div>` : '') +
    (m.msg.length ? `<div class="sub">${esc(m.msg.join('；'))}</div>` : '') +
    (m.diag.length ? `<div style="margin-top:8px"><button id="copyDiag">复制诊断信息（发给 Claude 用来修复）</button></div>` : '');
  if (m.diag.length) {
    $('copyDiag').onclick = async () => {
      const text = 'WSZS-DIAG ' + chrome.runtime.getManifest().version + ' ' + m.url + '\n' + JSON.stringify(m.diag.slice(0, 5));
      try { await navigator.clipboard.writeText(text); $('copyDiag').textContent = '已复制，粘贴到对话里即可'; }
      catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); $('copyDiag').textContent = '已复制，粘贴到对话里即可'; }
    };
  }
}

async function act(opts, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '处理中…';
  try {
    await ensureProfile();
    show(merge(await runInTab(opts)));
  } catch (e) {
    $('out').innerHTML = `<div class="bad">${esc(e.message || e)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

(async () => {
  try {
    const st = await chrome.storage.local.get('popupOpts');
    const o = st.popupOpts || {};
    if ('overwrite' in o) $('overwrite').checked = o.overwrite;
    if ('addEntries' in o) $('addEntries').checked = o.addEntries;
    const p = await ensureProfile();
    $('who').textContent = ((p.basic && p.basic.name) || '') + '  v' + chrome.runtime.getManifest().version;
  } catch (e) { /* ignore */ }
})();
const saveOpts = () => chrome.storage.local.set({ popupOpts: { overwrite: $('overwrite').checked, addEntries: $('addEntries').checked } });
$('overwrite').onchange = saveOpts;
$('addEntries').onchange = saveOpts;

$('fill').onclick = (e) => act({ mode: 'fill', overwrite: $('overwrite').checked, addEntries: $('addEntries').checked }, e.currentTarget);
$('upload').onclick = (e) => act({ mode: 'upload' }, e.currentTarget);
$('clear').onclick = (e) => act({ mode: 'clear' }, e.currentTarget);
$('settings').onclick = () => chrome.runtime.openOptionsPage();
