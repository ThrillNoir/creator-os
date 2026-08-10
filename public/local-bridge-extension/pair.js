(() => {
  const meta = document.querySelector('meta[name="creator-os-bridge"]');
  if (!meta) return;
  try {
    const config = JSON.parse(meta.content);
    chrome.storage.local.get("creatorOsBridges",({creatorOsBridges})=>chrome.storage.local.set({creatorOsBridges:{...(creatorOsBridges??{}),[config.platform]:config}}, () => {
      const destination = config.platform === "onlyfans" ? "https://onlyfans.com/my/chats/" : "https://fansly.com/messages";
      window.location.replace(destination);
    }));
  } catch { document.body.textContent = "Creator OS could not pair this collector."; }
})();
