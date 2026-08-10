(async () => {
  const platform = location.hostname.includes("onlyfans") ? "onlyfans" : location.hostname.includes("fansly") ? "fansly" : null;
  const onMessagesPage = platform === "onlyfans" ? location.pathname.startsWith("/my/chats") : location.pathname.startsWith("/messages");
  if (!platform || !onMessagesPage) return;

  const pairingToken = new URLSearchParams(location.hash.slice(1)).get("creator_os_pair");
  if (pairingToken) {
    try {
      const response = await fetch(`http://127.0.0.1:3000/api/local-bridge/pair?token=${encodeURIComponent(pairingToken)}`,{headers:{accept:"application/json"}});
      if (response.ok) await chrome.storage.local.set({creatorOsBridge:await response.json()});
      history.replaceState(null,"",`${location.pathname}${location.search}`);
    } catch { /* A fresh pairing can be started again from Creator OS. */ }
  }

  const clean = (value,max=500) => String(value ?? "").replace(/\s+/g," ").trim().slice(0,max);
  const collect = () => {
    const threadLinks = Array.from(document.querySelectorAll('a[href]')).filter((link) => {
      const href = link.getAttribute("href") || "";
      return platform === "onlyfans" ? href.includes("/my/chats/chat/") : /\/messages\//.test(href);
    }).slice(0,100);
    const threads = [];
    const seen = new Set();
    for (const link of threadLinks) {
      const href = link.getAttribute("href") || "";
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const label = clean(link.getAttribute("aria-label") || link.textContent,300);
      threads.push({externalThreadId:href,participantName:label,unreadCount:link.querySelector('[class*="unread"], [aria-label*="unread" i]') ? 1 : 0,messages:[]});
    }
    const currentThread = platform === "onlyfans" ? location.pathname.match(/\/my\/chats\/chat\/[^/?#]+/)?.[0] : location.pathname.match(/\/messages\/[^/?#]+/)?.[0];
    if (currentThread) {
      const candidates = Array.from(document.querySelectorAll('[data-message-id], [class*="message"]')).filter((node) => {
        const text = clean(node.textContent,20000);
        return text.length > 0 && !node.querySelector('input[type="password"]');
      }).slice(-200);
      const messages = candidates.map((node,index) => {
        const classes = String(node.className || "");
        const direction = /outgoing|outbound|mine|self|sent/i.test(classes) ? "outbound" : "inbound";
        return {externalMessageId:clean(node.getAttribute("data-message-id") || `${currentThread}-${index}-${clean(node.textContent,80)}`),direction,senderType:direction === "outbound" ? "creator" : "fan",body:clean(node.textContent,20000)};
      });
      const existing = threads.find((thread) => thread.externalThreadId === currentThread);
      if (existing) existing.messages = messages;
      else threads.unshift({externalThreadId:currentThread,participantName:"Open conversation",unreadCount:0,messages});
    }
    return threads;
  };

  let timer;
  const extensionAvailable = () => {
    try { return Boolean(chrome?.runtime?.id); } catch { return false; }
  };
  const sync = () => {
    if (!extensionAvailable()) return;
    try {
      chrome.storage.local.get("creatorOsBridge", async ({creatorOsBridge}) => {
        if (!extensionAvailable()) return;
        if (!creatorOsBridge?.token || (creatorOsBridge.platform && creatorOsBridge.platform !== platform)) {
          const claimed = await chrome.runtime.sendMessage({type:"creator-os-claim",platform}).catch(() => null);
          if (claimed?.ok) schedule();
          return;
        }
        try {
          const response = await fetch("http://127.0.0.1:3000/api/local-bridge/ingest",{method:"POST",headers:{authorization:`Bearer ${creatorOsBridge.token}`,"content-type":"application/json"},body:JSON.stringify({platform,threads:collect()})});
          if (response.status === 401 && extensionAvailable()) {
            await chrome.storage.local.remove("creatorOsBridge");
            schedule();
          }
        } catch { /* The local app may be temporarily offline; the next DOM change retries. */ }
      });
    } catch { /* Reloading the extension invalidates the old page context until the tab refreshes. */ }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(sync,1200); };
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  schedule();
})();
