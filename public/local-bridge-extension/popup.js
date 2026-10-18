const installationIdElement=document.getElementById("installation-id");
const copyButton=document.getElementById("copy");
const modeElement=document.getElementById("bridge-mode");
const vaultOnceButton=document.getElementById("vault-once");

const refreshMode=()=>chrome.runtime.sendMessage({type:"creator-os-inspection-status"},(response)=>{
  const mode=chrome.runtime.lastError||!response?.ok?null:response.mode;
  modeElement.textContent=mode==="inspection"
    ?"Inspection mode · no sends, uploads or automatic collection"
    :mode==="vault_once"
      ?"One manual vault upload armed · sends and collection disabled"
      :mode==="active"
        ?"Active bridge · existing paired profile"
        :"Bridge mode unavailable — do not upload.";
  vaultOnceButton.hidden=mode!=="inspection"&&mode!=="vault_once";
  vaultOnceButton.textContent=mode==="vault_once"?"Cancel vault test":"Arm one manual vault upload";
});
vaultOnceButton.addEventListener("click",()=>{
  vaultOnceButton.disabled=true;
  const type=vaultOnceButton.textContent==="Cancel vault test"?"creator-os-vault-once-cancel":"creator-os-vault-once-arm";
  chrome.runtime.sendMessage({type},(response)=>{
    vaultOnceButton.disabled=false;
    if(chrome.runtime.lastError||!response?.ok)modeElement.textContent=response?.error||"Vault test mode could not be changed.";
    else refreshMode();
  });
});
refreshMode();

async function installationId(){
  const stored=await chrome.storage.local.get("creatorOsInstallationId");
  if(stored.creatorOsInstallationId)return stored.creatorOsInstallationId;
  const value=crypto.randomUUID();
  await chrome.storage.local.set({creatorOsInstallationId:value});
  return value;
}

installationId().then((value)=>{
  installationIdElement.textContent=value;
  copyButton.addEventListener("click",async()=>{
    await navigator.clipboard.writeText(value);
    copyButton.textContent="Copied";
  });
});
