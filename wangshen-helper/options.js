const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SECTION_NAMES = {
  basic: '基本信息', declarations: '是否题（声明）', education: '教育经历', internships: '实习 / 工作经历',
  projects: '项目经历', campus: '校园经历', awards: '获奖情况', languages: '语言能力',
  certificates: '证书', family: '家庭成员', texts: '常用长文本', custom: '自定义问答（各公司特有的题目）', settings: '插件设置',
};
const KEY_NAMES = {
  name: '姓名', gender: '性别', birth: '出生日期', nation: '民族', marital: '婚姻状况', political: '政治面貌',
  nativePlace: '籍贯（省/市/区）', hukou: '户口所在地', hukouType: '户口性质', sourceProvince: '生源地', height: '身高(cm)',
  weight: '体重(kg)', phone: '手机', email: '邮箱', address: '通讯地址', city: '现居城市', emergencyName: '紧急联系人',
  emergencyRelation: '紧急联系人关系', emergencyPhone: '紧急联系人电话', health: '健康状况', medicalHistory: '重大病史',
  graduateType: '应届 / 往届', graduateYear: '毕业届别', expectedCity: '期望工作城市（多个用 | 分开，按顺序优先；* 表示都没有时选第一个）', expectedSalary: '期望年薪(万元)',
  availableDate: '最早到岗日期', acceptAdjust: '是否服从调剂', hobbies: '兴趣爱好 / 特长', source: '信息来源 / 渠道（写法同上）',
  idNumber: '身份证号（插件不会自动填写）',
  relativesInCompany: '是否有亲属在应聘单位', badRecord: '是否有违法违纪 / 不良记录', nonCompete: '是否有竞业限制 / 服务期',
  sideBusiness: '是否持股 / 兼职 / 经商', foreignNationality: '是否有外国国籍 / 永久居留', acceptOverseas: '是否接受外派',
  level: '学历 / 级别', school: '学校', schoolEn: '学校英文名', major: '专业', majorEn: '专业英文名', start: '开始时间', end: '结束时间',
  degree: '学位', discipline: '学科门类', studyForm: '学习形式', training: '培养方式', rank: '成绩排名', unified: '是否统招',
  overseas: '是否海外学历', country: '国家 / 地区', gpa: '绩点 / 均分', note: '备注',
  company: '单位名称', dept: '部门', title: '职位 / 职务', desc: '描述', leaveReason: '离职原因', role: '担任角色', org: '所属单位 / 组织',
  date: '时间', language: '语种', exam: '考试类型', score: '成绩', detail: '说明', expire: '有效期至', number: '证书编号',
  relation: '关系', work: '工作单位', position: '职务', selfIntro: '自我评价', applyReason: '应聘原因', strengths: '个人优势', awardsSummary: '奖励情况说明（汇总）', companyExpectation: '对公司的期待',
  courses: '主修课程', avgScore: '算数平均分', age: '年龄', overseasDuration: '可接受外派时长（如 1年以下 / 1-2年）', partyDate: '入党 / 入团时间', highSchool: '是否填高中经历（自动 = 页面要求从高中填时才填；也可写 总是 / 从不）', college: '学院', schoolCity: '学校所在省/市', companyType: '企业性质', companySize: '企业规模', advisor: '导师', research: '研究方向 / 课题', q: '题目里包含的文字', a: '答案',
};
// 数组里 “教育经历 #1” 这种标题用哪个字段做副标题
const ITEM_TITLE = { education: (x) => `${x.level || ''} ${x.school || ''}`, internships: (x) => x.company, projects: (x) => x.name, campus: (x) => x.org, awards: (x) => x.name, languages: (x) => x.language, certificates: (x) => x.name, family: (x) => `${x.relation || ''} ${x.name || ''}`, custom: (x) => x.q ? `${x.q} → ${x.a || ''}` : '' };
const FILE_SLOTS = [
  ['photo', '证件照', 'image/*', '对应“照片 / 头像 / 免冠”'],
  ['resume', '简历 PDF', '.pdf,.doc,.docx', '对应“简历 / 附件 / 作品”'],
  ['transcript', '成绩单', '.pdf,image/*', '对应“成绩单”'],
  ['diploma', '毕业证 / 学位证', '.pdf,image/*', '对应“学历 / 学位 / 毕业证”'],
];

let P = null; // 当前资料
let DEF = null; // 插件自带的初始资料，用来决定显示顺序（浏览器存储会把字段按字母排序）
function orderedKeys(obj, tpl) {
  const ks = Object.keys(obj);
  if (!tpl || typeof tpl !== 'object') return ks;
  const t = Array.isArray(tpl) ? Object.keys(Object.assign({}, ...tpl)) : Object.keys(tpl);
  return [...t.filter((k) => k in obj), ...ks.filter((k) => !t.includes(k))];
}
let FILES = {};
let dirty = false;

function setStatus(t, color) { $('status').textContent = t; $('status').style.color = color || ''; }
function markDirty() { dirty = true; setStatus('有未保存的修改', '#b45309'); }

function field(path, key, val) {
  const long = typeof val === 'string' && (val.length > 46 || val.includes('\n')) || ['desc', 'selfIntro', 'applyReason', 'strengths', 'hobbies', 'detail', 'courses'].includes(key);
  const label = KEY_NAMES[key] || key;
  const warn = key === 'idNumber' ? '<span class="warn">只存在本机。按规则身份证号只能本人在网页上填，插件不会自动填写。</span>' : '';
  const input = long
    ? `<textarea data-path="${esc(path)}">${esc(val)}</textarea>`
    : `<input data-path="${esc(path)}" value="${esc(val)}">`;
  return `<div class="f${long ? ' wide' : ''}"><label>${esc(label)}</label>${input}${warn}</div>`;
}

