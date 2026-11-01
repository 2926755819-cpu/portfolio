/* 网申助手 · 填写引擎
 * 原则：只填写、不提交；默认只填空白字段；填完用颜色标出结果。
 * 被 popup 通过 chrome.scripting 注入到当前页面（含 iframe），然后调用 window.__WSZS.run(opts)。
 */
(() => {
  const VERSION = '0.8.4';
  // 同一页面里如果还留着旧版本的脚本，就换成新版本
  if (window.__WSZS && window.__WSZS.version === VERSION) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 身份证 / 证件号只能由用户本人填写：这类字段一律不自动填（包括 wszs.set）
  const SENSITIVE = /身份证|证件号|证件编号|证件号码|身份号码|公民身份|护照号|通行证号|ID\s*(No|number|card)/i;
  const isSensitive = (label) => SENSITIVE.test(label || '') && !/类型|种类/.test(label || '');
  const ID_VAL = /^\s*\d{17}[\dXx]\s*$/;
  const clean = (s) => (s || '').replace(/[\s　]+/g, ' ').replace(/[*＊]|必填|（必填）|\(必填\)/g, '').replace(/[：:]\s*$/, '').trim().replace(/\s*[?？]$/, '');
  const norm = (s) => (s || '').replace(/[\s　*＊：:（）()【】\[\]·•\-—_/、，,。.]/g, '').toLowerCase();
  const visible = (el) => !!(el && el.isConnected && (el.offsetParent || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden');

  // ---------------------------------------------------------------- 选项同义词
  const SYN = [
    ['中共党员', '中国共产党党员', '党员', '共产党员'],
    ['中共预备党员', '预备党员', '中国共产党预备党员'],
    ['共青团员', '中国共产主义青年团团员', '团员'],
    ['本科', '大学本科', '本科生', '学士学历'],
    ['硕士研究生', '硕士', '研究生', '硕士研究生学历'],
    ['博士研究生', '博士'],
    ['高中', '普通高中', '高中/中专'],
    ['学士', '学士学位'], ['硕士', '硕士学位'],
    ['男', '男性'], ['女', '女性'],
    ['汉族', '汉'],
    ['未婚', '单身'],
    ['全日制', '普通全日制', '统招全日制'],
    ['非农业户口', '非农户口', '城镇户口', '城镇', '非农业', '城市'],
    ['农业户口', '农村户口', '农业'],
    ['健康', '良好'],
    ['是', '有', '同意', '接受', '愿意'],
    ['否', '无', '没有', '不接受'],
    ['应届', '应届生', '应届毕业生', '2027届应届毕业生', '2027届'],
    ['熟练', '良好', '熟练掌握', '精通'],
    ['院校级', '校级', '院级', '院级(校级)'],
    ['国家级', '国家级、国际级', '全国'],
    ['官网', '海信官网', '公司官网', '企业官网', '官方网站'],
    ['父亲', '父'], ['母亲', '母'],
    ['群众', '普通群众'],
    ['雅思', 'IELTS', 'ielts'],
    ['英语', '英文'],
    ['自筹', '自费'],
    ['大学英语四级（CET-4）', '大学英语四级', '英语四级', 'CET-4', 'CET4', 'CET 4', '四级', '英语四级（CET-4）', '大学英语四级(CET4)'],
    ['中国', '中国大陆', '中华人民共和国', '中国（大陆）', '中国(大陆)', 'China'],
  ];
  const synOf = (v) => {
    const n = norm(v);
    for (const g of SYN) if (g.some((x) => norm(x) === n)) return g;
    return [v];
  };
  function matchScore(optText, want) {
    const o = norm(optText); if (!o) return 0;
    const pw = String(want).match(/(?:前|top)\s*(\d+)\s*%/i);
    if (pw) {
      const N = +pw[1];
      const po = String(optText).match(/(?:前|top)\s*(\d+)\s*%/i); if (po && +po[1] === N) return 100;
      const r = String(optText).match(/(\d+)\s*%?\s*[~\-－—至到]\s*(\d+)\s*%/);
      if (r) { const a = +r[1], b = +r[2]; if (b === N) return 95; if (a < N && N <= b) return 70; }
    }
    const cands = synOf(want).map(norm);
    if (cands.includes(o)) return 100;
    let best = 0;
    for (const c of cands) {
      if (!c) continue;
      if (o.includes(c) || c.includes(o)) best = Math.max(best, 60 - Math.abs(o.length - c.length));
    }
    // 地区：取最后一级比较，如 “浙江省/杭州市/西湖区” 对 “杭州”
    const parts = String(want).split(/[\/>\s]/).filter(Boolean);
    for (const p of parts.reverse()) {
      const q = norm(p.replace(/[省市区县]$/, ''));
      if (q.length >= 2 && o.includes(q)) { best = Math.max(best, 40); break; }
    }
    return best;
  }

  // ---------------------------------------------------------------- 板块识别
  const SECTIONS = [
    ['basic', /^(基本|个人)(信息|资料)|^(其他|附加|补充)(信息|问题)|^求职意向|^(自我|个人)评价|^应聘信息/],
    ['edu', /^(教育|学习|学历)(经历|背景)|^教育经历|^学习经历/],
    ['intern', /^实习(经历|经验)|^实习\/工作|^工作\/实习|^实习[\/、与和及]?实践/],
    ['work', /^(工作|全职工作|社会工作|全职)(经历|经验)/],
    ['project', /^(项目|研究项目|科研)(经历|经验)|^项目$/],
    ['campus', /^(校园|社团|学生干部|在校|校内|社会实践|学生工作)/],
    ['award', /^(获奖|奖励|荣誉|奖惩|在校期间获奖)(情况|经历|荣誉|奖励|信息|记录)?$/],
    ['family', /^(家庭|亲属|主要家庭|家庭成员|家庭及社会)/],
    ['lang', /^(语言|外语)(能力)?|^技能([\/、与和及]?(爱好|特长))?$/],
    ['cert', /^(证书|资格证书|职业资格|技能证书|专业资格|技能资质)(证书|信息|情况)?$/],
    ['research', /^(研究成果|学术成果|科研成果|论文发表|专利发表|论文|专利|发表)(情况|成果)?$/],
  ];
  let HEADERS = [];
  function scanHeaders() {
    const out = [];
    const cand = document.querySelectorAll('h1,h2,h3,h4,h5,legend,[class*="title"],[class*="Title"],[class*="header"],[class*="head"],div,span,p');
    for (const el of cand) {
      if (el.children.length > 2) continue;
      // “添加工作/实习经历”“项目经历 添加”这类标题：去掉前后的按钮字
      const t = clean(el.textContent).replace(/^(添加|新增|编辑|修改)\s*/, '').replace(/\s*\+?\s*(添加|新增|编辑)$/, '');
      if (!t || t.length > 14) continue;
      if (el.querySelector('input, select, textarea, ' + CUSTOM_SELECT)) continue;
      // 和一两个输入框挨在同一行的短文字是字段名，不是板块标题（例如“专业资格证书 [  ]”）
      const par = el.parentElement;
      if (par && clean(par.textContent).length < 60) {
        const r = el.getBoundingClientRect(), mid = (r.top + r.bottom) / 2;
        const sameLine = [...par.querySelectorAll('input:not([type=hidden]), select, textarea')].some((c) => { const q = c.getBoundingClientRect(); return q.height && Math.abs((q.top + q.bottom) / 2 - mid) < 14 && q.left >= r.right - 4; });
        if (sameLine) continue;
      }
      if (el.closest('label, .form-item__title, .ant-form-item-label, .el-form-item__label, nav, aside, [class*="nav"], [class*="Nav"], [class*="menu"], [class*="Menu"], [class*="anchor"], [class*="Anchor"], [class*="sidebar"], [class*="catalog"], [class*="steps"], [role="tab"], [role="tablist"]')) continue;
      for (const [key, re] of SECTIONS) {
        if (re.test(t) && visible(el)) { out.push({ el, key, text: t }); break; }
      }
    }
    // 左侧“简历目录”之类固定悬浮的目录：同名标题在正文里也有时，丢掉目录里的那个
    const pinned = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const ps = getComputedStyle(a).position; if (ps === 'fixed' || ps === 'sticky') return true; if (/catalog|directory|mulu|(^|[\s_-])toc([\s_-]|$)|outline/i.test(a.className || '')) return true; } return false; };
    const fixed = new Set(out.filter((h) => pinned(h.el)));
    HEADERS = out.filter((h) => !fixed.has(h) || !out.some((o) => !fixed.has(o) && o.key === h.key && o.text.replace(/\W/g, '') === h.text.replace(/\W/g, '')));
  }
  function sectionOf(el) {
    let cur = 'basic';
    for (const h of HEADERS) {
      if (h.el === el || h.el.contains(el)) continue;
      if (h.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) cur = h.key; else break;
    }
    return cur;
  }

  // ---------------------------------------------------------------- 标签识别
  const CUSTOM_SELECT = '.phoenix-select, .ant-select, .el-select, .ivu-select, .el-cascader, .ant-cascader-picker, [role="combobox"], .layui-form-select';
  const DATE_WRAP = '.phoenix-date-picker, .phoenix-calendar-picker, .ant-calendar-picker, .ant-picker, .el-date-editor, .ivu-date-picker';
  // 找控件所在的“表单项”容器（先找常见组件库的标准类名，再找名字里带 form-item 的外层容器）
  function itemOf(ctrl) {
    const anc = [...ancestors(ctrl)];
    const cn = (a) => (typeof a.className === 'string' ? a.className : '');
    return ctrl.closest('.form-item, .ant-form-item, .el-form-item, .ivu-form-item, .van-field, .layui-form-item')
      || anc.find((a) => /(^|\s)[\w-]*(form-?item|formItem|field-item)(\s|$)/i.test(cn(a)) && !/__|-(control|content|wrapper|label)/.test(cn(a)))
      // 带哈希后缀的类名（Moka：sd-FormItem-container-xxxx）
      || anc.slice(0, 6).find((a) => /(^|\s)[\w-]*(form-?item|formItem|field-?item)-[\w-]*/i.test(cn(a)) && !/(form-?item|field-?item)[\w-]*-(control|content|wrapper|label|title|text|value|body|input|tip|error|extra|help)/i.test(cn(a)));
  }
  function* ancestors(el) { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) yield a; }
  function labelOf(ctrl, isGroup) {
    if (isGroup) {
      // 单选组：组里第一段不属于选项的文字，例如 <div><span>性别</span><label><input>男</label>…</div>
      for (const n of ctrl.childNodes) {
        if (n.nodeType === 1 && (n.matches('input, label, .phoenix-radio, .ant-radio-wrapper, .el-radio, .ivu-radio-wrapper, [role="radio"], [class*="radio"]') || n.querySelector('input, [class*="radio"]'))) break;
        const t = clean(n.textContent);
        if (t && t.length <= 20) return t;
      }
    }
    if (ctrl.id) {
      try { const l = document.querySelector('label[for="' + CSS.escape(ctrl.id) + '"]'); if (l && clean(l.textContent)) return clean(l.textContent); } catch (e) { /* ignore */ }
    }
    // <label>紧急联系人姓名<input></label>：输入框包在 label 里，取 label 自己的文字
    const wrap = !isGroup && ctrl.matches && ctrl.matches('input:not([type=radio]):not([type=checkbox]), select, textarea') && ctrl.closest('label');
    if (wrap) {
      const own = clean([...wrap.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.matches('input, select, textarea') && !n.querySelector('input, select, textarea'))).map((n) => n.textContent).join(''));
      if (own && own.length <= 40) return own;
    }
    // 常见表单库的 item 结构
    const item = itemOf(ctrl);
    if (item) {
      // 包着单选框 / 复选框的 label 是选项（“男”“女”），不是字段名
      const l = [...item.querySelectorAll('.form-item__text, .ant-form-item-label label, .ant-form-item-label, .el-form-item__label, .ivu-form-item-label, label, [class*="FormItem-label"], [class*="form-item-label"], [class*="formItem-label"]')]
        .find((x) => !x.contains(ctrl) && !(ctrl.contains && ctrl.contains(x)) && !x.querySelector('input, select, textarea'));
      if (l && clean(l.textContent) && clean(l.textContent).length <= 40) return clean(l.textContent);
    }
    const HAS_CTRL = 'input,select,textarea,' + CUSTOM_SELECT;
    const hasCtrl = (n) => n.matches(HAS_CTRL) || !!n.querySelector(HAS_CTRL);
    // 表格布局 1：左边单元格是标签（“姓名 | [输入框] | 性别 | [输入框]”）
    const td = ctrl.closest('td');
    if (td) {
      const prev = td.previousElementSibling;
      if (prev && !hasCtrl(prev)) { const t = clean(prev.textContent); if (t && t.length <= 30) return t; }
      // 表格布局 2：表头在上面（家庭成员表：“关系 | 姓名 | 工作单位 …”）
      const table = td.closest('table');
      const col = [...td.parentElement.children].indexOf(td);
      const headRow = table && (table.querySelector('thead tr') || [...table.querySelectorAll('tr')].find((r) => !hasCtrl(r)));
      if (headRow && headRow !== td.parentElement && headRow.children[col]) { const t = clean(headRow.children[col].textContent); if (t && t.length <= 30) return t; }
    }
    // 向上找前面的兄弟文本
    let node = ctrl;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (hasCtrl(sib)) break;
        // 用看得见的文字：编辑器工具栏里藏着“无序列表”这类提示字
        const t = clean(sib.innerText != null ? sib.innerText : sib.textContent);
        if (t && t.length <= 30) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    const ph = ctrl.getAttribute && (ctrl.getAttribute('aria-label') || ctrl.getAttribute('placeholder') || '');
    return clean(ph).replace(/^请(输入|选择|填写)/, '');
  }
  function isRequired(ctrl) {
    if (ctrl.matches && ctrl.matches('[required], [aria-required="true"], [lay-verify*="required"]')) return true;
    const item = itemOf(ctrl) || ctrl.closest('tr, li');
    if (!item) return false;
    const REQ = '.form-item__required, .ant-form-item-required, .is-required, .ivu-form-item-required, .required, [class*="required"], [class*="Required"], [lay-verify*="required"]';
    if (item.matches(REQ) || item.querySelector(REQ)) return true;
    const head = clean((item.querySelector('label, .el-form-item__label, td') || item).textContent).slice(0, 20);
    return /\*/.test((item.querySelector('label, td') || item).textContent.slice(0, 30)) || /必填/.test(head);
  }

  // ---------------------------------------------------------------- 字段字典
  // [板块, 标签正则, 取值函数(profile, 序号) ]
  // 项目描述拆分：页面同时有“职责”和“描述”两栏时，职责填【我的角色】【主要工作】，描述填【项目背景】【项目成果】【收获】
  let HAS_DUTY = false;
  function projPart(p, i, part) {
    const d = ((p.projects || [])[i] || {}).desc || '';
    if (!/【/.test(d)) return d;
    const sec = {}; d.split(/(?=【)/).forEach((x) => { const m = x.match(/^【([^】]+)】([\s\S]*)$/); if (m) sec[m[1]] = m[2].trim(); });
    const pick = (names) => names.filter((n) => sec[n]).map((n) => `【${n}】${sec[n]}`).join('\n');
    if (part === 'duty') return pick(['我的角色', '主要工作']) || d;
    return HAS_DUTY ? (pick(['项目背景', '项目成果', '收获']) || d) : d;
  }
  function durText(it) {
    if (!it || !it.start || !it.end) return '';
    const a = String(it.start).match(/(\d{4})\D(\d{1,2})/), b = String(it.end).match(/(\d{4})\D(\d{1,2})/);
    if (!a || !b) return '';
    const n = (+b[1] * 12 + +b[2]) - (+a[1] * 12 + +a[2]) + 1;
    const alts = [n + '个月'];
    if (n <= 1) alts.push('一个月以内', '1个月以内', '1个月以下', '一个月以下');
    if (n >= 1 && n <= 3) alts.push('一至三个月', '1-3个月', '1~3个月', '1至3个月', '3个月以内', '三个月以内');
    if (n > 3 && n <= 6) alts.push('三至六个月', '3-6个月', '3~6个月', '6个月以内');
    if (n > 6) alts.push('六个月以上', '6个月以上', '半年以上');
    return alts.join('|');
  }
  const B = (k) => (p) => p.basic[k];
  const E = (k) => Object.assign((p, i) => (p.education[i] || {})[k], { key: k });
  const L = (arr, k) => Object.assign((p, i) => ((p[arr] || [])[i] || {})[k], { key: k });
  // 最高学历 = 毕业时间最晚的那一条（教育经历可能按“从高到低”重新排过序）
  const topEdu = (p) => (p.education || []).reduce((a, e) => (!a || String(e.end || '') > String(a.end || '') ? e : a), null) || {};
  const cet4 = (p) => (p.languages || []).find((l) => /四级|CET-?\s?4/i.test(l.exam || '')) || null;
  const examList = (p) => [...new Set((p.languages || []).flatMap((l) => [l.exam, /雅思/.test(l.exam || '') ? 'IELTS' : '']).filter(Boolean))].join('|');
  // 起止时间放在一个表单项里（两个日期框共用一个标签）：按“开始/结束”拆给两个框
  const span = (arr) => (p, i) => { const it = ((arr === 'education' ? p.education : p[arr]) || [])[i]; return it && it.start && it.end ? `${it.start}/${it.end}` : ''; };
  const RANGE = /起止(时间|日期|年月)|(在校|就读|实习|工作|项目|任职|在职)(时间|期间|时段|起止)$|^时间(段|范围)?$/;
  // “是否有实习经历 / 是否取得证书”这类开关：按资料里有没有对应经历回答“是 / 否”
  const TOGGLE_RE = /^(是否|有无)(有|增加|添加|新增|填写|具有|具备|取得|获得|获取|持有|拥有|存在|参加|参与)?过?.{0,6}?(实习|项目|获奖|奖项|奖励|荣誉|证书|资格|校园|学生干部|社团|学生工作|社会实践|家庭成员|外语|语言|论文|科研成果|专利|学术成果)/;
  const NOT_LANG_CERT = (c) => !/雅思|IELTS|托福|TOEFL|四级|六级|CET|专四|专八|TEM/i.test((c && c.name) || '');
  function toggleVal(p, label) {
    const has = (arr) => (arr || []).length ? '是' : '否';
    if (/实习/.test(label)) return has(p.internships);
    if (/项目/.test(label)) return has(p.projects);
    if (/获奖|奖项|奖励|荣誉/.test(label)) return has(p.awards);
    if (/资格|职业|执业/.test(label)) return has((p.certificates || []).filter(NOT_LANG_CERT));
    if (/证书/.test(label)) return has(p.certificates);
    if (/校园|学生干部|社团|学生工作|社会实践/.test(label)) return has(p.campus);
    if (/家庭/.test(label)) return has(p.family);
    if (/外语|语言/.test(label)) return has(p.languages);
    if (/论文|科研|专利|学术/.test(label)) return '否';
    return '';
  }
  // 学制：按起止年份算（2021-09 到 2025-06 → 4 年）
  function schoolYears(e) {
    if (!e || !e.start || !e.end) return '';
    const [sy, sm] = e.start.split(/\D/).map(Number), [ey, em] = e.end.split(/\D/).map(Number);
    const n = Math.max(1, Math.round(((ey - sy) * 12 + (em - sm)) / 12));
    const cn = '零一两三四五六七八'[n] || String(n);
    return `${cn}年制|${n}年制|${n}年|${cn}年`;
  }
  // 奖项类别 / 等级：从奖项名称推断（奖学金 / 竞赛 / 其他；一等 / 二等 / 三等）
  function awardCat(a) {
    if (!a) return '';
    if (/奖学金/.test(a.name)) return '奖学金|学业奖学金|奖励';
    if (/竞赛|大赛|比赛|挑战杯|设计赛/.test(a.name)) return '竞赛类|竞赛|学科竞赛|比赛|竞赛获奖';
    return '其它类|其他类|荣誉称号|荣誉|其它|其他';
  }
  function awardGrade(a) {
    if (!a) return '';
    const g = (a.name.match(/([一二三特])等/) || [])[1];
    return g ? `${g}等|${g}等奖|${a.level || ''}` : `${a.level || ''}|其它|其他`;
  }
  const FIELDS = [
    // ---- 基本信息
    ['basic', /^(姓名|真实姓名|中文姓名|中文名)$/, B('name')],
    ['basic', /^性别$/, B('gender')],
    ['basic', /出生(日期|年月)|^生日$/, B('birth')],
    ['basic', /^民族$/, B('nation')],
    ['basic', /婚(姻|否|育)/, B('marital')],
    ['basic', /政治面貌/, B('political')],
    ['basic', /籍贯/, B('nativePlace')],
    ['basic', /户口性质|户籍性质/, B('hukouType')],
    ['basic', /户口(所在地|所在城市)?$|户籍(所在地)?$|入学前户口/, B('hukou')],
    ['basic', /生源地/, B('sourceProvince')],
    ['basic', /^身高/, B('height')],
    ['basic', /^体重/, B('weight')],
    ['basic', /(紧急|应急)联系人?(电话|方式|手机)/, B('emergencyPhone')],
    ['basic', /(紧急|应急)(情况)?时?联系人(姓名)?$/, B('emergencyName')],
    ['basic', /(紧急|应急)联系人.*关系/, B('emergencyRelation')],
    ['basic', /手机|移动电话|联系电话|^电话$/, B('phone')],
    ['basic', /微信/, B('phone')],
    ['basic', /邮箱|e-?mail/i, B('email')],
    ['basic', /入党|入团|党团/, B('partyDate')],
    ['basic', /通讯地址|通信地址|联系地址|现住址|家庭住址|家庭地址|现居住地址|详细地址|^地址$/, B('address')],
    ['basic', /现居住(城市|地)$|所在城市|现居地/, B('city')],
    ['basic', /健康状况/, B('health')],
    ['basic', /病史/, B('medicalHistory')],
    ['basic', /^是否.*应届/, () => '是'],
    ['basic', /应届|往届|申请者类别|毕业生类别/, B('graduateType')],
    ['basic', /期望(工作)?(地点|城市)|意向(工作)?(地点|城市)/, B('expectedCity')],
    ['basic', /期望(年)?薪/, B('expectedSalary')],
    ['basic', /到岗|入职时间/, B('availableDate')],
    ['basic', /外派.*(时长|时间|年限)/, (p) => p.declarations.overseasDuration],
    ['basic', /调剂|服从(公司)?(分配|安排)|还?愿意加入|其他(机构|部门|岗位)/, B('acceptAdjust')],
    ['basic', /爱好|特长/, B('hobbies')],
    ['basic', /自我(评价|介绍|描述)|个人(简介|评价|陈述)/, (p) => p.texts.selfIntro],
    ['basic', /应聘(原因|理由)|求职动机|为什么选择/, (p) => p.texts.applyReason],
    ['basic', /(信息|招聘)(来源|渠道)|获取渠道|获知渠道|^渠道|从哪里(了解|得知|获取)|何种途径|什么途径|了解到/, B('source')],
    ['basic', /^其他途径$/, () => ''],
    ['basic', /英语(等级|水平)$/, examList],
    ['basic', /英语.*(成绩|分数)/, (p) => (p.languages[0] || {}).score],
    ['basic', /^(最高学历)?毕业(学校|院校)$/, (p) => topEdu(p).school],
    ['basic', /专业排名|成绩排名|^排名$/, (p) => topEdu(p).rank],
    ['basic', /^(最高学历)?毕业(时间|日期)/, (p) => topEdu(p).end],
    ['basic', /退役军人|现役军人|军人/, () => '否'],
    ['basic', /挂科/, () => '无挂科|无|否'],
    ['basic', /^(培养方式|是否全日制|学习方式)$/, () => '全日制|是'],
    ['basic', /最高学历.*专业(名称)?$/, (p) => topEdu(p).major],
    ['basic', /最高学历.*学科/, (p) => topEdu(p).discipline],
    ['basic', /^(在读|当前|目前)学历$/, (p) => topEdu(p).level],
    ['basic', /^本科(毕业)?(学校|院校)$/, (p) => (p.education.find((e) => e.level === '本科') || {}).school],
    ['basic', /^本科.*专业/, (p) => (p.education.find((e) => e.level === '本科') || {}).major],
    ['basic', /^本科.*学科/, (p) => (p.education.find((e) => e.level === '本科') || {}).discipline],
    ['basic', /^(所学)?专业(名称)?$/, (p) => topEdu(p).major],
    ['basic', /^(最高)?学历$/, (p) => topEdu(p).level],
    ['basic', /^(最高)?学位$/, (p) => topEdu(p).degree],
    ['basic', /证件类型/, () => '身份证|居民身份证'],
    ['basic', /面试(地点|城市|站点)/, () => '青岛|*'],
    ['basic', /^评价(内容)?$/, (p) => p.texts.selfIntro],
    // 身份证 / 证件号：不设规则，留给用户本人填写（见 isSensitive）
    ['basic', /亲属.*(本|在).*(公司|集团|系统|单位)|亲属受雇/, (p) => p.declarations.relativesInCompany],
    ['basic', /违法|违纪|不良|犯罪|处分/, (p) => p.declarations.badRecord],
    ['basic', /竞业|服务期/, (p) => p.declarations.nonCompete],
    ['basic', /持股|经商|兼职/, (p) => p.declarations.sideBusiness],
    // “国籍”本身是问哪国人；只有“是否有外国国籍 / 双重国籍 / 永久居留权”才答“否”
    ['basic', /(外国|双重|其他|境外|他国|海外)国籍|是否.{0,8}国籍|国籍.{0,4}(是否|变更)|永久居留|绿卡/, (p) => p.declarations.foreignNationality],
    ['basic', /^(国籍|国籍\/地区|国籍（地区）|国家\/地区|国家或地区)$/, () => '中国|中国大陆|中华人民共和国'],
    ['basic', /外派|海外/, (p) => p.declarations.acceptOverseas],
    // ---- 教育经历
    ['edu', RANGE, Object.assign(span('education'), { key: 'range' })],
    ['edu', /是否.*最高学历|^最高学历$/, (p, i) => (p.education[i] && p.education[i] === topEdu(p) ? '是' : '否')],
    ['edu', /学制/, (p, i) => schoolYears(p.education[i])],
    ['edu', /受教育类型|教育类型/, (p, i) => ((p.education[i] || {}).overseas === '是' ? '海外留学|全日制' : '全日制统招|全日制|统招')],
    ['edu', /学院|院系|系别|所在系/, E('college')],
    ['edu', /导师/, E('advisor')],
    ['edu', /研究方向|课题|论文题目|毕业设计|毕业论文/, E('research')],
    ['edu', /是否全日制/, () => '是'],
    ['edu', /教育经历类别/, () => '国内教育经历/海外留学经历'],
    ['edu', /辅修|双学位/, () => '否|无'],
    ['edu', /平均分|均分/, E('avgScore')],
    ['edu', /专业描述|专业介绍/, E('courses')],
    ['edu', /城市|所在地|所在省/, E('schoolCity')],
    ['edu', /学校|院校/, E('school')],
    ['edu', /^专业(名称)?$|所学专业/, E('major')],
    ['edu', /^(开始|入学)(时间|日期)?$/, E('start')],
    ['edu', /^(结束|毕业)(时间|日期)?$/, E('end')],
    ['edu', /^学历(层次)?$/, E('level')],
    ['edu', /^学位$/, E('degree')],
    ['edu', /学科|门类/, E('discipline')],
    ['edu', /学习形式|学历形式|学习方式|就读方式/, E('studyForm')],
    ['edu', /培养方式/, E('training')],
    ['edu', /排名/, E('rank')],
    ['edu', /统招/, E('unified')],
    ['edu', /海外|留学/, E('overseas')],
    ['edu', /国家|地区/, E('country')],
    ['edu', /绩点|gpa/i, E('gpa')],
    ['edu', /课程/, E('courses')],
    // ---- 实习/工作
    ['intern', RANGE, Object.assign(span('internships'), { key: 'range' })],
    ['intern', /创业经历/, () => '否'],
    ['intern', /创业/, () => ''],
    ['intern', /时长|持续时间/, Object.assign((p, i) => durText((p.internships || [])[i]), { key: 'duration' })],
    ['intern', /证明人|推荐人|联系人/, () => ''],
    ['intern', /^(工作|实习)?性质$/, () => '实习|*'],
    ['intern', /(企业|单位|公司)性质/, L('internships', 'companyType')],
    ['intern', /规模|人数/, L('internships', 'companySize')],
    ['intern', /单位|公司|企业/, L('internships', 'company')],
    ['intern', /部门/, L('internships', 'dept')],
    ['intern', /职位|岗位|角色|职务/, L('internships', 'title')],
    ['intern', /^(开始|入职)(时间|日期)?$/, L('internships', 'start')],
    ['intern', /^(结束|离职)(时间|日期)?$/, L('internships', 'end')],
    ['intern', /内容|描述|职责|业绩/, L('internships', 'desc')],
    ['intern', /离职原因/, L('internships', 'leaveReason')],
    // ---- 项目
    ['project', RANGE, Object.assign(span('projects'), { key: 'range' })],
    ['project', /项目(经历)?名称|^名称$/, L('projects', 'name')],
    ['project', /角色|职务|职位|担任/, L('projects', 'role')],
    ['project', /所属(公司|单位|机构)/, L('projects', 'org')],
    ['project', /^开始(时间|日期)?$/, L('projects', 'start')],
    ['project', /^结束(时间|日期)?$/, L('projects', 'end')],
    ['project', /有无论文|论文或成果/, () => '否|无'],
    ['project', /^如有|期刊|影响因子|论文(作者|名称|详情)|发表(时间|日期)/, () => ''],
    ['project', /职责|负责|担任工作/, Object.assign((p, i) => projPart(p, i, 'duty'), { key: 'duty' })],
    ['project', /描述|内容|简介|介绍|业绩/, Object.assign((p, i) => projPart(p, i, 'desc'), { key: 'desc' })],
    // ---- 校园
    ['campus', RANGE, Object.assign(span('campus'), { key: 'range' })],
    ['campus', /奖励(类型|级别)/, L('awards', 'level')],
    ['campus', /奖励(取得|获得)?(时间|日期)/, L('awards', 'date')],
    ['campus', /奖励(内容|名称)/, Object.assign((p, i) => { const a = (p.awards || [])[i]; return a ? a.name + '：' + (a.desc || '') : ''; }, { key: 'award' })],
    ['campus', /支教/, (p, i) => (i === 0 ? '否|无' : '')],
    ['campus', /级别|等级/, L('campus', 'level')],
    ['campus', /描述|内容|职责|说明|经历$/, L('campus', 'desc')],
    ['campus', /^开始(时间|日期)?$/, L('campus', 'start')],
    ['campus', /^结束(时间|日期)?$/, L('campus', 'end')],
    ['campus', /职务|职位|角色|担任/, L('campus', 'title')],
    ['campus', /组织|社团|单位|名称/, L('campus', 'org')],
    // ---- 获奖
    ['award', /类别|类型|种类/, (p, i) => awardCat((p.awards || [])[i])],
    ['award', /^(奖励|获奖|奖项)?等级$/, (p, i) => awardGrade((p.awards || [])[i])],
    ['award', /级别|等级/, L('awards', 'level')],
    ['award', /时间|日期/, L('awards', 'date')],
    ['award', /描述|说明/, L('awards', 'desc')],
    ['award', /奖项|名称|荣誉|奖励/, L('awards', 'name')],
    // ---- 家庭
    ['family', /关系|称谓/, L('family', 'relation')],
    ['family', /姓名/, L('family', 'name')],
    ['family', /政治面貌/, L('family', 'political')],
    ['family', /^是否.*(工作|任职|从业|亲属)/, () => '否'],
    ['family', /单位.*职务|工作单位及职务/, (p, i) => { const f = (p.family || [])[i] || {}; return f.work ? f.work + ' ' + (f.position || '') : ''; }],
    ['family', /单位/, L('family', 'work')],
    ['family', /职务|职位/, L('family', 'position')],
    ['family', /电话|手机|联系方式/, L('family', 'phone')],
    ['family', /住址|地址/, (p) => p.basic.address],
    ['family', /年龄/, L('family', 'age')],
    ['family', /公司|职业/, (p, i) => { const f = (p.family || [])[i] || {}; return f.work ? f.work + ' ' + (f.position || '') : ''; }],
    ['family', /现状|状态/, () => '在职|*'],
    // ---- 语言
    ['lang', /英语(等级|水平)|外语(等级|水平)|英语考试/, (p, i) => { const l = p.languages[i] || {}; return l.exam ? [l.exam, /雅思/.test(l.exam) ? 'IELTS' : '', '*'].filter(Boolean).join('|') : ''; }],
    ['lang', /(英语|外语).*(成绩|分数|得分)/, L('languages', 'score')],
    ['lang', /专业资格|资格证书|IT技能|计算机/, () => ''],
    ['lang', /语言|语种|类型/, L('languages', 'language')],
    ['lang', /掌握程度|熟练程度|水平/, L('languages', 'level')],
    ['lang', /其他外语/, () => ''],
    ['lang', /准考证|成绩单(编)?号|证书编号|TRF/i, (p) => (p.languages[0] || {}).number || (p.certificates[0] || {}).number],
    ['lang', /考试(时间|日期)/, L('languages', 'date')],
    ['lang', /雅思|IELTS/i, (p) => /雅思|ielts/i.test((p.languages[0] || {}).exam || '') ? (p.languages[0] || {}).score : ''],
    ['lang', /托福|TOEFL|Daf|DSH|GRE|GMAT/i, () => ''],
    ['lang', /成绩|分数/, L('languages', 'score')],
    ['lang', /等级|证书/, L('languages', 'exam')],
    // ---- 证书
    ['cert', /证书名称|^名称$/, L('certificates', 'name')],
    ['cert', /获得|取得|颁发时间|^时间$/, L('certificates', 'date')],
    ['cert', /到期|有效期/, L('certificates', 'expire')],
    ['cert', /证书号|编号/, L('certificates', 'number')],
    ['cert', /签发|颁发|机构/, L('certificates', 'org')],
  ];
  // 自定义问答：标签里包含“题目”文字就填“答案”（用户在设置页自己加，优先级最高）
  function customLookup(profile, label) {
    const t = norm(label);
    if (!t) return null;
    const list = Array.isArray(profile.custom) ? profile.custom : [];
    const hit = list.find((x) => x && x.q && norm(x.q).length >= 2 && t.includes(norm(x.q)) && x.a !== undefined && x.a !== '');
    // 答案里可以写 {phone} 这类占位，填写时换成资料“基本信息”里的对应字段（例：微信号 → {phone}）
    const ans = () => String(hit.a).replace(/\{(\w+)\}/g, (m, k) => ((profile.basic || {})[k] !== undefined && !ID_KEY.test(k) ? profile.basic[k] : m));
    return hit ? ['custom', new RegExp('custom:' + norm(hit.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ans] : null;
  }
  // 这些字段不管出现在哪个板块下面都可以填（例如页面最后的“自我评价”“声明”）
  const GLOBAL = /自我|应聘(原因|理由)|求职动机|爱好|特长|来源|渠道|期望|到岗|入职时间|调剂|服从|亲属|违法|违纪|不良|犯罪|处分|竞业|服务期|持股|经商|兼职|国籍|永久居留|外派|健康|病史|微信/;
  // 问答题：不管出现在哪个板块都按这几条填
  const ALWAYS = [
    [/(奖励|获奖|奖惩)(情况)?(说明|描述|介绍|概述)|^(奖励|获奖)情况$/, (p) => p.texts.awardsSummary],
    [/对(公司|企业|单位|我们|本公司|集团).{0,4}(期待|期望)|^(期待|期望)$|你的期待/, (p) => p.texts.companyExpectation],
    [/编程语言|计算机语言/, () => '否|无|不掌握'],
    [/交换生|交流生|交换(经历|项目)/, () => '否|无'],
    [/CPA|CFA|FRM|司法考试|法律职业资格/i, () => '无|未通过|否|0|0科|未参加'],
    [/^考试类型$/, (p, i) => { const l = (p.languages || [])[i] || {}; return l.exam ? [l.exam, /雅思/.test(l.exam) ? 'IELTS' : '', '英语'].filter(Boolean).join('|') : ''; }],
    [/^(得分|分数|成绩)$/, (p, i) => ((p.languages || [])[i] || {}).score],
    // 四级 / 六级：分开问的时候各答各的（没考六级就留空，交给用户）
    [/^是否(通过|获得|取得|参加).{0,6}(四级|CET-?\s?4)/i, (p) => (cet4(p) ? '是' : '')],
    [/^(?!.*(六级|CET-?\s?6|等级|类型|种类|编号|证号|准考|时间|日期)).*(四级|CET-?\s?4)/i, (p) => { const c = cet4(p); return c ? `${c.score}|已通过|通过|是|有` : ''; }],
    [/^(?!.*(四级|CET-?\s?4|等级|类型|种类|编号|证号|准考|时间|日期)).*(六级|CET-?\s?6)/i, () => ''],
    [TOGGLE_RE, (p, i, label) => toggleVal(p, label)],
  ].map(([re, fn]) => ['basic', re, fn]);
  function lookup(section, label) {
    const t = clean(label).replace(/^\d+\s*[.、．]\s*/, '');
    if (!t) return null;
    for (const f of ALWAYS) if (f[1].test(t)) return f;
    if (section === 'edu' && /^(最高|第一学历|本科(学校|院校|专业|学科)|最高学历)/.test(t)) for (const f of FIELDS) if (f[0] === 'basic' && f[1].test(t)) return f;
    for (const f of FIELDS) if (f[0] === section && f[1].test(t)) return f;
    const t2 = t.replace(/[（(][^）)]*[）)]/g, '').trim();
    if (t2 && t2 !== t) for (const f of FIELDS) if (f[0] === section && f[1].test(t2)) return f;
    if (section !== 'basic' && GLOBAL.test(t)) for (const f of FIELDS) if (f[0] === 'basic' && f[1].test(t)) return f;
    return null;
  }

  // ---------------------------------------------------------------- 写值工具
  function setNative(el, val) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus && el.focus();
    desc.set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  // 模拟鼠标：带坐标，并补上 pointer 事件（有的组件只认 pointerdown / mousedown）
  const fire = (el, type) => {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: /down/.test(type) ? 1 : 0 };
    const isPtr = type.startsWith('pointer') && typeof PointerEvent === 'function';
    el.dispatchEvent(isPtr ? new PointerEvent(type, { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(type, o));
  };
  const press = (el) => { if (!el) return; fire(el, 'pointerdown'); fire(el, 'mousedown'); fire(el, 'pointerup'); fire(el, 'mouseup'); el.click(); };
  function fmtDate(v, el) {
    if (!v) return v;
    const m = String(v).match(/(\d{4})\D?(\d{1,2})(?:\D?(\d{1,2}))?/); if (!m) return v;
    const y = m[1], mo = m[2].padStart(2, '0'), d = (m[3] || '01').padStart(2, '0');
    const hint = ((el && (el.placeholder || '')) + ' ' + ((el && el.closest(DATE_WRAP) && el.closest(DATE_WRAP).className) || '')).toLowerCase();
    const sep = /yyyy\.mm|\d{4}\.\d/.test(hint) ? '.' : /yyyy\/mm/.test(hint) ? '/' : '-';
    if (/yyyy.mm.dd|日期|dd|--date\b|日$/.test(hint) && !/month|年月/.test(hint)) return [y, mo, d].join(sep);
    if (/yyyy.mm|年月|month/.test(hint)) return [y, mo].join(sep);
    return m[3] ? [y, mo, d].join(sep) : [y, mo].join(sep);
  }

  const OPTION_SEL = 'li.phoenix-selectList__listItem, .ant-select-dropdown-menu-item, .ant-select-item-option, .el-select-dropdown__item, .ivu-select-item, .el-cascader-node, .ant-cascader-menu-item, [role="option"], .select-option, .dropdown-item, [class*="sd-Tag-text"], [class*="sd-Menu-item"], [class*="sd-Menu-option"]';
  // Moka 新版（sd- 组件）：选项在 [class*="sd-Menu-container"] 里，取里面带文字的最里层元素
  function menuLeaves() {
    const out = [];
    for (const m of document.querySelectorAll('[class*="sd-Menu-container"]')) {
      if (!visible(m)) continue;
      for (const e of m.querySelectorAll('*')) {
        const t = clean(e.textContent);
        if (!t || t.length > 40 || !visible(e) || e.querySelector('input, textarea')) continue;
        if ([...e.children].some((ch) => clean(ch.textContent) === t)) continue; // 文字全在某个子元素里：用子元素
        out.push(e);
      }
    }
    return out;
  }
  function visibleOptions() { return [...document.querySelectorAll(OPTION_SEL)].filter(visible).concat(menuLeaves()); }
  function closeDropdowns() { const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body; keyEvt(t, 'Escape', 27); }

  function keyEvt(el, key, code) {
    const ev = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
    // 老版本组件读 keyCode / which；构造函数不支持这两个字段，只能这样补上
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
    el.dispatchEvent(ev);
    const up = new KeyboardEvent('keyup', { key, code: key, bubbles: true });
    Object.defineProperty(up, 'keyCode', { get: () => code });
    el.dispatchEvent(up);
  }
  // ---------------------------------------------------------------- 下拉框
  // 值可以写成“首选|备选|备选|*”：按顺序找第一个存在的选项，* 表示都没有时选第一个选项
  const altsOf = (val) => String(val).split('|').map((s) => s.trim()).filter(Boolean);
  // 只有像“山东省/青岛市”这样的短路径才按“/”拆（课程、描述里的“项目/论文”不拆）
  const isPath = (a) => /^[^\s、，,。；;：:（）()]{1,14}(\/[^\s、，,。；;：:（）()]{1,14})+$/.test(String(a));
  const textValue = (val) => { const a = altsOf(val).filter((x) => x !== '*')[0] || ''; return isPath(a) ? a.split('/').pop() : a; };
  const OPT_GENERIC = 'li, dd, [role="option"], [class*="option"], [class*="Option"], [class*="item"], [class*="Item"]';
  const PLACEHOLDER_OPT = /^(请选择|请输入|全部|不限|--.*--|无数据|暂无数据|没有数据|搜索|not found|no data|加载中.*|loading.*)$/i;
  const BTN_SEL = 'button, a, span, [role="button"], [class*="btn"], [class*="Btn"], [class*="button"], [class*="Button"]';
  function snapshot() { return { opts: new Set([...document.querySelectorAll(OPT_GENERIC)].filter(visible)), inputs: new Set([...document.querySelectorAll('input, textarea')].filter(visible)), btns: new Set([...document.querySelectorAll(BTN_SEL)].filter(visible)) }; }
  // 弹出后新出现的按钮（按文字找，取最里层）
  function newButton(before, re) {
    const list = [...document.querySelectorAll(BTN_SEL)].filter((b) => visible(b) && !before.btns.has(b) && re.test(clean(b.textContent || b.value)));
    return list.find((b) => !list.some((o) => o !== b && b.contains(o))) || null;
  }
  function currentOptions(wrap, before) {
    const known = visibleOptions().filter((o) => !wrap.contains(o) && !/disabled/.test(clsOf(o)) && !PLACEHOLDER_OPT.test(clean(o.textContent)));
    const gen = [...document.querySelectorAll(OPT_GENERIC)].filter((e) => {
      if (!visible(e) || before.opts.has(e) || wrap.contains(e) || e.querySelector('input, textarea, select')) return false;
      const t = clean(e.textContent);
      return t && t.length <= 40 && !PLACEHOLDER_OPT.test(t);
    });
    // 只留最里层的（避免整个列表容器被当成一个选项）
    const all = [...new Set([...known, ...gen])];
    return all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
  }
  async function pickFrom(list, want, anchor, minScore = 35) {
    const ar = anchor.getBoundingClientRect();
    let best = null, bs = 0;
    for (const o of list) {
      const s = matchScore(o.textContent, want);
      if (!s) continue;
      const score = s - Math.abs(o.getBoundingClientRect().top - ar.bottom) / 1000;
      if (score > bs) { bs = score; best = o; }
    }
    if (!best || bs < minScore) return false;
    const txt = clean(best.textContent) || want;
    press(best); await sleep(300);
    return txt; // 返回选中的文字，方便事后核对
  }
  async function pickOption(anchor, want) { return pickFrom(visibleOptions(), want, anchor); }
  async function confirmIfModal(before) {
    const ok = newButton(before, /^确\s*(定|认)$/);
    if (ok) { press(ok); await sleep(300); }
  }
  // 联想里查不到时，点“添加专业全称”之类的入口，在弹出的输入框里填名称，再点“添加 / 确定”
  function addEntryBtn(before) {
    const list = [...document.querySelectorAll(OPT_GENERIC + ', ' + BTN_SEL)].filter((b) => visible(b) && !before.btns.has(b) && /^[+＋]?\s*(添加|新增|手动(添加|输入|填写))/.test(clean(b.textContent)) && clean(b.textContent).length <= 16);
    return list.find((b) => !list.some((o) => o !== b && b.contains(o))) || null;
  }
  async function addCustomEntry(btn, text) {
    const before = snapshot();
    press(btn); await sleep(400);
    let inp = null;
    for (let t = 0; t < 1500 && !inp; t += 150) { inp = [...document.querySelectorAll('input, textarea')].find((i) => visible(i) && !before.inputs.has(i) && !i.readOnly && !i.disabled && !/radio|checkbox|file|hidden/.test(i.type)); if (!inp) await sleep(150); }
    if (!inp) return false;
    setNative(inp, text); await sleep(200);
    const ok = newButton(before, /^(添\s*加|确\s*(定|认)|保\s*存|提\s*交)$/);
    if (!ok) return false;
    press(ok); await sleep(500);
    return true;
  }
  // 选完后确认真的选上了：输入框或它所在的组件里出现了选中的文字
  function shows(wrap, text) {
    const t = norm(text); if (!t) return false;
    const inp = wrap.tagName === 'INPUT' ? wrap : wrap.querySelector('input:not([type=hidden])');
    if (inp && inp.value && (norm(inp.value).includes(t) || t.includes(norm(inp.value)))) return true;
    let host = wrap;
    for (let i = 0; i < 3 && host.parentElement && host.parentElement.querySelectorAll('input, textarea, select').length <= 1; i++) host = host.parentElement;
    return norm(host.textContent).includes(t);
  }
  // o.probe：点开后没有任何选项就返回 'nopopup'（看起来像下拉的只读输入框，其实不是）
  // o.verify：选完再确认组件里真的显示了选中的文字，没显示就算失败（避免“标绿但没选上”）
  async function fillCustomSelect(wrap, val, label, alreadyOpen, o = {}) {
    const alts = altsOf(val);
    const anyOk = alts.includes('*');
    const wants = alts.filter((a) => a !== '*');
    const trigger = wrap.querySelector('.ant-select-selection, .ant-select-selector, .el-input__inner, .el-input, .ivu-select-selection, .phoenix-select__content') || wrap;
    const before = snapshot();
    if (!alreadyOpen) { if (trigger.tagName === 'INPUT') { trigger.focus(); trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } press(trigger); await sleep(300); }
    const opts = () => currentOptions(wrap, before);
    // 选项可能是打开后才从服务器加载的（例如面试地点、依赖上一个框的“市”），多等一会儿
    for (let t = 0; t < (o.probe ? 900 : 3000) && !opts().length; t += 150) await sleep(150);
    if (o.probe && !opts().length) { closeDropdowns(); return 'nopopup'; }
    const done = async (txt) => {
      await confirmIfModal(before);
      if (!o.verify) return true;
      await sleep(150);
      if (shows(wrap, txt)) return true;
      DIAG.push({ label: label || '', val: String(val), kind: 'verify', msg: '点了选项但组件里没有显示：' + txt, field: snip(wrap.parentElement || wrap, 600) });
      return false;
    };
    let got;
    for (const w of wants) {
      const parts = w.split('/').filter(Boolean);
      // 选项本身就叫这个名字（例如“民营/私营公司”）就直接选
      if ((got = await pickFrom(opts(), w, wrap, 90))) return done(got);
      // 级联（地区）：逐级选择
      if (parts.length > 1) {
        let ok = true;
        for (const p of parts) { if (!(got = await pickFrom(opts(), p, wrap))) { ok = false; break; } await sleep(350); }
        if (ok) { const r = await done(got); closeDropdowns(); return r; }
      }
      if ((got = await pickFrom(opts(), w, wrap))) return done(got);
    }
    // 可搜索的下拉：在搜索框里打字再选
    const okInput = (i) => visible(i) && !i.readOnly && !i.disabled && i.type !== 'checkbox' && i.type !== 'radio';
    const search = [...document.querySelectorAll('input')].find((i) => okInput(i) && !before.inputs.has(i) && !wrap.contains(i))
      || (!wrap.matches('.phoenix-select') && [...wrap.querySelectorAll('input')].find(okInput))
      || (wrap.tagName === 'INPUT' && okInput(wrap) ? wrap : null);
    if (search) {
      for (const w of wants) {
        const key = w.split('/').pop().replace(/[省市区县]$/, '');
        setNative(search, key); await sleep(800);
        if ((got = await pickFrom(opts(), w.split('/').pop(), wrap))) return done(got);
      }
      // 学校 / 专业查不到：点“添加专业全称”，在弹框里填全称
      const add = /学校|院校|专业/.test(label || '') && addEntryBtn(before);
      if (add && wants[0]) { if (await addCustomEntry(add, textValue(wants[0]))) return done(textValue(wants[0])); }
      setNative(search, ''); await sleep(500);
    }
    // 北森地区选择弹层：单选框 + 确认
    for (const w of wants) {
      const last = w.split('/').pop();
      const radio = [...document.querySelectorAll('label, span')].find((x) => visible(x) && !x.closest('.form-item') && matchScore(x.textContent, last) >= 60 && x.querySelector && x.querySelector('input[type=radio],input[type=checkbox]'));
      if (radio) { press(radio); await sleep(300); return done(last); }
    }
    // 都没有：值里写了 * 就选第一个选项（例如岗位只有一个指定城市）
    if (anyOk) {
      const first = opts().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (first) { const txt = clean(first.textContent); press(first); await sleep(300); return done(txt); }
    }
    const pop = opts();
    DIAG.push({ label: label || '', val: String(val), kind: 'select', field: snip(wrap, 900), options: pop.slice(0, 12).map((o) => o.tagName + '.' + clsOf(o).slice(0, 60) + ' ' + clean(o.textContent).slice(0, 20)), popup: snip(pop[0] && (pop[0].closest('[class*="dropdown"], [class*="popup"], [class*="layer"], [class*="list"], ul') || pop[0].parentElement), 1500) });
    closeDropdowns();
    return false;
  }

  // ---------------------------------------------------------------- layui（海尔等自建系统）
  // layui 把原生 select / radio 藏起来，另画一套 div；只有点画出来的那套，layui 和页面的监听才会收到
  function layuiSync(el, type) {
    try {
      const L = window.layui; if (!L || !L.form) return false;
      const form = el.closest('.layui-form');
      L.form.render(type, (form && form.getAttribute('lay-filter')) || undefined);
      const f = el.getAttribute('lay-filter');
      const $ = L.$ || window.jQuery;
      if (f && typeof L.event === 'function') L.event.call(el, 'form', type + '(' + f + ')', { elem: el, value: el.value, othis: $ ? $(el.nextElementSibling) : el.nextElementSibling });
      return true;
    } catch (e) { return false; }
  }
  const laySelectOf = (wrap) => (wrap.previousElementSibling && wrap.previousElementSibling.tagName === 'SELECT' ? wrap.previousElementSibling : wrap.parentElement && wrap.parentElement.querySelector('select'));
  async function fillLaySelect(wrap, val) {
    const sel = laySelectOf(wrap);
    const tInput = wrap.querySelector('.layui-select-title input') || wrap.querySelector('input');
    const dds = [...wrap.querySelectorAll('dl dd')].filter((d) => !/layui-select-tips|layui-disabled|layui-hide/.test(clsOf(d)) && clean(d.textContent));
    let dd = null;
    for (const w of altsOf(val)) {
      if (w === '*') { dd = dds[0]; break; }
      let bs = 0, b = null;
      for (const d of dds) { const s = matchScore(d.textContent, w); if (s > bs) { bs = s; b = d; } }
      if (b && bs >= 35) { dd = b; break; }
    }
    if (!dd) return false;
    const want = dd.getAttribute('lay-value');
    const text = clean(dd.textContent);
    const titleInput = () => { const w = sel && sel.nextElementSibling && sel.nextElementSibling.matches('.layui-form-select') ? sel.nextElementSibling : wrap; return w.querySelector('.layui-select-title input'); };
    const ok = () => (!sel || want === null || sel.value === want) && (!titleInput() || clean(titleInput().value) === text);
    press(tInput || wrap); await sleep(200); // 点标题里的输入框展开（点标题本身会被 layui 当成点外面而收起）
    press(dd); await sleep(250);
    if (ok()) return true;
    if (sel && want !== null) { sel.value = want; sel.dispatchEvent(new Event('change', { bubbles: true })); layuiSync(sel, 'select'); await sleep(150); }
    return ok();
  }

  // ---------------------------------------------------------------- 文字框（带联想的要防止被换成相近的名字）
  const SUGGEST_LABEL = /学校|院校|专业|单位|公司|企业|职位|岗位|机构/;
  function suggestive(el, label) {
    if (el.tagName !== 'INPUT') return false;
    if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete') || el.hasAttribute('aria-owns')) return true;
    const cls = clsOf(el) + ' ' + clsOf(el.parentElement || el) + ' ' + clsOf((el.parentElement && el.parentElement.parentElement) || el);
    return /autocomplete|auto-complete|suggest|typeahead/i.test(cls) || SUGGEST_LABEL.test(label || '');
  }
  async function fillText(c, val) {
    const el = c.el, tv = textValue(val);
    if (!suggestive(el, c.label)) { setNative(el, tv); return el.value === tv || !!el.value; }
    const before = snapshot();
    setNative(el, tv);
    let list = [];
    for (let t = 0; t < 750 && !list.length; t += 150) { await sleep(150); list = currentOptions(el, before).filter((o) => distTo(el, o) < 500); }
    let picked = false;
    if (list.length) {
      // 联想里有一模一样的就点它；学校名可以是“全称（英文名）”这种
      const n = norm(tv);
      const exact = list.find((o) => norm(o.textContent) === n) || (/学校|院校/.test(c.label) && list.find((o) => norm(o.textContent).startsWith(n)));
      if (exact) { press(exact); picked = true; await sleep(300); }
      else {
        const add = /学校|院校|专业/.test(c.label) && addEntryBtn(before);
        if (add) { picked = await addCustomEntry(add, tv); }
        else { keyEvt(el, 'Escape', 27); await sleep(150); }
      }
    }
    if (document.activeElement === el) el.blur();
    await sleep(250);
    // 失焦后被组件换成了联想里相近的名字：改回来
    if (!picked && norm(el.value) !== norm(tv)) { setNative(el, tv); keyEvt(el, 'Escape', 27); if (document.activeElement === el) el.blur(); await sleep(400); }
    return picked ? (!!el.value || shows(el, tv)) : norm(el.value) === norm(tv);
  }

  // ---------------------------------------------------------------- 日期
  const PANEL_SEL = '.phoenix-date-picker, .phoenix-calendar, .ant-calendar, .ant-picker-dropdown, .el-picker-panel, .ivu-picker-panel-body, .layui-laydate, .laydate, [class*="calendar"], [class*="Calendar"], [class*="datepicker"], [class*="date-picker"], [class*="DatePicker"], [class*="picker-panel"], [class*="sd-panal"], [class*="sd-Picker"]';
  const DIAG = [];
  const snip = (el, n) => (el ? el.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/\s(style|d|viewBox)="[^"]*"/g, '').slice(0, n) : '');
  const clsOf = (e) => (e.getAttribute && e.getAttribute('class')) || '';
  function distTo(wrap, el) { const r = wrap.getBoundingClientRect(), q = el.getBoundingClientRect(); return Math.abs(q.top - r.bottom) + Math.abs(q.left - r.left) / 4; }
  let EXCL = new Set(); // 打开日历之前页面上就有的“日历样”元素，不算弹层
  const allPanels = () => [...document.querySelectorAll(PANEL_SEL)].filter(visible);
  function findPanel(wrap) {
    const list = [...document.querySelectorAll(PANEL_SEL)].filter((p) => visible(p) && !EXCL.has(p) && !p.contains(wrap) && !wrap.contains(p) && p.getBoundingClientRect().height > 60);
    const outer = list.filter((p) => !list.some((o) => o !== p && o.contains(p)));
    return outer.sort((a, b) => distTo(wrap, a) - distTo(wrap, b))[0] || null;
  }
  async function waitPanel(wrap, ms) { for (let t = 0; t < ms; t += 100) { const p = findPanel(wrap); if (p) return p; await sleep(100); } return null; }
  async function openPanel(wrap) {
    const tries = [wrap.matches(CUSTOM_SELECT) || wrap.matches(DATE_WRAP) ? wrap : null, wrap.querySelector('input:not([type=hidden])'), wrap.querySelector('.phoenix-select__content, [class*="selection"], [class*="trigger"], [class*="suffix"], [class*="arrow"], [class*="icon"]'), wrap];
    const seen = new Set();
    for (const t of tries) {
      if (!t || seen.has(t)) continue; seen.add(t);
      if (t.tagName === 'INPUT') { t.focus(); t.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); }
      press(t);
      for (let w = 0; w < 900; w += 100) {
        const p = findPanel(wrap); if (p) return p;
        if (wrap.matches(CUSTOM_SELECT) && visibleOptions().length) return null; // 打开的是普通选项列表，不是日历
        await sleep(100);
      }
    }
    return null;
  }
  const CN_M = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const EN_M = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function monthNum(t) {
    t = clean(t).toLowerCase();
    let m = t.match(/^(\d{1,2})\s*月$/); if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
    m = t.match(/^(.{1,2})月$/); if (m && CN_M.includes(m[1])) return CN_M.indexOf(m[1]) + 1;
    const i = EN_M.findIndex((e) => t === e || (t.startsWith(e) && t.length <= 9 && /^[a-z.]+$/.test(t)));
    return i >= 0 ? i + 1 : 0;
  }
  const leaves = (root) => [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && clean(e.textContent) && visible(e));
  const BAD_CELL = /disable|last-month|next-month|prev-month|old|new\b|other|outside|not-current|notcurrent|-out\b|gray|grey|laydate-day-(prev|next)/i;
  function monthCells(panel) {
    const map = new Map();
    for (const e of leaves(panel)) {
      const n = monthNum(e.textContent); if (!n || map.has(n)) continue;
      const cell = e.closest('td, [class*="cell"], [class*="month"], li, span, a') || e;
      if (/header|title|select/i.test(clsOf(cell)) && !/cell/i.test(clsOf(cell))) continue;
      map.set(n, e);
    }
    return map.size >= 12 ? map : new Map();
  }
  function yearOf(panel) {
    const c = leaves(panel).filter((e) => /^(19|20)\d{2}\s*年?$/.test(clean(e.textContent)));
    if (!c.length) return 0;
    // 优先：类名里带 year、或者在“月份面板”里的那个
    const pick = c.find((e) => /month-panel|year/i.test(clsOf(e) + ' ' + clsOf(e.parentElement || e))) || c.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    return parseInt(clean(pick.textContent), 10);
  }
  function headerMonth(panel) {
    const c = leaves(panel).filter((e) => monthNum(e.textContent) && !/cell/i.test(clsOf(e) + clsOf(e.parentElement || e)));
    return c.length ? monthNum(c[0].textContent) : 0;
  }
  const BTN_RE = {
    prevYear: [/prev-?year|year-?prev|super-prev|d-arrow-left|double-?left|arrow-double-left|prev-decade/i, ['«', '<<']],
    nextYear: [/next-?year|year-?next|super-next|d-arrow-right|double-?right|arrow-double-right|next-decade/i, ['»', '>>']],
    prevMonth: [/prev-?month|month-?prev|(^|[\s_-])prev([\s_-]|$)|arrow-left|icon-?left/i, ['‹', '<']],
    nextMonth: [/next-?month|month-?next|(^|[\s_-])next([\s_-]|$)|arrow-right|icon-?right/i, ['›', '>']],
  };
  function findBtn(panel, kind) {
    const [re, txt] = BTN_RE[kind];
    const all = [...panel.querySelectorAll('*')].filter(visible);
    const yearish = /year|super|double|d-arrow|decade|laydate-(prev|next)-y/i;
    return all.find((e) => { const c = clsOf(e); return re.test(c) && (kind.endsWith('Year') || !yearish.test(c)); }) || all.find((e) => e.children.length === 0 && txt.includes(clean(e.textContent))) || null;
  }
  function dayCell(panel, d) {
    const ok = (e) => {
      if (!/^\d{1,2}$/.test(clean(e.textContent))) return false;
      const cell = e.closest('td, [class*="cell"], [class*="day"], [class*="date"]');
      if (!cell) return false;
      return !BAD_CELL.test(clsOf(cell) + ' ' + clsOf(e) + ' ' + clsOf(e.parentElement || e));
    };
    const days = leaves(panel).filter(ok);
    // 没有类名区分上 / 下个月时：15 号以后从本月“1”号之后找
    const first = days.findIndex((e) => clean(e.textContent) === '1');
    const from = d >= 15 && first > 0 ? first : 0;
    return days.slice(from).find((e) => clean(e.textContent) === String(d)) || null;
  }
  // 表头是一整段“2026年10月 / 2026-10”的写法
  function ymHeader(panel) {
    for (const e of leaves(panel)) { const m = clean(e.textContent).match(/^((?:19|20)\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*月?$/); if (m && +m[2] >= 1 && +m[2] <= 12) return [+m[1], +m[2]]; }
    return null;
  }
  async function pickInPanel(wrap, y, mo, d, got) {
    let monthClicked = false;
    for (let step = 0; step < 420; step++) {
      const panel = findPanel(wrap); if (!panel) return got();
      const mcs = monthCells(panel);
      const ymh = ymHeader(panel);
      const yr = yearOf(panel) || (ymh ? ymh[0] : 0);
      if (yr && yr !== y) {
        const b = findBtn(panel, yr > y ? 'prevYear' : 'nextYear');
        if (b) { press(b); await sleep(90); continue; }
        // 只有“上个月 / 下个月”按钮（Moka）：一个月一个月翻
        if (!mcs.size) { const mb = findBtn(panel, yr > y ? 'prevMonth' : 'nextMonth'); if (mb) { press(mb); await sleep(40); continue; } }
        return false;
      }
      if (mcs.size) {
        if (monthClicked) return got();
        const cell = mcs.get(mo); monthClicked = true;
        press(cell.closest('td') || cell); await sleep(350);
        if (got()) return true;
        if (cell.isConnected && visible(cell)) { press(cell); await sleep(300); if (got()) return true; }
        continue; // 有的日期框选完月份后进入“选日”
      }
      const cur = headerMonth(panel) || (ymh ? ymh[1] : 0);
      if (cur && cur !== mo) {
        const b = findBtn(panel, cur > mo ? 'prevMonth' : 'nextMonth');
        if (b) { press(b); await sleep(90); continue; }
        return false;
      }
      const day = dayCell(panel, d || 1);
      if (!day) return false;
      press(day.closest('td') || day); await sleep(350);
      if (got()) return true;
      if (day.isConnected && visible(day)) { press(day); await sleep(300); }
      return got();
    }
    return got();
  }
  // layui laydate：表头“2026年 10月”，laydate-prev-y / prev-m 翻页，格子带 lay-ymd；年月型是月份列表
  async function fillLaydate(ctrl, y, mo, d, got) {
    const key = ctrl.getAttribute('lay-key');
    const panelOf = () => [document.getElementById('layui-laydate' + key), ...document.querySelectorAll('.layui-laydate')].find((p) => p && visible(p) && !p.closest('.layui-laydate-static'));
    ctrl.focus(); ctrl.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); press(ctrl);
    let p = null;
    for (let t = 0; t < 1200 && !(p = panelOf()); t += 100) await sleep(100);
    if (!p) return false;
    const confirm = async () => { if (got()) return true; const b = p.querySelector('.laydate-btns-confirm'); if (b && visible(b)) { press(b); await sleep(250); } return got(); };
    for (let k = 0; k < 300; k++) {
      p = panelOf(); if (!p) return got();
      const ys = p.querySelector('.laydate-set-ym span[lay-type="year"]') || p.querySelector('.laydate-set-ym span');
      const cy = parseInt(ys && ys.textContent, 10) || 0;
      const mlist = [...p.querySelectorAll('.laydate-month-list li')].filter(visible);
      if (cy && cy !== y && !mlist.length) { const b = p.querySelector(cy > y ? '.laydate-prev-y' : '.laydate-next-y'); if (!b) return false; press(b); await sleep(40); continue; }
      if (mlist.length) {
        // 年月型：先把年份调对（表头年份或列表上方的年份）
        if (cy && cy !== y) { const b = p.querySelector(cy > y ? '.laydate-prev-y' : '.laydate-next-y'); if (b && visible(b)) { press(b); await sleep(60); continue; } }
        const li = mlist.find((l) => +l.getAttribute('lay-ym') === mo - 1) || mlist[mo - 1];
        if (!li) return false;
        press(li); await sleep(250);
        return confirm();
      }
      const ms = p.querySelector('.laydate-set-ym span[lay-type="month"]');
      const cm = parseInt(ms && ms.textContent, 10) || 0;
      if (cm && cm !== mo) { const b = p.querySelector(cm > mo ? '.laydate-prev-m' : '.laydate-next-m'); if (!b) return false; press(b); await sleep(40); continue; }
      const td = p.querySelector(`td[lay-ymd="${y}-${mo}-${d || 1}"]`);
      if (!td) return false;
      press(td); await sleep(250);
      return confirm();
    }
    return got();
  }
  async function fillDate(ctrl, val, label) {
    const wrap = ctrl.closest(DATE_WRAP) || ctrl;
    const m = String(val).match(/(\d{4})\D?(\d{1,2})(?:\D?(\d{1,2}))?/);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 0;
    const valEl = ctrl.tagName === 'INPUT' ? ctrl : wrap.querySelector('input:not([type=hidden])');
    const mm = String(mo).padStart(2, '0');
    const got = () => {
      const v = ((valEl && valEl.value) || '') + ' ' + (valEl ? '' : clean(wrap.textContent));
      return [`${y}-${mm}`, `${y}.${mm}`, `${y}/${mm}`, `${y}年${mo}月`, `${y}年${mm}月`, `${y}-${mo}-`, `${y}/${mo}/`].some((x) => v.includes(x)) || new RegExp(`${y}\\D${mo}$`).test(v.trim());
    };
    // 0) layui laydate
    if (ctrl.tagName === 'INPUT' && ctrl.hasAttribute('lay-key')) {
      if (await fillLaydate(ctrl, y, mo, d, got)) return true;
      closeDropdowns(); await sleep(100);
    }
    // 1) 可以直接输入的日期框（element-ui、iView、普通 input）
    if (ctrl.tagName === 'INPUT' && !ctrl.readOnly && !ctrl.hasAttribute('lay-key')) {
      setNative(ctrl, fmtDate(val, ctrl));
      keyEvt(ctrl, 'Enter', 13);
      await sleep(250);
      if (document.activeElement === ctrl) ctrl.blur();
      closeDropdowns();
      if (got()) return true;
    }
    // 2) 打开弹出的日历
    closeDropdowns(); await sleep(100);
    EXCL = new Set(allPanels());
    const panel0 = await openPanel(wrap);
    if (!panel0 && wrap.matches(CUSTOM_SELECT) && visibleOptions().length) return 'list'; // 是普通下拉框，列表已经打开
    // 2a) 北森 / antd v3 的“年-月”面板（类名已知，最可靠）
    const near = (list) => list.sort((a, b) => distTo(wrap, a) - distTo(wrap, b))[0];
    const getMp = () => near([...document.querySelectorAll('.phoenix-calendar-month-panel, .ant-calendar-month-panel')].filter(visible));
    let mp = getMp();
    if (mp) {
      const pre = mp.classList.contains('phoenix-calendar-month-panel') ? 'phoenix-calendar' : 'ant-calendar';
      for (let k = 0; k < 60; k++) {
        mp = getMp(); if (!mp) break;
        const cy = parseInt(clean((mp.querySelector(`.${pre}-month-panel-year-select-content, .${pre}-month-panel-year-select`) || {}).textContent), 10);
        if (!cy || cy === y) break;
        const btn = mp.querySelector(cy > y ? `.${pre}-month-panel-prev-year-btn` : `.${pre}-month-panel-next-year-btn`);
        if (!btn) break;
        press(btn); await sleep(60);
      }
      mp = getMp();
      const cells = mp ? [...mp.querySelectorAll(`.${pre}-month-panel-month`)] : [];
      const cell = cells.find((a) => monthNum(a.textContent) === mo) || (cells.length === 12 ? cells[mo - 1] : null);
      if (cell) {
        press(cell.closest('td') || cell); await sleep(350);
        if (got()) return true;
        if (cell.isConnected && visible(cell)) { press(cell); await sleep(350); }
        if (got()) return true;
      }
    }
    // 2a') bootstrap-datetimepicker（电信等系统）：年/月/日三层视图，th.switch 往上切换，th.prev/next 翻页
    let dtp = near([...document.querySelectorAll('.datetimepicker')].filter(visible));
    if (!dtp && document.querySelector('.datetimepicker') && ctrl.tagName === 'INPUT') {
      // 按下鼠标时这个插件会把刚弹出的面板关掉：用插件自己的 show，或者重新聚焦一次
      try { const jq = window.jQuery; if (jq && jq(ctrl).data('datetimepicker')) jq(ctrl).datetimepicker('show'); else { ctrl.blur(); ctrl.focus(); } } catch (e) { /* ignore */ }
      await sleep(250);
      dtp = near([...document.querySelectorAll('.datetimepicker')].filter(visible));
    }
    if (dtp) {
      const view = () => ['days', 'months', 'years'].find((v) => { const e = dtp.querySelector('.datetimepicker-' + v); return e && visible(e); });
      for (let k = 0; k < 3 && view() && view() !== 'years'; k++) { const sw = dtp.querySelector('.datetimepicker-' + view() + ' th.switch'); if (!sw) break; press(sw); await sleep(120); }
      if (view() === 'years') {
        for (let k = 0; k < 15; k++) {
          const ys = [...dtp.querySelectorAll('.datetimepicker-years span.year')];
          const hit = ys.find((e) => clean(e.textContent) === String(y));
          if (hit) { press(hit); break; }
          const nums = ys.map((e) => parseInt(e.textContent, 10)).filter(Boolean);
          const b = nums.length && dtp.querySelector('.datetimepicker-years th.' + (y < Math.min(...nums) ? 'prev' : 'next'));
          if (!b) break;
          press(b); await sleep(120);
        }
        await sleep(150);
        if (view() === 'months') { const ms = [...dtp.querySelectorAll('.datetimepicker-months span.month')]; if (ms[mo - 1]) { press(ms[mo - 1]); await sleep(200); } }
        if (view() === 'days' && visible(dtp)) { const ds = [...dtp.querySelectorAll('.datetimepicker-days td.day')].filter((t) => !/\b(old|new|disabled)\b/.test(t.className)); const t = ds.find((e) => clean(e.textContent) === String(d || 1)); if (t) { press(t); await sleep(200); } }
        if (visible(dtp)) { try { if (window.jQuery && window.jQuery.fn.datetimepicker) window.jQuery(ctrl).datetimepicker('hide'); } catch (e) { /* ignore */ } }
        if (got()) return true;
      }
    }
    // 2b) 弹层里有输入框（antd v3 日期、北森日期、element 日期）
    const ci = near([...document.querySelectorAll('.ant-calendar-input, .phoenix-calendar-input, .el-date-picker__editor-wrap input, .el-picker-panel input')].filter((e) => visible(e) && !e.disabled));
    if (ci) {
      setNative(ci, d ? `${y}-${mm}-${String(d).padStart(2, '0')}` : `${y}-${mm}-01`);
      await sleep(150);
      keyEvt(ci, 'Enter', 13);
      await sleep(400);
      if (got()) return true;
    }
    // 2c) 通用日历：认年份、月份格子、翻页按钮、日期格子
    if (findPanel(wrap) || panel0) {
      if (await pickInPanel(wrap, y, mo, d, got)) return true;
    }
    // 2d) 输入框本身可以打字（antd v4/v5、可编辑的北森框）
    const inner = wrap.querySelector('input:not([type=hidden])');
    if (inner && !inner.readOnly && !inner.disabled && !wrap.matches(CUSTOM_SELECT)) { setNative(inner, fmtDate(val, inner)); keyEvt(inner, 'Enter', 13); await sleep(300); if (got()) return true; }
    // 3) 只读输入框直接赋值（51job 等老系统）
    const failPanel = findPanel(wrap);
    DIAG.push({ label: label || '', val: String(val), field: snip(wrap, 900), panel: snip(failPanel || panel0, 2500) });
    closeDropdowns();
    await sleep(150);
    if (ctrl.tagName === 'INPUT') { setNative(ctrl, fmtDate(val, ctrl)); return got(); }
    return false;
  }

  async function fillRadioGroup(container, val) {
    let labels = [...container.querySelectorAll('label, .phoenix-radio, .ant-radio-wrapper, .el-radio, [role="radio"], .layui-form-radio')].filter(visible);
    // <span><input type=radio>是</span> 这种没有 label 的写法：用单选框外面那一层
    if (!labels.length) labels = [...container.querySelectorAll('input[type=radio]')].map((r) => r.closest('label') || r.parentElement).filter((e) => e && visible(e));
    let best = null;
    for (const w of altsOf(val)) {
      if (w === '*') { best = labels[0]; break; }
      let bs = 0, b = null;
      for (const l of labels) { const s = matchScore(l.textContent, w); if (s > bs) { bs = s; b = l; } }
      if (b && bs >= 45) { best = b; break; }
    }
    if (!best) return false;
    press(best); await sleep(150);
    // layui：原生单选框藏在画出来的 div 前面
    const prev = best.previousElementSibling;
    const inner = best.matches('input[type=radio]') ? best : best.querySelector('input[type=radio]') || (prev && prev.matches('input[type=radio]') ? prev : null);
    if (best.matches('.layui-form-radio')) {
      if (inner && !inner.checked) { inner.checked = true; layuiSync(inner, 'radio'); await sleep(100); }
      return !inner || inner.checked;
    }
    if (inner && !inner.checked) { inner.click(); await sleep(100); }
    return true;
  }

  // ---------------------------------------------------------------- 控件收集
  function collectControls() {
    const ctrls = [];
    const seen = new Set();
    const add = (el, kind, anchor) => { if (seen.has(anchor)) return; seen.add(anchor); ctrls.push({ el, kind, anchor }); };
    document.querySelectorAll(CUSTOM_SELECT).forEach((w) => {
      if (!visible(w) || w.closest(DATE_WRAP)) return;
      if (w.parentElement && w.parentElement.closest(CUSTOM_SELECT)) return;
      // layui 下拉：原生 select 藏在前面，填的时候点画出来的 dd
      if (w.matches('.layui-form-select')) { const sel = laySelectOf(w); if (sel) seen.add(sel); add(w, 'layselect', w); return; }
      // 北森的日期框外观也是 phoenix-select，里面有日历图标
      const isDateSel = w.matches('.phoenix-select') && !!w.querySelector('[id*="date_time_picker"], [id*="date_picker"], [id*="calendar"]');
      add(w, isDateSel ? 'date' : 'cselect', w);
    });
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      const t = (el.type || '').toLowerCase();
      // layui 把单选框藏起来，旁边画一个 .layui-form-radio
      const skin = (t === 'radio' || t === 'checkbox') && el.nextElementSibling && el.nextElementSibling.matches('.layui-form-radio, .layui-form-checkbox, .layui-form-switch') ? el.nextElementSibling : null;
      if (!visible(el) && el.tagName !== 'SELECT' && !(skin && visible(skin))) return;
      if (['hidden', 'file', 'submit', 'button', 'image', 'reset', 'password'].includes(t)) return;
      if (el.closest(CUSTOM_SELECT) && !el.closest(DATE_WRAP)) return;
      if (t === 'radio' || t === 'checkbox') {
        const group = el.closest('.form-item__control, .ant-radio-group, .el-radio-group, .ant-form-item-control, .el-form-item__content, .layui-input-block, .layui-input-inline, td, [role="radiogroup"]') || el.parentElement.parentElement;
        if (group) add(el, 'radio', group);
        return;
      }
      // 日期框：组件库日期容器、占位文字、类名、或者绑定了 jQuery 日期插件（bootstrap-datetimepicker 等）、或者只读且标签是“时间/日期”
      const jq = window.jQuery && window.jQuery.fn && el.tagName === 'INPUT' ? window.jQuery(el).data() || {} : {};
      const isDate = el.closest(DATE_WRAP) || /日期|年月|yyyy/i.test(el.placeholder || '') || /date|calendar/i.test(el.className) || (el.getAttribute('onfocus') || '').includes('setday')
        || el.hasAttribute('lay-key') || !!(jq.datetimepicker || jq.datepicker || jq.DateTimePicker) || (el.tagName === 'INPUT' && el.readOnly && /时间|日期|年月/.test(labelOf(el)));
      // 只读、或写着“请选择”的输入框（Moka sd- 组件等）：点开是下拉列表，要从列表里点
      const isPop = !isDate && el.tagName === 'INPUT' && (el.readOnly || (/^请选择/.test(el.placeholder || '') && !!el.closest('[class*="sd-"]')));
      add(el, isDate ? 'date' : el.tagName === 'SELECT' ? 'select' : isPop ? 'pselect' : 'text', isDate ? (el.closest(DATE_WRAP) || el) : el);
    });
    // 北森单选组（不是原生 radio）
    document.querySelectorAll('.form-item__control').forEach((c) => {
      if (c.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, ' + CUSTOM_SELECT)) return;
      if (/男|女|是|否|未婚|应届/.test(c.textContent) && visible(c)) add(c, 'radio', c);
    });
    ctrls.sort((a, b) => (a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return ctrls;
  }
  function currentValue(c) {
    const el = c.el;
    if (c.kind === 'text' || c.kind === 'pselect') return (el.value || '').trim();
    if (c.kind === 'layselect') { const i = el.querySelector('.layui-select-title input'); const sel = laySelectOf(el); return (i && i.value.trim()) || (sel && sel.value && sel.selectedIndex > 0 ? sel.value : ''); }
    if (c.kind === 'date') return ((el.tagName === 'INPUT' ? el : el.querySelector('input:not([type=hidden])')) || { value: '' }).value.trim();
    if (c.kind === 'select') { const o = el.options[el.selectedIndex]; return o && o.value && !/请选择|^[-—\s]*$|^(无|不限)$/.test(clean(o.text)) && el.selectedIndex > 0 ? o.text : ''; }
    if (c.kind === 'cselect') {
      // 下拉框还没打开过时，选项列表常常还在组件内部，不能直接读整个 textContent
      const inp = el.querySelector('input:not([type=hidden])');
      if (el.matches('.el-select, .el-cascader, .ivu-select') && inp) return inp.value.trim();
      const disp = el.querySelector('.phoenix-select__display'); // 北森可输入的下拉：选中的文字显示在这里
      if (disp && clean(disp.textContent)) return clean(disp.textContent);
      const sv = el.querySelector('.ant-select-selection-selected-value, .ant-select-selection__choice__content, .ant-select-selection-item, .phoenix-select__content, .ivu-select-selected-value, .ant-cascader-picker-label');
      const t = clean((sv || el).textContent);
      return /^请(选择|输入)|^--|^select/i.test(t) ? '' : t;
    }
    if (c.kind === 'radio') { return c.anchor.querySelector('input:checked, .ant-radio-wrapper-checked, .is-checked, [class*="checked"], .layui-form-radioed') ? 'x' : ''; }
    return '';
  }

  // ---------------------------------------------------------------- 重复板块：点“添加”
  function unsavedDialog() {
    return [...document.querySelectorAll('.ant-modal-confirm, .ant-modal, .el-message-box, .ivu-modal, [role=dialog]')].find((d) => visible(d) && /没有保存|未保存|退出编辑|放弃(编辑|修改)|是否保存/.test(d.textContent || '')) || null;
  }
  async function ensureEntries(profile, controls) {
    const want = { edu: profile.education.length, intern: profile.internships.length, project: profile.projects.length, award: profile.awards.length, family: profile.family.length, cert: profile.certificates.length, lang: profile.languages.length, campus: (profile.campus || []).length };
    // 每条经历用哪个字段来数条数
    const PRIMARY = { edu: 'school', intern: 'company', project: 'name', award: 'name', family: 'name', cert: 'name', lang: 'language', campus: 'org' };
    const isPrimary = (c, sec) => { const f = lookup(sec, c.label); return f && f[2].key === PRIMARY[sec]; };
    let clicked = 0;
    for (const h of HEADERS) {
      const sec = h.key; if (!want[sec]) continue;
      // 页面上现有几条：用这个板块里出现次数最多的那个字段来数（有的表没有“单位/组织名称”这一栏）
      const cnt = {};
      for (const c of controls) { if (c.section !== sec) continue; const f = lookup(sec, c.label); if (f && f[0] === sec) (cnt[f[1].source] = cnt[f[1].source] || new Set()).add(itemOf(c.el) || c.el); }
      // 优先用“主字段”（学校 / 单位 / 名称…）来数；没有主字段时才用出现次数最多的字段
      const prim = new Set(controls.filter((c) => c.section === sec && isPrimary(c, sec)).map((c) => itemOf(c.el) || c.el));
      const have = prim.size || Math.max(0, ...Object.values(cnt).map((x) => x.size));
      const need = Math.min(want[sec] - have, 8);
      if (need <= 0) continue;
      const next = HEADERS[HEADERS.indexOf(h) + 1];
      const btns = [...document.querySelectorAll('button, a, span, div')].filter((b) => {
        if (!visible(b) || b.children.length > 3) return false;
        const t = clean(b.textContent);
        if (!/^(\+\s*)?(添加|新增|增加)/.test(t) || t.length > 14) return false;
        if (!(h.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        if (next && !(next.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING)) return false;
        return true;
      });
      // 选最里层的那个元素点击（事件会向外冒泡，反过来则不会）
      const findBtn = () => {
        const list = [...document.querySelectorAll('button, a, span, div')].filter((b) => {
          if (!visible(b) || b.children.length > 3) return false;
          const t = clean(b.textContent);
          if (!/^(\+\s*)?(添加|新增|增加)/.test(t) || t.length > 14) return false;
          if (!(h.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          if (next && next.el.isConnected && !(next.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING)) return false;
          return true;
        });
        return list.find((b) => !list.some((o) => o !== b && b.contains(o)));
      };
      if (!btns.length) continue;
      // 简历展示页（如国聘“我的简历”）：板块里只有文字和“编辑”按钮、没有输入框，点“添加”会打开一堆编辑框，跳过
      const inSec = (b) => (h.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && (!next || !next.el.isConnected || (next.el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING));
      const secHasControls = controls.some((c) => c.section === sec);
      const secHasEditBtns = [...document.querySelectorAll('button, a, span')].some((b) => visible(b) && b.children.length <= 2 && /^编辑$/.test(clean(b.textContent)) && inSec(b));
      if (!secHasControls && secHasEditBtns) continue;
      const countNow = () => document.querySelectorAll('input, textarea, ' + CUSTOM_SELECT).length;
      for (let k = 0; k < need; k++) {
        const b = findBtn(); if (!b) break;
        const n0 = countNow();
        press(b); clicked++;
        // 等页面真的多出一栏再点下一次（页面重画后按钮会换成新的元素）
        for (let t = 0; t < 20 && countNow() === n0; t++) { await sleep(150); if (unsavedDialog()) break; }
        // 弹出“有内容没有保存，确定退出编辑吗”之类的确认框：点“取消”保留当前内容，并停止继续添加
        const dlg = unsavedDialog();
        if (dlg) { const c = [...dlg.querySelectorAll('button')].find((x) => /^取\s*消$/.test(clean(x.textContent))); if (c) press(c); await sleep(300); return clicked; }
        await sleep(250);
      }
    }
    return clicked;
  }

  // ---------------------------------------------------------------- 附件
  async function dataUrlToFile(f) {
    // 不用 fetch(dataURL)，避免被网页的 CSP 拦截
    const [head, b64] = f.dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || f.type || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.type || mime });
  }
  async function uploadFiles(files) {
    const log = [];
    const done = new Set();
    const tried = new WeakSet();
    // 每传完一个重新找一遍上传框：有的系统传完会重画整块（hotjob），旧的上传框已经不在页面里了
    for (let round = 0; round < 12; round++) {
      const inp = [...document.querySelectorAll('input[type=file]')].find((i) => !tried.has(i) && i.isConnected);
      if (!inp) break;
      tried.add(inp);
      let ctx = labelOf(inp);
      let p = inp;
      for (let i = 0; i < 5 && p && ctx.length < 2; i++) { p = p.parentElement; ctx = p ? clean(p.textContent).slice(0, 60) : ctx; }
      if (!ctx) { const it = inp.closest('.form-item, .ant-form-item, .el-form-item, tr, li'); ctx = clean(it && it.textContent).slice(0, 60); }
      const keyOf = (t) => (/照片|头像|证件照|免冠|相片/.test(t) ? 'photo' : /成绩单/.test(t) ? 'transcript' : /学历|学位|毕业证/.test(t) ? 'diploma' : /简历|附件|作品|材料/.test(t) ? 'resume' : null);
      let key = keyOf(ctx);
      // 上传框放在 iframe 里（51job 等）：框内只有“上传”按钮，用 iframe 在外层页面那一行的文字来判断
      if (!key && window.frameElement) {
        try { let q = window.frameElement; for (let i = 0; i < 5 && q && !key; i++) { q = q.parentElement; const t = clean(q && q.textContent).slice(0, 60); if (keyOf(t)) { key = keyOf(t); ctx = t; } } } catch (e) { /* 跨域 iframe 读不到外层 */ }
      }
      if (!key || !files[key]) continue;
      const ctxKey = key + '|' + ctx.slice(0, 20);
      if (done.has(ctxKey)) continue; // 同一个位置已经传过（上传框被重画成了新元素）
      const accept = (inp.accept || '').toLowerCase();
      const f = files[key];
      if (accept && !accept.split(',').some((a) => { a = a.trim(); return !a || a === '*/*' || (a.startsWith('.') && f.name.toLowerCase().endsWith(a)) || (a.endsWith('/*') && (f.type || '').startsWith(a.slice(0, -1))) || a === f.type; })) { log.push(`跳过「${ctx.slice(0, 12)}」：格式不接受 ${f.name}`); continue; }
      try {
        const file = await dataUrlToFile(f);
        // 先找好旁边的“上传”按钮（51job 等）：触发 change 后上传框可能被页面移走
        const box = inp.form || (inp.parentElement && inp.parentElement.parentElement) || inp.parentElement || document;
        const upBtn = [...box.querySelectorAll('input[type=button], input[type=submit], button, a')].find((b) => visible(b) && /^上\s*传$/.test(clean(b.value || b.textContent)));
        const dt = new DataTransfer(); dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (upBtn) { await sleep(300); if (upBtn.isConnected) press(upBtn); }
        done.add(ctxKey);
        log.push(`已上传「${ctx.slice(0, 12)}」：${f.name}`);
        await sleep(800);
      } catch (e) { log.push(`上传失败「${ctx.slice(0, 12)}」：` + e.message); }
    }
    return log;
  }

  // ---------------------------------------------------------------- 主流程
  const markTarget = (el) => el.closest('.phoenix-select, .ant-select, .el-select, .form-item__control, .layui-form-select') || el;
  function mark(el, ok) {
    const t = markTarget(el);
    t.style.outline = ok ? '2px solid #22c55e' : '2px solid #ef4444';
    t.style.outlineOffset = '1px';
    t.style.boxShadow = '';
    t.setAttribute('data-wszs-mark', ok ? 'ok' : 'fail');
  }
  // 填完还空着的必填项：橙色粗边框 + 外发光，一眼能看到
  function markTodo(el) {
    const t = markTarget(el);
    t.style.outline = '3px dashed #f97316';
    t.style.outlineOffset = '2px';
    t.style.boxShadow = '0 0 0 6px rgba(249,115,22,.25)';
    t.setAttribute('data-wszs-mark', 'todo');
  }
  function clearMarks() {
    document.querySelectorAll('[data-wszs-mark], [style*="outline"]').forEach((e) => {
      if (e.hasAttribute('data-wszs-mark') || /2px solid/.test(e.style.outline)) { e.style.outline = ''; e.style.outlineOffset = ''; e.style.boxShadow = ''; e.removeAttribute('data-wszs-mark'); }
    });
  }

  // 资料里的身份证号之类一律去掉：只能由用户本人填写
  const ID_KEY = /^(id(Number|Card|No|Code)?|idcard|identity(No|Number)?|身份证号?(码)?|证件号(码)?)$/i;
  function stripIds(o) {
    if (Array.isArray(o)) return o.map(stripIds);
    if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) { if (!ID_KEY.test(k)) r[k] = stripIds(v); } return r; }
    return o;
  }
  function getProfile(opts) {
    // 插件在页面环境（MAIN world）里运行，资料由弹窗读出后作为参数传进来，不挂在 window 上
    const raw = opts.profile ? { profile: opts.profile, files: opts.files || {} } : { profile: window.__WSZS_TEST_PROFILE, files: window.__WSZS_TEST_FILES || {} };
    return { profile: raw.profile ? stripIds(raw.profile) : raw.profile, files: raw.files };
  }
  const labeled = (list) => list.map((c) => ({ ...c, label: c.kind === 'radio' ? labelOf(c.anchor, true) : labelOf(c.el), section: sectionOf(c.anchor) }));
  function sectionTextOf(el) {
    let cur = '';
    for (const h of HEADERS) {
      if (h.el === el || h.el.contains(el)) continue;
      if (h.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) cur = h.text; else break;
    }
    return cur;
  }
  // 按控件类型填一个值（自动填写和 wszs.set 共用）
  async function fillControl(c, val) {
    if (c.kind === 'text') return fillText(c, val);
    if (c.kind === 'select') {
      let best = null;
      for (const w of altsOf(val)) {
        if (w === '*') { best = [...c.el.options].find((o) => o.value && !PLACEHOLDER_OPT.test(clean(o.text))); break; }
        let bs = 0, b = null;
        for (const o of c.el.options) { const s = matchScore(o.text, w); if (s > bs) { bs = s; b = o; } }
        if (b && bs >= 35) { best = b; break; }
      }
      if (!best) return false;
      setNative(c.el, best.value); if (c.el.onchange) try { c.el.onchange(); } catch (e) { /* ignore */ }
      if (c.el.nextElementSibling && c.el.nextElementSibling.matches('.layui-form-select')) layuiSync(c.el, 'select');
      await sleep(500);
      return true;
    }
    if (c.kind === 'cselect') {
      // 外观像下拉框的日期框：值是日期、或标签是“…时间/日期”时先按日期处理
      if (/^\d{4}[-./年]\d{1,2}/.test(String(val)) || /(时间|日期|年月)$/.test(c.label)) { const r = await fillDate(c.el, val, c.label); if (r === true) return true; return fillCustomSelect(c.el, val, c.label, r === 'list'); }
      return fillCustomSelect(c.el, val, c.label);
    }
    if (c.kind === 'layselect') return fillLaySelect(c.el, val);
    if (c.kind === 'pselect') {
      if (/^\d{4}[-./年]\d{1,2}/.test(String(val)) && /^\s*\d{4}\D\d{1,2}(\D\d{1,2})?\s*$/.test(textValue(val))) { if ((await fillDate(c.el, val, c.label)) === true) return true; }
      const r = await fillCustomSelect(c.el, val, c.label, false, { probe: true, verify: true });
      if (r !== 'nopopup') return r;
      // 点开没有列表：就是普通的只读框，直接写值
      const tv = textValue(val); setNative(c.el, tv); return c.el.value === tv;
    }
    if (c.kind === 'date') { const r = await fillDate(c.el, val, c.label); if (r === 'list') return fillCustomSelect(c.el, val, c.label, true); return r === true; }
    if (c.kind === 'radio') return fillRadioGroup(c.anchor, val);
    return false;
  }
  // 当前选中的文字（单选组 / 下拉），用来判断开关题是不是已经是想要的答案
  function chosenText(c) {
    if (c.kind === 'radio') {
      const on = c.anchor.querySelector('.layui-form-radioed, .ant-radio-wrapper-checked, .is-checked');
      if (on) return clean(on.textContent);
      const i = c.anchor.querySelector('input:checked'); if (!i) return '';
      return clean((i.closest('label') || i.parentElement).textContent) || i.value || 'x';
    }
    return currentValue(c);
  }
  // 填完后再扫一遍：还空着的必填项标橙色粗框，并列成清单
  function todoScan() {
    scanHeaders();
    const cnt = new Map();
    for (const c of labeled(collectControls())) {
      const target = c.kind === 'radio' ? c.anchor : c.el;
      const sens = isSensitive(c.label);
      if (currentValue(c)) { const t = markTarget(target); if (t.getAttribute('data-wszs-mark') === 'todo') { t.style.outline = ''; t.style.boxShadow = ''; t.removeAttribute('data-wszs-mark'); } continue; }
      if (!sens && !isRequired(c.el)) continue;
      markTodo(target);
      const sec = c.section !== 'basic' ? sectionTextOf(c.anchor) : '';
      const name = (sec ? sec + '·' : '') + (c.label || '(无标签)') + (sens ? '（本人填写）' : '');
      cnt.set(name, (cnt.get(name) || 0) + 1);
    }
    return [...cnt].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).slice(0, 40);
  }

  // wszs.set({ 标签: 值 })：按标签找字段直接设值。
  // 标签写法：'学校名称'、'学校名称#2'（第 2 个同名字段）、'教育经历>学校名称'（限定板块）
  async function setFields(fields) {
    scanHeaders();
    const controls = labeled(collectControls());
    const used = new Set();
    const results = [];
    for (const [key, val] of Object.entries(fields || {})) {
      const m = String(key).match(/^(?:(.+?)\s*[>＞》]\s*)?(.+?)(?:\s*#\s*(\d+))?$/);
      const secQ = m && m[1], labQ = (m && m[2]) || String(key), nth = m && m[3] ? +m[3] : 0;
      if (isSensitive(labQ) || ID_VAL.test(String(val))) { results.push({ key, ok: false, found: false, msg: '身份证 / 证件号只能由本人填写' }); continue; }
      const nl = norm(labQ);
      let list = controls.filter((c) => norm(c.label) === nl);
      if (!list.length) list = controls.filter((c) => { const n = norm(c.label); return n && (n.includes(nl) || (n.length >= 2 && nl.includes(n))); });
      if (secQ) { const ns = norm(secQ); list = list.filter((c) => norm(sectionTextOf(c.anchor)).includes(ns) || c.section === secQ); }
      const c = nth ? list[nth - 1] : (list.find((x) => !used.has(x) && !currentValue(x)) || list.find((x) => !used.has(x)) || list[0]);
      if (!c) { results.push({ key, ok: false, found: false, msg: list.length ? `同名字段只有 ${list.length} 个` : '没找到这个字段' }); continue; }
      if (isSensitive(c.label)) { results.push({ key, label: c.label, ok: false, found: true, msg: '身份证 / 证件号只能由本人填写' }); continue; }
      used.add(c);
      let ok = false, err = '';
      const d0 = DIAG.length;
      try { ok = !!(await fillControl(c, val)); } catch (e) { err = String(e.message || e); }
      mark(c.kind === 'radio' ? c.anchor : c.el, ok);
      const r = { key, label: c.label, kind: c.kind, ok, found: true, now: c.kind === 'radio' ? chosenText(c) : String(currentValue(c)).slice(0, 40) };
      if (!ok) { r.msg = err || '没填上'; if (DIAG.length > d0) r.diag = DIAG[DIAG.length - 1]; }
      results.push(r);
      await sleep(60);
    }
    closeDropdowns();
    DIAG.splice(0);
    return { ok: true, mode: 'set', version: VERSION, set: results.filter((r) => r.ok).length, results, missingRequired: todoScan(), url: location.host };
  }

  const HIGH_FIRST = /(先|首先|优先)填(写)?最高学历|从最高学历(开始|起|填)|最高学历(开始|起)填|学历(由|从)高到低|(由|从)高到低(的顺序)?填|倒序(填写|排列|填)|最高学历(在前|排在前|放在第一)|第一(条|项|段).{0,8}最高学历|最高学历.{0,4}(填|写)在(最)?前/;
  async function run(opts = {}) {
    if (opts.mode === 'clear') { clearMarks(); return { ok: true, filled: 0, msg: '已清除颜色标记' }; }
    if (opts.mode === 'set') return setFields(opts.fields);
    if (opts.mode === 'todo') return { ok: true, version: VERSION, filled: 0, missingRequired: todoScan(), url: location.host };
    let { profile, files } = getProfile(opts);
    if (!profile) return { ok: false, msg: '还没有个人信息，请先在设置页保存。' };
    let eduOrder = 'asc';
    if (opts.mode !== 'upload') {
      const hs = ((profile.settings || {}).highSchool || '自动').trim();
      const text = document.body.innerText;
      const pageAsks = /(从|自)高中(阶段)?(开始|起|填)|高中(阶段)?(起|开始)填|须从高中|请填写高中|高中及以上(学历)?(均|都)/.test(text);
      if (hs === '从不' || (hs !== '总是' && !pageAsks)) profile = { ...profile, education: profile.education.filter((e) => !/高中|中专|初中/.test(e.level || '')) };
      // 页面要求“先填最高学历”：教育经历按毕业时间从晚到早排
      const want = String(opts.eduOrder || (profile.settings || {}).eduOrder || '自动');
      if (/desc|从高到低/.test(want) || (!/asc|从低到高/.test(want) && HIGH_FIRST.test(text))) {
        eduOrder = 'desc';
        profile = { ...profile, education: [...profile.education].sort((a, b) => String(b.end || '').localeCompare(String(a.end || ''))) };
      }
    }
    if (opts.mode === 'upload') { const log = await uploadFiles(files); return { ok: true, filled: 0, log, msg: log.length ? '' : '本页没有找到可匹配的上传框' }; }

    const filled = [], skipped = [], failed = [], userOnly = [];
    const log = [];
    scanHeaders();
    let controls = labeled(collectControls());
    // 先回答“是否有实习经历 / 是否取得证书”这类开关：选“是”后对应板块才会展开
    const toggled = new Set();
    for (const c of controls) {
      if (c.kind === 'text' || c.kind === 'date') continue;
      const lab = clean(c.label).replace(/^\d+\s*[.、．]\s*/, '');
      if (!TOGGLE_RE.test(lab)) continue;
      const v = toggleVal(profile, lab);
      if (!v) continue;
      const cur = chosenText(c);
      if (cur && cur !== 'x' && matchScore(cur, v) >= 60) continue; // 已经是想要的答案
      if (cur && !opts.overwrite && v !== '是') continue; // 用户已经选了，资料里又没有这类经历：不动
      const target = c.kind === 'radio' ? c.anchor : c.el;
      let ok = false;
      try { ok = !!(await fillControl(c, v)); } catch (e) { ok = false; }
      mark(target, ok);
      (ok ? filled : failed).push(`${c.label}=${v}`);
      if (ok) { toggled.add(target); if (cur) log.push(`开关「${c.label}」改成了“${v}”`); }
    }
    if (toggled.size) { await sleep(700); scanHeaders(); controls = labeled(collectControls()); }
    if (opts.addEntries !== false) {
      const n = await ensureEntries(profile, controls);
      if (n) { await sleep(600); scanHeaders(); controls = labeled(collectControls()); }
    }
    // 同一板块同一字段出现第几次 → 第几条经历
    const counter = {};
    HAS_DUTY = controls.some((c) => c.section === 'project' && /职责|负责/.test(c.label));
    const groupOf = new Map();
    for (const c of controls) { if (c.kind === 'radio') continue; const it = itemOf(c.el) || c.anchor.parentElement; if (!groupOf.has(it)) groupOf.set(it, []); groupOf.get(it).push(c); c.__item = it; }
    for (const c of controls) {
      const target = c.kind === 'radio' ? c.anchor : c.el;
      if (toggled.has(target)) continue;
      // 身份证 / 证件号：留给用户本人
      if (isSensitive(c.label)) { userOnly.push(c.label); continue; }
      // 基本信息里自定义问答优先；经历板块里只有识别不出的标签才用自定义问答
      const f = (c.section === 'basic' && customLookup(profile, c.label)) || lookup(c.section, c.label) || customLookup(profile, c.label);
      if (!f) continue;
      const key = c.section + '|' + f[1].source;
      const g = c.__item ? groupOf.get(c.__item).filter((x) => x.label === c.label) : [c];
      const pos = g.indexOf(c);
      const idx = pos > 0 && g[0].__idx !== undefined ? g[0].__idx : (counter[key] = (counter[key] || 0) + 1) - 1;
      c.__idx = idx;
      let val;
      try { val = f[2](profile, idx, clean(c.label)); } catch (e) { val = ''; }
      if (g.length > 1 && val && String(val).includes('/') && altsOf(val).every((a) => a === '*' || isPath(a))) {
        // 例：“山东省/青岛市” 分给两个并排的下拉框；“英国/伦敦|海外/海外” 也按段拆开；起止时间拆给两个日期框
        const segs = altsOf(val).map((a) => (a === '*' ? '*' : a.split('/')[pos])).filter(Boolean);
        val = [...new Set(segs)].join('|');
      } else if (g.length > 1 && g.every((x) => x.kind === 'select' || x.kind === 'cselect') && /^\d{4}\D\d{1,2}(\D\d{1,2})?$/.test(String(val).trim())) {
        // 日期拆成“年 / 月 / 日”几个并排的下拉框（例：出生日期 2003 年 07 月）
        const d = String(val).trim().split(/\D/);
        const seg = d[pos] || '';
        val = pos === 0 ? seg : [seg.padStart(2, '0'), String(+seg)].filter((x, i, a) => a.indexOf(x) === i).join('|');
      } else if (g.length === 1 && f[2].key === 'range' && val) {
        val = String(val).split('/')[0]; // 只有一个日期框：先填开始时间
      }
      if (val === undefined || val === null || val === '' || ID_VAL.test(String(val))) continue;
      if (!opts.overwrite && currentValue(c)) { skipped.push(c.label); continue; }
      let ok = false;
      try { ok = !!(await fillControl(c, val)); } catch (e) { ok = false; }
      (ok ? filled : failed).push(`${c.label}=${String(val).slice(0, 16)}`);
      mark(target, ok);
      await sleep(opts.delay || 60);
    }
    closeDropdowns();
    if (opts.upload) log.push(...(await uploadFiles(files)));
    const missingRequired = todoScan();
    const diag = DIAG.splice(0).slice(0, 6);
    return { ok: true, version: VERSION, filled: filled.length, filledList: filled, failed, skipped: skipped.length, missingRequired, userOnly: [...new Set(userOnly)], eduOrder, log, sections: [...new Set(HEADERS.map((h) => h.text))], diag, url: location.host };
  }

  window.__WSZS = { version: VERSION, run, setFields, _test: { labelOf, matchScore, fmtDate, collectControls, scanHeaders, sectionOf, fillDate, lookup, currentValue, textValue, isSensitive } };
})();
