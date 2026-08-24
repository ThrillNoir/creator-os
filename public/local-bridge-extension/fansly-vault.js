(() => {
  const hostId="creator-os-fansly-vault-bridge";
  const isVault=()=>location.hostname==="fansly.com"&&location.pathname.replace(/\/+$/,"")==="/creator/vault";
  const send=(message)=>new Promise((resolve)=>{
    try{
      chrome.runtime.sendMessage(message,(response)=>{
        try{
          if(chrome.runtime.lastError)resolve({ok:false,error:"Refresh this Fansly page after reloading the Creator OS extension."});
          else resolve(response??{ok:false,error:"The Creator OS bridge did not respond."});
        }catch{resolve({ok:false,error:"Refresh this Fansly page after reloading the Creator OS extension."});}
      });
    }catch{resolve({ok:false,error:"Refresh this Fansly page after reloading the Creator OS extension."});}
  });
  const mount=async()=>{
    if(!isVault()){
      document.getElementById(hostId)?.remove();
      return;
    }
    if(document.getElementById(hostId))return;
    const host=document.createElement("div");
    host.id=hostId;
    const root=host.attachShadow({mode:"open"});
    root.innerHTML=`<style>
      :host{all:initial} .panel{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:300px;padding:16px;border:1px solid #8168ff;border-radius:14px;background:#171321;color:#fff;box-shadow:0 16px 45px rgba(0,0,0,.38);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.title strong{font-size:15px}.badge{padding:3px 7px;border-radius:999px;background:#35285d;color:#cfc4ff;font-size:11px;font-weight:700}.identity{color:#bdb6ca;font-size:12px;margin:0 0 12px}.status{min-height:40px;margin:0 0 12px;color:#eee}.status.success{color:#81e6a8}.status.error{color:#ff9a9a}button{width:100%;border:0;border-radius:9px;padding:11px 12px;background:#7652ff;color:#fff;font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:hover{background:#8667ff}button:disabled{cursor:not-allowed;opacity:.65}button.busy{cursor:wait}.hint{display:block;margin-top:9px;color:#8f879d;font-size:11px}
    </style><section class="panel"><div class="title"><strong>Creator OS Bridge</strong><span class="badge">FANSLY VAULT</span></div><p class="identity">Checking this Chrome profile…</p><p class="status">Waiting for Creator OS.</p><button type="button" disabled>Upload approved content</button><small class="hint">Claims one approved job only after Fansly is ready.</small></section>`;
    document.documentElement.appendChild(host);
    const identity=root.querySelector(".identity");
    const status=root.querySelector(".status");
    const button=root.querySelector("button");
    const setStatus=(text,kind="")=>{status.textContent=text;status.className=`status ${kind}`.trim();};
    let paired=false;
    let lastPaired;
    let processing=false;
    const refreshPairing=async()=>{
      const bridge=await send({type:"creator-os-vault-status"});
      paired=Boolean(bridge?.ok&&bridge?.paired);
      if(paired){
        identity.textContent=`Paired workspace: ${bridge.creatorId||"creator"}`;
        if(!processing&&lastPaired!==true)setStatus("Queue an asset in Creator OS, then press the button below.");
        if(!processing)button.textContent="Upload approved content";
      }else{
        identity.textContent="This profile is not paired.";
        if(!processing&&lastPaired!==false)setStatus("Open this creator's Fansly vault from Creator OS to pair it.","error");
        if(!processing)button.textContent="Pair profile in Creator OS";
      }
      lastPaired=paired;
      button.disabled=processing||!paired;
    };
    button.addEventListener("click",async()=>{
      if(!paired)return;
      processing=true;
      button.classList.add("busy");
      button.textContent="Preparing upload…";
      button.disabled=true;
      setStatus("Preparing Fansly and checking the approved queue…");
      const result=await send({type:"creator-os-process-fansly-vault"});
      if(result?.state==="staged")setStatus(`${result.filename||"The file"} is saved in Fansly’s vault and verified by Creator OS.`,"success");
      else if(result?.state==="empty")setStatus("No approved Fansly upload is waiting for this creator.");
      else if(result?.state==="unpaired")setStatus("Pair this Chrome profile again from Creator OS.","error");
      else setStatus(result?.error||"The upload could not be prepared.","error");
      processing=false;
      button.classList.remove("busy");
      button.textContent=paired?"Upload approved content":"Pair profile in Creator OS";
      button.disabled=!paired;
    });
    await refreshPairing();
    const pairingTimer=setInterval(()=>{
      if(!document.documentElement.contains(host)){clearInterval(pairingTimer);return;}
      refreshPairing();
    },2000);
  };
  mount();
  setInterval(mount,1000);
})();
