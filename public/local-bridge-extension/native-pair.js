(() => {
  const parameters=new URLSearchParams(location.hash.slice(1));
  const cloudToken=parameters.get("creator_os_cloud_pair");
  const token=cloudToken||parameters.get("creator_os_pair");
  if(!token)return;
  chrome.runtime.sendMessage({type:cloudToken?"creator-os-cloud-pair-token":"creator-os-pair-token",token},(result)=>{
    if(chrome.runtime.lastError||!result?.ok){console.error("Creator OS collector: native pairing was not accepted");return;}
    const clean=new URL(location.href);
    clean.hash="";
    history.replaceState(null,"",clean.href);
    console.info("Creator OS collector: native profile paired",{platform:result.platform});
  });
})();
