const installationIdElement=document.getElementById("installation-id");
const copyButton=document.getElementById("copy");

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
