// 网申助手桥接（插件环境）：把页面里 window.wszs 发出的指令转给插件后台，再把结果送回页面。
(() => {
  const listener = (e) => {
    if (e.source !== window || !e.data || e.data.__wszs !== 'cmd') return;
    // 插件重新加载后旧脚本会失效：直接退出，由新注入的脚本处理
    if (!chrome.runtime || !chrome.runtime.id) { window.removeEventListener('message', listener); return; }
    const { id, action, opts } = e.data;
    const root = document.documentElement;
    if (root.getAttribute('data-wszs-claim') === String(id)) return; // 同一条指令只执行一次
    root.setAttribute('data-wszs-claim', String(id));
    const reply = (result) => window.postMessage({ __wszs: 'result', id, result }, '*');
    try {
      chrome.runtime.sendMessage({ type: 'wszs-relay', action, opts }, (res) => {
        if (chrome.runtime.lastError) reply({ ok: false, msg: chrome.runtime.lastError.message });
        else reply(res);
      });
    } catch (err) { reply({ ok: false, msg: String(err.message || err) }); }
  };
  window.addEventListener('message', listener);
})();
