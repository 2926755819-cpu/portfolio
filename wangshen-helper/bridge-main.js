// 网申助手桥接（页面环境）：在控制台或由 Claude 调用
//   await wszs.fill()    填写本页        await wszs.upload()  上传附件
//   await wszs.clear()   清除颜色        await wszs.ping()    查看插件版本
//   await wszs.reload()  重新加载插件（改完代码后用）
//   await wszs.set({ '学历': '本科', '教育经历>学校名称#2': '某某大学' })  按标签直接设值，返回每项成功 / 失败
//   await wszs.todo()    重新检查还空着的必填项（页面上标橙色框）
//   wszs.start('fill') 只发指令立即返回编号，之后用 wszs.results[编号] 或 wszs.last() 取结果
(() => {
  if (window.wszs && window.wszs.__v >= 2) return; // 旧版桥接（没有 set）会被替换
  let seq = 0;
  const results = {};
  let lastId = null;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__wszs === 'result' && !(e.data.id in results)) {
      results[e.data.id] = e.data.result;
    }
  });
  function start(action, opts) {
    const id = Date.now() + '-' + ++seq;
    lastId = id;
    window.postMessage({ __wszs: 'cmd', id, action, opts: opts || null }, '*');
    return id;
  }
  function wait(id, timeoutMs) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      (function poll() {
        if (id in results) return resolve(results[id]);
        if (Date.now() - t0 > timeoutMs) return resolve({ ok: false, msg: '等待超时（插件可能未加载或正在重新加载）', id });
        setTimeout(poll, 200);
      })();
    });
  }
  const call = (action, opts, timeoutMs = 180000) => wait(start(action, opts), timeoutMs);
  window.wszs = {
    __v: 2,
    results,
    start,
    wait,
    last: () => (lastId in results ? results[lastId] : { pending: lastId }),
    fill: (opts) => call('fill', opts),
    upload: () => call('upload'),
    set: (fields, opts) => call('set', { ...(opts || {}), fields: fields || {} }),
    todo: () => call('todo', null, 30000),
    clear: () => call('clear', null, 10000),
    ping: () => call('ping', null, 5000),
    reload: () => call('reload', null, 5000),
  };
})();