function render() {
  const nav = [], html = [];
  for (const sec of orderedKeys(P, DEF)) {
    if (sec.startsWith('_')) continue;
    const name = SECTION_NAMES[sec] || sec;
    nav.push(`<a href="#sec-${sec}">${esc(name.replace(/（.*）/, ''))}</a>`);
    const v = P[sec];
    let body = '';
    if (Array.isArray(v)) {
      body = v.map((item, i) => `
        <div class="card">
          <div class="head"><span>#${i + 1}　${esc((ITEM_TITLE[sec] || (() => ''))(item) || '')}</span>
            <button class="link" data-op="up" data-sec="${sec}" data-i="${i}" ${i === 0 ? 'disabled' : ''}>上移</button>
            <button class="link" data-op="down" data-sec="${sec}" data-i="${i}" ${i === v.length - 1 ? 'disabled' : ''}>下移</button>
            <button class="link danger" data-op="del" data-sec="${sec}" data-i="${i}">删除</button></div>
          <div class="grid">${orderedKeys(item, DEF && DEF[sec]).map((k) => field(`${sec}.${i}.${k}`, k, item[k])).join('')}</div>
        </div>`).join('') + `<button class="link" data-op="add" data-sec="${sec}">＋ 添加一条</button>`;
    } else {
      body = `<div class="grid">${orderedKeys(v, DEF && DEF[sec]).map((k) => field(`${sec}.${k}`, k, v[k])).join('')}</div>`;
    }
    html.push(`<section id="sec-${sec}"><h2>${esc(name)}</h2>${body}</section>`);
  }
  nav.push('<a href="#sec-files">附件</a>', '<a href="#sec-json">导入导出</a>');
  $('nav').innerHTML = nav.join('');
  $('form').innerHTML = html.join('');
  $('json').value = JSON.stringify(P, null, 2);
}

function setPath(path, value) {
  const parts = path.split('.');
  let o = P;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
}

$('form').addEventListener('input', (e) => {
  const p = e.target.dataset.path; if (!p) return;
  setPath(p, e.target.value);
  $('json').value = JSON.stringify(P, null, 2);
  markDirty();
});
$('form').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-op]'); if (!b) return;
  const arr = P[b.dataset.sec], i = +b.dataset.i;
  if (b.dataset.op === 'add') {
    const tpl = arr[0] || (DEF && DEF[b.dataset.sec] && DEF[b.dataset.sec][0]) || {};
    arr.push(Object.fromEntries(orderedKeys(tpl, DEF && DEF[b.dataset.sec]).map((k) => [k, ''])));
  } else if (b.dataset.op === 'del') {
    if (!confirm('删除这一条？')) return;
    arr.splice(i, 1);
  } else if (b.dataset.op === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  else if (b.dataset.op === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  render(); markDirty();
});

async function save() {
  await chrome.storage.local.set({ profile: P });
  dirty = false; setStatus('已保存 ' + new Date().toLocaleTimeString(), '#16a34a');
}
$('save').onclick = save;
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

$('applyJson').onclick = () => {
  try { P = JSON.parse($('json').value); render(); markDirty(); setStatus('JSON 已应用，记得保存', '#b45309'); }
  catch (err) { alert('JSON 格式有误：' + err.message); }
};
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `网申资料_${(P.basic && P.basic.name) || ''}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { P = JSON.parse(await f.text()); if (DEF) wszsMergeMissing(P, DEF); render(); markDirty(); setStatus('已导入，记得保存', '#b45309'); }
  catch (err) { alert('文件不是有效的资料 JSON：' + err.message); }
  e.target.value = '';
};
$('reset').onclick = async () => {
  if (!confirm('恢复为插件自带的初始资料？你在这里做过的修改会被覆盖。')) return;
  P = await (await fetch(chrome.runtime.getURL('profile.default.json'))).json();
  render(); await save();
};

// ---------------- 附件
function renderFiles() {
  $('files').innerHTML = FILE_SLOTS.map(([k, name, accept, hint]) => {
    const f = FILES[k];
    const prev = f && /^image\//.test(f.type) ? `<img src="${f.dataUrl}" alt="">` : '';
    return `<div class="slot"><b>${name}</b><span class="note" style="margin:0">${hint}</span>
      ${prev}<span class="name">${f ? esc(f.name) + '　' + (f.size / 1024).toFixed(0) + ' KB' : '未上传'}</span>
      <div><button data-pick="${k}">${f ? '更换' : '选择文件'}</button> ${f ? `<button class="link danger" data-rm="${k}">移除</button>` : ''}</div>
      <input type="file" accept="${accept}" data-file="${k}" hidden></div>`;
  }).join('');
}
$('files').addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-pick]'), rm = e.target.closest('[data-rm]');
  if (pick) document.querySelector(`input[data-file="${pick.dataset.pick}"]`).click();
  if (rm) { delete FILES[rm.dataset.rm]; await chrome.storage.local.set({ files: FILES }); renderFiles(); }
});
$('files').addEventListener('change', async (e) => {
  const k = e.target.dataset.file; const f = e.target.files[0]; if (!k || !f) return;
  if (f.size > 10 * 1024 * 1024 && !confirm('文件超过 10MB，很多网申系统会拒收。仍然保存？')) return;
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  FILES[k] = { name: f.name, type: f.type, size: f.size, dataUrl };
  await chrome.storage.local.set({ files: FILES });
  renderFiles(); setStatus(`已保存附件：${f.name}`, '#16a34a');
});

(async () => {
  DEF = await (await fetch(chrome.runtime.getURL('profile.default.json'))).json();
  P = await wszsLoadProfile();
  FILES = (await chrome.storage.local.get('files')).files || {};
  render(); renderFiles();
})();
