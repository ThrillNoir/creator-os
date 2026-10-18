const getStoredBridge=async()=>{
  const stored=await chrome.storage.local.get("creatorOsBridge");
  return stored.creatorOsBridge?.platform==="fansly"?stored.creatorOsBridge:undefined;
};
const BRIDGE_MODE_KEY="creatorOsBridgeMode";
const VAULT_ARMED_AT_KEY="creatorOsVaultOnceArmedAt";
const VAULT_CONSUMED_KEY="creatorOsVaultOnceConsumed";
const getBridgeMode=async()=>{
  const stored=await chrome.storage.local.get([BRIDGE_MODE_KEY,VAULT_ARMED_AT_KEY,VAULT_CONSUMED_KEY,"creatorOsBridge"]);
  if(stored[BRIDGE_MODE_KEY]==="active"||stored[BRIDGE_MODE_KEY]==="inspection")return stored[BRIDGE_MODE_KEY];
  if(stored[BRIDGE_MODE_KEY]==="vault_once"){
    const armedAt=Number(stored[VAULT_ARMED_AT_KEY]||0);
    if(armedAt>0&&Date.now()-armedAt<10*60*1000&&!(stored[VAULT_CONSUMED_KEY]&&!vaultUploadRunning))return "vault_once";
  }
  const mode=stored[BRIDGE_MODE_KEY]==="vault_once"?"inspection":stored.creatorOsBridge?.platform==="fansly"&&stored.creatorOsBridge?.token?"active":"inspection";
  await chrome.storage.local.set({[BRIDGE_MODE_KEY]:mode,[VAULT_ARMED_AT_KEY]:0,[VAULT_CONSUMED_KEY]:false});
  return mode;
};
const isInspectionMode=async()=>await getBridgeMode()!=="active";
const isVaultUploadBlocked=async()=>!["active","vault_once"].includes(await getBridgeMode());
const setStoredBridge=(config)=>chrome.storage.local.set({creatorOsBridge:config});
const removeStoredBridge=()=>chrome.storage.local.remove("creatorOsBridge");
const getInstallationId=async()=>{
  const stored=await chrome.storage.local.get("creatorOsInstallationId");
  if(stored.creatorOsInstallationId)return stored.creatorOsInstallationId;
  const installationId=crypto.randomUUID();
  await chrome.storage.local.set({creatorOsInstallationId:installationId});
  return installationId;
};
const CLOUD_VAULT_BRIDGE="https://thot-os-vault-bridge-staging.thot-os.workers.dev";
const bridgeRequest=(config,path,init={})=>fetch(`${CLOUD_VAULT_BRIDGE}${path}`,{
  ...init,
  headers:{authorization:`Bearer ${config.token}`,"x-thot-os-installation-id":config.installationId,...(init.headers||{})},
});
const messageBridgeRequest=(config,path,init={})=>bridgeRequest(config,`/messages${path}`,{...init,headers:{"x-thot-os-message-client":"explicit-v5",...(init.headers||{})}});
const markBridgeUpdateRequired=async(response)=>{
  if(response.status!==428)return false;
  const detail=await response.json().catch(()=>({}));
  await chrome.storage.local.set({creatorOsBridgeNotice:{kind:"update_required",message:detail?.error||"Update the THOT OS bridge extension to sync or send messages."}});
  return true;
};
const clearBridgeNotice=()=>chrome.storage.local.remove("creatorOsBridgeNotice");
const waitForTab=(tabId,timeoutMs=15000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error("Fansly page load timed out."));},timeoutMs);
  const listener=(changedTabId,changeInfo,tab)=>{
    if(changedTabId!==tabId||changeInfo.status!=="complete")return;
    clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve(tab.url);
  };
  chrome.tabs.onUpdated.addListener(listener);
});

chrome.tabs.onUpdated.addListener(async(tabId,changeInfo,tab)=>{
  const url=changeInfo.url||tab.url||"";
  if(!/^https:\/\/thot-os-vault-bridge-staging\.thot-os\.workers\.dev\/pair(?:#|$)/.test(url)||!url.includes("creator_os_bridge_pair="))return;
  try{
    await getBridgeMode();
    const parsed=new URL(url);
    const parameters=new URLSearchParams(parsed.hash.slice(1));
    const token=parameters.get("creator_os_bridge_pair");
    const next=parameters.get("next");
    if(!token||parameters.get("platform")!=="fansly"||!next)return;
    const destination=new URL(next);
    if(destination.origin!=="https://fansly.com")throw new Error("Untrusted Fansly pairing destination");
    const installationId=await getInstallationId();
    const response=await fetch(`${CLOUD_VAULT_BRIDGE}/status`,{headers:{authorization:`Bearer ${token}`,"x-thot-os-installation-id":installationId}});
    if(!response.ok)throw new Error("Fansly pairing failed");
    const identity=await response.json();
    await setStoredBridge({platform:"fansly",creatorId:identity.creator_id,accountId:identity.account_id,profileId:identity.profile_id,installationId,token});
    await chrome.tabs.update(tabId,{url:destination.href});
  }catch(error){console.error("THOT OS bridge: Fansly pairing failed",error);}
});

const claim=async()=>{
  const stored=await getStoredBridge();
  if(stored?.token)return stored;
  throw new Error("Open and pair Fansly from THOT OS again.");
};

const snapshotPage = () => {
  const clean = (value,max=500) => String(value ?? "").replace(/\s+/g," ").trim().slice(0,max);
  const normaliseThreadId = (value) => {
    if(!value)return "";
    try { return new URL(value,location.origin).pathname.replace(/\/+$/,""); }
    catch { return String(value||"").split(/[?#]/)[0].replace(/\/+$/,""); }
  };
  const participantLabel = (link) => {
    const raw = clean(link.getAttribute("aria-label") || link.textContent,500);
    const handle = raw.match(/@[a-z0-9_.-]+/i)?.[0];
    if (handle) return handle;
    return clean(raw.split(/Edit User Notes|Add to List|Block user|Mark as read|Search/i)[0],80) || "Conversation";
  };
  const links = Array.from(document.querySelectorAll("a[href]"));
  const threadLinks = links.filter((link) => {
    const href = normaliseThreadId(link.getAttribute("href") || "");
    return /^\/messages\/[^/]+$/.test(href);
  }).slice(0,100);
  const threads = [];
  const seen = new Set();
  for (const link of threadLinks) {
    const href = normaliseThreadId(link.getAttribute("href") || "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    threads.push({externalThreadId:href,participantName:participantLabel(link),unreadCount:link.querySelector('[class*="unread"], [aria-label*="unread" i]') ? 1 : 0,messages:[]});
  }
  const currentThread = normaliseThreadId(location.pathname.match(/\/messages\/[^/?#]+/)?.[0]);
  if (currentThread) {
    const candidateSelector = ".message-text";
    const excluded = /MessagesMark as read|Mark all your messages as read|Search conversations|Edit User Notes|Add to List|Block user|SubscribersVIP|Upload NewFrom Vault|^Message\s+@|^Messages$/i;
    const dateOnly = /^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{1,2}:\d{2}|Today,?\s+\d{1,2}:\d{2}|Yesterday,?\s+\d{1,2}:\d{2}|\d+\s*[shmd])$/i;
    const candidates = Array.from(document.querySelectorAll(candidateSelector)).filter((node) => {
      const text = clean(node.textContent,20000);
      const nested = Array.from(node.querySelectorAll(candidateSelector)).some((child) => clean(child.textContent,20000) === text);
      return text.length > 1 && text.length <= 1500 && !excluded.test(text) && !dateOnly.test(text) && !nested && !node.querySelector('input[type="password"]');
    }).sort((left,right)=>left.getBoundingClientRect().top-right.getBoundingClientRect().top).slice(-200);
    const normaliseMessageBody = (value) => clean(value,1500)
      .replace(/Do you want to Delete this message\?/gi,"")
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{1,2}:\d{2}\b/gi,"")
      .replace(/\b(?:Today|Yesterday),?\s+\d{1,2}:\d{2}\b/gi,"")
      .replace(/\s+\d+\s*[shmd]\s*$/i,"")
      .replace(/\s+/g," ").trim();
    const occurrenceBySignature=new Map();
    const rawMessages = candidates.map((node) => {
      const classes = [node,...Array.from({length:4},(_,index) => {
        let parent = node.parentElement;
        for (let step=0;step<index;step++) parent=parent?.parentElement;
        return parent;
      }).filter(Boolean)].map((element) => String(element.className || "")).join(" ");
      const positionedBubble = node.closest(".message-text-wrapper") || node.closest(".message-wrapper") || node;
      const rect = positionedBubble.getBoundingClientRect();
      const bubbleStyle = getComputedStyle(positionedBubble);
      const alignedToEnd = /flex-end|end|right/.test(`${bubbleStyle.justifyContent} ${bubbleStyle.alignSelf}`);
      const visuallyOutgoing = alignedToEnd || (rect.width > 0 && rect.width < window.innerWidth * 0.8 && rect.left + rect.width / 2 > window.innerWidth * 0.58);
      const fanslyMessageGroup = node.closest("app-group-message");
      const direction = fanslyMessageGroup ? (fanslyMessageGroup.classList.contains("my-message") ? "outbound" : "inbound") : (visuallyOutgoing ? "outbound" : "inbound");
      const body = normaliseMessageBody(node.textContent);
      if (!body || excluded.test(body) || dateOnly.test(body)) return null;
      const signature=`${direction}\u0000${body}`;
      const occurrence=(occurrenceBySignature.get(signature)??0)+1;
      occurrenceBySignature.set(signature,occurrence);
      const syntheticId=`${currentThread}-${direction}-${body}${occurrence===1?"":`-${occurrence}`}`;
      return {externalMessageId:clean(node.getAttribute("data-message-id") || syntheticId,500),direction,senderType:direction === "outbound" ? "creator" : "fan",body};
    }).filter(Boolean);
    const messages=Array.from(new Map(rawMessages.map((message)=>[message.externalMessageId,message])).values());
    const existing = threads.find((thread) => thread.externalThreadId === currentThread);
    if (existing) Object.assign(existing,{messages,observedOpen:true});
    else threads.unshift({externalThreadId:currentThread,participantName:"",unreadCount:0,messages,observedOpen:true});
  }
  return threads;
};

const sendPreparedMessage = async (body) => {
  const visible = (element) => {const rect=element.getBoundingClientRect();const style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.visibility!=="hidden"&&style.display!=="none";};
  const pageHidden=document.visibilityState!=="visible";
  const enabled = (element,allowBackground=false) => (visible(element)||(pageHidden&&allowBackground))&&!element.disabled&&!element.classList.contains("disabled")&&element.getAttribute("aria-disabled")!=="true";
  const uniqueElements = (elements) => Array.from(new Set(elements.filter(Boolean)));
  const exactFanslyComposers=Array.from(document.querySelectorAll("textarea.message-input")).filter((element)=>!element.disabled&&element.getAttribute("aria-disabled")!=="true");
  const visibleComposers=Array.from(document.querySelectorAll('textarea,[contenteditable="true"]')).filter((element)=>{
    const label=`${element.getAttribute("aria-label")||""} ${element.getAttribute("placeholder")||""}`;
    return visible(element)&&!/search/i.test(label)&&element.getBoundingClientRect().width>150;
  });
  const composers=exactFanslyComposers.length===1?exactFanslyComposers:visibleComposers;
  if(composers.length!==1)return {sent:false,error:`Expected one visible message composer; found ${composers.length}.`};
  const composer=composers[0];
  composer.focus();
  if(composer instanceof HTMLTextAreaElement){
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
    setter?.call(composer,body);
  }else composer.textContent=body;
  composer.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:body}));
  composer.dispatchEvent(new Event("change",{bubbles:true}));
  const findSendControls=()=>{
    const labelledButtons=Array.from(document.querySelectorAll('button,[role="button"]')).filter((button)=>{
      if(!enabled(button))return false;
      const label=`${button.getAttribute("aria-label")||""} ${button.getAttribute("title")||""} ${button.textContent||""}`.replace(/\s+/g," ").trim();
      return /^(send|send message)$/i.test(label);
    });
    const fanslyHosts=Array.from(document.querySelectorAll("app-button.send-button.can-send,.send-button.can-send")).filter((button)=>enabled(button,true));
    const fanslyIconHosts=Array.from(document.querySelectorAll('i.fa-paper-plane-top,i.fa-paper-plane,i[class*="paper-plane"]')).map((icon)=>icon.closest("app-button.send-button.can-send,.send-button.can-send,button,[role=button]")).filter((button)=>enabled(button,true));
    return uniqueElements([...labelledButtons,...fanslyHosts,...fanslyIconHosts]);
  };
  let buttons=[];
  const sendControlDeadline=Date.now()+5000;
  while(Date.now()<sendControlDeadline){
    buttons=findSendControls();
    if(buttons.length===1)break;
    if(buttons.length>1)break;
    await new Promise((resolve)=>setTimeout(resolve,200));
  }
  if(buttons.length!==1)return {sent:false,error:`Draft filled but expected one Send control; found ${buttons.length}.`};
  const outgoingSelector="app-group-message.my-message .message-text,.message-wrapper.my-message .message-text";
  const outgoingBefore=document.querySelectorAll(outgoingSelector).length;
  buttons[0].click();
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){
    const composerCleared=String(composer instanceof HTMLTextAreaElement?composer.value:composer.textContent||"").trim().length===0;
    const outgoingAfter=document.querySelectorAll(outgoingSelector).length;
    if(composerCleared&&outgoingAfter>outgoingBefore)return {sent:true,composerCount:1,sendControlCount:1,composerCleared:true,outgoingBubbleAdded:true};
    await new Promise((resolve)=>setTimeout(resolve,300));
  }
  return {sent:false,error:"Fansly did not confirm the native send. Check the live conversation before retrying.",composerCount:1,sendControlCount:1,composerCleared:String(composer instanceof HTMLTextAreaElement?composer.value:composer.textContent||"").trim().length===0,outgoingBubbleAdded:document.querySelectorAll(outgoingSelector).length>outgoingBefore};
};

const processOutbox = async (tabId,url,config) => {
  if(await isInspectionMode())return;
  const activeThread=new URL(url).pathname.replace(/\/+$/,"/");
  const response=await messageBridgeRequest(config,`/outbox?thread=${encodeURIComponent(activeThread)}`);
  if(await markBridgeUpdateRequired(response))return;
  if(!response.ok)return;
  await clearBridgeNotice();
  const {job}=await response.json();
  if(!job)return;
  if(await isInspectionMode())return;
  const executed=await chrome.scripting.executeScript({target:{tabId},func:sendPreparedMessage,args:[job.body]});
  const receipt=executed?.[0]?.result??{sent:false,error:"No browser execution receipt."};
  await messageBridgeRequest(config,"/outbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:job.id,claimToken:job.claimToken,sent:Boolean(receipt.sent),error:receipt.error,receipt})});
};

const prepareFanslyVault = async () => {
  const visible=(element)=>{
    const rect=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return rect.width>0&&rect.height>0&&style.display!=="none"&&style.visibility!=="hidden";
  };
  const findMediaInputs=()=>Array.from(document.querySelectorAll('input[type="file"]')).filter((input)=>!input.disabled).filter((input)=>{
    const context=`${input.accept||""} ${input.getAttribute("aria-label")||""} ${input.closest("label")?.textContent||""}`;
    return !/avatar|profile|cover|banner/i.test(context)&&(!input.accept||/image|video|\.jpg|\.jpeg|\.png|\.webp|\.heic|\.mp4|\.mov/i.test(input.accept));
  });
  const clean=(value)=>String(value||"").replace(/\s+/g," ").trim();
  let clickedAlbum=false;
  let clickedUpload=false;
  let clickedPlus=false;
  let diagnostic={albumTileCount:0,allAlbumTileCount:0,uploadChoiceCount:0,plusControlCount:0};
  for(let attempt=0;attempt<60;attempt++){
    const mediaInputs=findMediaInputs();
    if(mediaInputs.length===1)return {ready:true,receipt:{...diagnostic,clickedAlbum,clickedUpload,clickedPlus,url:location.href}};
    if(mediaInputs.length>1)return {ready:false,error:`Fansly exposed ${mediaInputs.length} media inputs; refusing an ambiguous upload.`,receipt:{...diagnostic,url:location.href}};
    const albumTiles=Array.from(document.querySelectorAll(".vault-album-media.drag-surface")).filter(visible);
    const allAlbumTiles=albumTiles.filter((tile)=>/^All$/i.test(clean(tile.closest(".vault-album")?.querySelector(".vault-album-footer .semi-bold")?.textContent)));
    const uploadChoices=Array.from(document.querySelectorAll(".close-toggle")).filter((control)=>/^Upload to Vault$/i.test(clean(control.textContent))&&control.querySelector("i.fa-upload")&&visible(control));
    const plusControls=Array.from(document.querySelectorAll("i.fa-fw.fal.fa-plus")).filter(visible);
    diagnostic={albumTileCount:albumTiles.length,allAlbumTileCount:allAlbumTiles.length,uploadChoiceCount:uploadChoices.length,plusControlCount:plusControls.length};
    if(plusControls.length===1&&!clickedPlus){plusControls[0].click();clickedPlus=true;}
    else if(uploadChoices.length===1&&!clickedUpload){uploadChoices[0].click();clickedUpload=true;}
    else if(allAlbumTiles.length===1&&!clickedAlbum){allAlbumTiles[0].click();clickedAlbum=true;}
    await new Promise((resolve)=>setTimeout(resolve,250));
  }
  return {ready:false,error:"Fansly did not expose one media input after the native vault sequence.",receipt:{...diagnostic,clickedAlbum,clickedUpload,clickedPlus,url:location.href}};
};

const readFanslyVaultState = () => {
  const uploadInput=document.querySelector('app-media-upload-input input[type="file"]');
  const uploadContainer=uploadInput?.closest("app-media-upload-input");
  const savedMediaIds=Array.from(document.querySelectorAll("app-media-vault app-media[data-media-id]"))
    .map((element)=>element.getAttribute("data-media-id")).filter(Boolean);
  return {savedMediaIds,uploadTileCount:uploadContainer?.querySelectorAll("app-account-media-create-template").length||0};
};

const verifyFanslyVaultAttachment = async (filename,baseline) => {
  const findMediaInputs=()=>Array.from(document.querySelectorAll('input[type="file"]')).filter((input)=>!input.disabled).filter((input)=>{
    const context=`${input.accept||""} ${input.getAttribute("aria-label")||""} ${input.closest("label")?.textContent||""}`;
    return !/avatar|profile|cover|banner/i.test(context)&&(!input.accept||/image|video|\.jpg|\.jpeg|\.png|\.webp|\.heic|\.mp4|\.mov/i.test(input.accept));
  });
  const baselineIds=new Set(Array.isArray(baseline?.savedMediaIds)?baseline.savedMediaIds:[]);
  const baselineTileCount=Number(baseline?.uploadTileCount||0);
  let previewObserved=false;
  for(let attempt=0;attempt<480;attempt++){
    const mediaInputs=findMediaInputs();
    if(mediaInputs.length!==1)return {status:"failed",error:`Expected one native Fansly media input; found ${mediaInputs.length}.`,receipt:{mediaInputCount:mediaInputs.length,url:location.href}};
    const input=mediaInputs[0];
    const container=input.closest("app-media-upload-input")||input.parentElement;
    const retained=input.files?.length===1&&input.files[0]?.name===filename;
    const tiles=container?Array.from(container.querySelectorAll("app-account-media-create-template")):[];
    const newTiles=tiles.slice(Math.min(baselineTileCount,tiles.length));
    const healthyPreviews=newTiles.flatMap((tile)=>Array.from(tile.querySelectorAll("img,video"))).filter((media)=>media instanceof HTMLVideoElement?media.readyState>=2:media.complete&&media.naturalWidth>0);
    if(retained||healthyPreviews.length>0||tiles.length>baselineTileCount)previewObserved=true;
    const savedMediaIds=Array.from(document.querySelectorAll("app-media-vault app-media[data-media-id]"))
      .map((element)=>element.getAttribute("data-media-id")).filter(Boolean);
    const externalMediaId=savedMediaIds.find((mediaId)=>!baselineIds.has(mediaId));
    if(externalMediaId)return {status:"staged",receipt:{filename,inputAccepted:true,inputRetained:retained,previewObserved,savedVaultRecord:true,externalMediaId,savedMediaCount:savedMediaIds.length,url:location.href}};
    await new Promise((resolve)=>setTimeout(resolve,250));
  }
  return {status:"failed",error:"Fansly did not create a saved vault record for the approved file within two minutes.",receipt:{filename,previewObserved,url:location.href}};
};

const waitForDownload=(downloadId,timeoutMs=120000)=>new Promise((resolve,reject)=>{
  const finish=(download,error)=>{clearTimeout(timer);chrome.downloads.onChanged.removeListener(listener);if(error)reject(error);else resolve(download);};
  const read=()=>chrome.downloads.search({id:downloadId}).then(([download])=>{
    if(download?.state==="complete"&&download.filename)return finish(download);
    if(download?.state==="interrupted")return finish(undefined,new Error(`Chrome could not download the approved media (${download.error||"interrupted"}).`));
  }).catch((error)=>finish(undefined,error));
  const listener=(delta)=>{if(delta.id===downloadId&&(delta.state||delta.error))read();};
  const timer=setTimeout(()=>finish(undefined,new Error("Chrome did not finish downloading the approved media within two minutes.")),timeoutMs);
  chrome.downloads.onChanged.addListener(listener);read();
});
const discardBridgeDownload=async(downloadId)=>{
  if(!downloadId)return;
  await chrome.downloads.removeFile(downloadId).catch(()=>{});
  await chrome.downloads.erase({id:downloadId}).catch(()=>{});
};
const downloadBridgeMedia=async(config,job)=>{
  const basename=String(job.basename||"approved-media").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").slice(-140);
  const jobId=String(job.id||"approved-job").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").slice(-100);
  const downloadId=await chrome.downloads.download({
    url:job.mediaUrl,
    filename:`THOT OS Bridge/${jobId}-${basename}`,
    conflictAction:"overwrite",saveAs:false,
    headers:[{name:"Authorization",value:`Bearer ${config.token}`},...(config.installationId?[{name:"X-THOT-OS-Installation-ID",value:config.installationId}]:[])],
  });
  try{
    const download=await waitForDownload(downloadId);
    return {downloadId,localMediaPath:download.filename,downloadBytes:Number(download.fileSize||job.bytes||0)};
  }catch(error){
    await discardBridgeDownload(downloadId);
    throw error;
  }
};
const attachLocalFileToNativeInput=async(tabId,localMediaPath,ensureActive=async()=>{})=>{
  const target={tabId};
  let attached=false;
  try{
    await ensureActive();
    await chrome.debugger.attach(target,"1.3");attached=true;
    await chrome.debugger.sendCommand(target,"DOM.enable");
    const remote=await chrome.debugger.sendCommand(target,"Runtime.evaluate",{
      expression:`(()=>{const roots=[document],seen=new Set();for(let i=0;i<roots.length;i++){for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot);}}const inputs=roots.flatMap(root=>Array.from(root.querySelectorAll('input[type="file"]'))).filter(input=>{if(input.disabled)return false;const context=(input.accept||'')+' '+(input.getAttribute('aria-label')||'')+' '+(input.closest('label')?.textContent||'');return !/avatar|profile|cover|banner/i.test(context)&&(!input.accept||/image|video|\\.jpg|\\.jpeg|\\.png|\\.webp|\\.heic|\\.mp4|\\.mov/i.test(input.accept));});return inputs.length===1?inputs[0]:null;})()`,
      returnByValue:false,
    });
    if(!remote?.result?.objectId)throw new Error("Fansly did not expose exactly one active native media input.");
    await ensureActive();
    await chrome.debugger.sendCommand(target,"DOM.setFileInputFiles",{files:[localMediaPath],objectId:remote.result.objectId});
  }finally{if(attached)await chrome.debugger.detach(target).catch(()=>{});}
};

let vaultUploadRunning=false;
const vaultPlatformForUrl=(url)=>{
  const parsed=new URL(url);
  return parsed.hostname==="fansly.com"&&/\/(?:vault|media)(?:\/|$)/i.test(parsed.pathname);
};
const processVaultQueue=async(tabId,url)=>{
  const initialMode=await getBridgeMode();
  if(initialMode!=="active"&&initialMode!=="vault_once")return {ok:false,state:"inspection_mode",error:"Inspection mode blocks uploads. No job was claimed."};
  if(!vaultPlatformForUrl(url))return {ok:false,state:"wrong_page",error:"Open the Fansly vault first."};
  if(vaultUploadRunning)return {ok:false,state:"busy",error:"A vault upload is already in progress."};
  vaultUploadRunning=true;
  let config,job,uploadStarted=false,inspectionAborted=false;
  const ensureActiveBeforeAttachment=async()=>{
    if(!await isVaultUploadBlocked())return;
    inspectionAborted=true;
    throw new Error("Inspection mode stopped this upload before native attachment.");
  };
  try{
    if(initialMode==="vault_once")await chrome.storage.local.set({[VAULT_CONSUMED_KEY]:true});
    const prepared=await chrome.scripting.executeScript({target:{tabId},func:prepareFanslyVault});
    const preparation=prepared?.[0]?.result??{ready:false,error:"The Fansly preparation step did not return a result."};
    if(!preparation.ready)return {ok:false,state:"not_ready",error:preparation.error,receipt:preparation.receipt};
    config=await claim();
    await ensureActiveBeforeAttachment();
    const response=await bridgeRequest(config,"/jobs/claim",{headers:{"x-thot-os-vault-client":"explicit-v4"}});
    if(response.status===401){await removeStoredBridge();return {ok:false,state:"unpaired",error:"This Chrome profile must be paired again."};}
    if(!response.ok)return {ok:false,state:"bridge_error",error:`THOT OS returned ${response.status}.`};
    const queue=await response.json();
    job=queue.job;
    if(!job)return queue.reconciliationRequired
      ?{ok:false,state:"uncertain",error:"A previous upload may have completed without a receipt. Verify Fansly’s vault before asking an administrator to reconcile it."}
      :{ok:true,state:"empty"};
    await ensureActiveBeforeAttachment();
    const baselineResults=await chrome.scripting.executeScript({target:{tabId},func:readFanslyVaultState});
    const baseline=baselineResults?.[0]?.result;
    if(!baseline)throw new Error("Fansly did not return its saved-vault baseline before attachment.");
    const download=await downloadBridgeMedia(config,job);
    let result;
    try{
      await ensureActiveBeforeAttachment();
      uploadStarted=true;
      await attachLocalFileToNativeInput(tabId,download.localMediaPath,ensureActiveBeforeAttachment);
      const executed=await chrome.scripting.executeScript({target:{tabId},func:verifyFanslyVaultAttachment,args:[job.basename,baseline]});
      result=executed?.[0]?.result??{status:"failed",error:"Fansly did not return an attachment receipt."};
      result.receipt={...(result.receipt??{}),bytes:download.downloadBytes,nativeAttachment:true,uploadStarted:true,
        ...(result.status==="staged"?{}:{outcome:"uncertain",reconciliationRequired:true})};
    }finally{await discardBridgeDownload(download.downloadId);}
    const receiptResponse=await bridgeRequest(config,`/jobs/${encodeURIComponent(job.id)}/receipt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:result.status,error:result.error,receipt:result.receipt})});
    if(!receiptResponse.ok)return {ok:false,state:"receipt_error",error:"The file was handled, but THOT OS could not record the result."};
    const recorded=await receiptResponse.json().catch(()=>null);
    if(recorded?.status==="verified")return {ok:true,state:"staged",filename:job.basename};
    if(recorded?.status==="claimed")return {ok:false,state:"uncertain",error:"Fansly may have saved the file, but Creator OS could not verify the receipt. Check the vault before retrying."};
    return {ok:false,state:"failed",filename:job.basename,error:result.error||"Creator OS did not verify the Fansly receipt."};
  }catch(error){
    const outcomeUncertain=uploadStarted&&!inspectionAborted;
    if(config?.token&&job?.id)await bridgeRequest(config,`/jobs/${encodeURIComponent(job.id)}/receipt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:"failed",error:error instanceof Error?error.message:String(error),receipt:{url,uploadStarted:outcomeUncertain,outcome:outcomeUncertain?"uncertain":"failed",reconciliationRequired:outcomeUncertain}})}).catch(()=>{});
    if(inspectionAborted)return {ok:false,state:"inspection_mode",error:"Inspection mode stopped this upload before native attachment. Check the queued job before retrying."};
    return {ok:false,state:uploadStarted?"uncertain":"failed",error:uploadStarted?"The upload outcome is uncertain. Verify Fansly’s vault before retrying.":error instanceof Error?error.message:String(error)};
  }finally{
    if(initialMode==="vault_once")await chrome.storage.local.set({[BRIDGE_MODE_KEY]:"inspection",[VAULT_ARMED_AT_KEY]:0,[VAULT_CONSUMED_KEY]:false});
    vaultUploadRunning=false;
  }
};

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="creator-os-vault-once-arm"){
    Promise.all([getBridgeMode(),getStoredBridge()]).then(async([mode,bridge])=>{
      if(mode!=="inspection"||!bridge?.token)return {ok:false,error:"Pair this profile and keep it in inspection mode before arming a vault test."};
      await chrome.storage.local.set({[BRIDGE_MODE_KEY]:"vault_once",[VAULT_ARMED_AT_KEY]:Date.now(),[VAULT_CONSUMED_KEY]:false});
      return {ok:true,mode:"vault_once"};
    }).then(sendResponse).catch(()=>sendResponse({ok:false,error:"The vault test could not be armed."}));
    return true;
  }
  if(message?.type==="creator-os-vault-once-cancel"){
    getBridgeMode().then(async(mode)=>{
      if(mode!=="vault_once")return {ok:false,error:"No one-shot vault test is armed."};
      await chrome.storage.local.set({[BRIDGE_MODE_KEY]:"inspection",[VAULT_ARMED_AT_KEY]:0,[VAULT_CONSUMED_KEY]:false});
      return {ok:true,mode:"inspection"};
    }).then(sendResponse).catch(()=>sendResponse({ok:false,error:"The vault test could not be cancelled."}));
    return true;
  }
  if(message?.type==="creator-os-inspection-status"){
    getBridgeMode().then((mode)=>sendResponse({ok:true,mode})).catch(()=>sendResponse({ok:false,mode:"inspection"}));
    return true;
  }
  if(message?.type==="creator-os-vault-status"){
    getBridgeMode().then(async(mode)=>{
      const inspectionMode=mode==="inspection";
      const vaultOnce=mode==="vault_once";
      const config=await getStoredBridge();
      if(!config?.token)return {ok:true,paired:false,inspectionMode,vaultOnce};
      if(inspectionMode)return {ok:true,paired:true,inspectionMode,vaultOnce,creatorId:config.creatorId,accountId:config.accountId};
      try{
        const response=await bridgeRequest(config,"/status",{headers:{"x-thot-os-message-client":"explicit-v5"}});
        const detail=await response.json().catch(()=>({}));
        const storedNotice=await chrome.storage.local.get("creatorOsBridgeNotice");
        if(response.status===401)return {ok:true,paired:false,inspectionMode,vaultOnce};
        if(!response.ok)return {ok:true,paired:true,inspectionMode,vaultOnce,creatorId:config.creatorId,accountId:config.accountId,bridgeError:detail?.error||`THOT OS returned ${response.status}.`};
        return {ok:true,paired:true,inspectionMode,vaultOnce,creatorId:config.creatorId,accountId:config.accountId,updateRequired:Boolean(detail?.messageClientUpdateRequired||storedNotice?.creatorOsBridgeNotice?.kind==="update_required"),legacyReconciliationCount:Number(detail?.legacyReconciliationCount||0)};
      }catch(error){return {ok:true,paired:true,inspectionMode,vaultOnce,creatorId:config.creatorId,accountId:config.accountId,bridgeError:error instanceof Error?error.message:"THOT OS status is unavailable."};}
    }).then(sendResponse).catch(()=>sendResponse({ok:false,paired:false,inspectionMode:true}));
    return true;
  }
  if(message?.type!=="creator-os-process-fansly-vault")return;
  if(!sender.tab?.id||!sender.tab.url){sendResponse({ok:false,state:"wrong_page",error:"Chrome could not identify the Fansly vault tab."});return;}
  processVaultQueue(sender.tab.id,sender.tab.url).then(sendResponse).catch((error)=>sendResponse({ok:false,state:"failed",error:error instanceof Error?error.message:String(error)}));
  return true;
});

const backgroundTabIds=new Set();
const syncTab=async(tabId,url,backgroundCollection=false,claimToken="")=>{
  if(await isInspectionMode())return false;
  if(!url.includes("fansly.com/messages"))return false;
  try{
    const config=await claim();
    const readiness=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
      const deadline=Date.now()+12000;
      while(Date.now()<deadline){
        const currentThread=/^\/messages\/[^/]+$/.test(location.pathname.replace(/\/+$/,""));
        const links=Array.from(document.querySelectorAll('a[href]')).some((link)=>{try{return /^\/messages\/[^/]+$/.test(new URL(link.href).pathname.replace(/\/+$/,""));}catch{return false;}});
        if(currentThread?Boolean(document.querySelector("textarea.message-input")):links)return true;
        await new Promise((resolve)=>setTimeout(resolve,600));
      }
      return false;
    }});
    if(!readiness?.[0]?.result)return false;
    const result=await chrome.scripting.executeScript({target:{tabId},func:snapshotPage});
    const threads=result?.[0]?.result??[];
    const response=await messageBridgeRequest(config,"/ingest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({platform:"fansly",threads,...(claimToken?{claimToken}:{})})});
    if(response.status===401){await removeStoredBridge();return false;}
    if(await markBridgeUpdateRequired(response))return false;
    if(response.ok&&!backgroundCollection)await processOutbox(tabId,url,config);
    if(response.ok)await clearBridgeNotice();
    return response.ok;
  }catch(error){console.error("THOT OS bridge: Fansly sync failed",error);return false;}
};

const collectNextPendingThread=async()=>{
  if(await isInspectionMode())return;
  const config=await getStoredBridge();
  if(!config?.token)return;
  let createdTab,pending;
  try{
    const response=await messageBridgeRequest(config,"/pending-threads");
    if(response.status===401){await removeStoredBridge();return;}
    if(await markBridgeUpdateRequired(response))return;
    if(!response.ok)return;
    pending=(await response.json()).thread;
    if(!pending)return;
    createdTab=await chrome.tabs.create({url:new URL(pending.external_thread_id,"https://fansly.com").href,active:false});
    if(!createdTab.id)throw new Error("Chrome did not create the collection tab.");
    backgroundTabIds.add(createdTab.id);
    const destination=await waitForTab(createdTab.id,30000);
    await new Promise((resolve)=>setTimeout(resolve,2200));
    if(!await syncTab(createdTab.id,destination,true,pending.claimToken))throw new Error("The conversation did not synchronise.");
  }catch(error){
    if(pending?.id)await messageBridgeRequest(config,"/pending-threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({threadId:pending.id,claimToken:pending.claimToken,error:error instanceof Error?error.message:String(error)})}).catch(()=>{});
  }finally{
    if(createdTab?.id){backgroundTabIds.delete(createdTab.id);await chrome.tabs.remove(createdTab.id).catch(()=>{});}
  }
};

let fanslyMessageOutboxRunning=false;
const processFanslyMessageOutbox=async()=>{
  if(await isInspectionMode())return {ok:false,state:"inspection_mode"};
  if(fanslyMessageOutboxRunning)return {ok:false,state:"busy"};
  fanslyMessageOutboxRunning=true;
  let createdTab;
  try{
    const config=await getStoredBridge();
    if(!config?.token)return {ok:false,state:"unpaired"};
    const response=await messageBridgeRequest(config,"/outbox/next");
    if(response.status===401){await removeStoredBridge();return {ok:false,state:"unpaired"};}
    if(await markBridgeUpdateRequired(response))return {ok:false,state:"update_required",error:"Update the THOT OS bridge extension to sync or send messages."};
    if(!response.ok)return {ok:false,state:"bridge_error"};
    const job=(await response.json()).job;
    if(!job?.externalThreadId)return {ok:true,state:"empty"};
    const destination=new URL(job.externalThreadId,"https://fansly.com").href;
    const existingTabs=await chrome.tabs.query({url:"https://fansly.com/messages/*"});
    const expectedPath=new URL(destination).pathname.replace(/\/+$/,"");
    const existing=existingTabs.find((tab)=>tab.id&&tab.url&&new URL(tab.url).pathname.replace(/\/+$/ ,"")===expectedPath);
    if(existing?.id){
      const ok=await syncTab(existing.id,destination,false);
      return {ok,state:ok?"processed":"failed",jobId:job.id};
    }
    createdTab=await chrome.tabs.create({url:destination,active:false});
    if(!createdTab.id)throw new Error("Chrome did not create the Fansly send tab.");
    backgroundTabIds.add(createdTab.id);
    await waitForTab(createdTab.id,30000);
    const ok=await syncTab(createdTab.id,destination,false);
    return {ok,state:ok?"processed":"failed",jobId:job.id};
  }catch(error){
    console.error("THOT OS collector: automatic Fansly send failed",error);
    return {ok:false,state:"failed",error:error instanceof Error?error.message:String(error)};
  }finally{
    if(createdTab?.id){backgroundTabIds.delete(createdTab.id);await chrome.tabs.remove(createdTab.id).catch(()=>{});}
    fanslyMessageOutboxRunning=false;
  }
};


chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
  if(changeInfo.status==="complete"&&tab.url&&!backgroundTabIds.has(tabId))syncTab(tabId,tab.url);
});
const syncOpenMessageTabs=async()=>{
  if(await isInspectionMode())return;
  const tabs=await chrome.tabs.query({url:["https://fansly.com/messages","https://fansly.com/messages/*"]});
  for(const tab of tabs)if(tab.id&&tab.url)await syncTab(tab.id,tab.url);
};
let fanslyFeedSyncRunning=false;
const syncFanslyFeed=async()=>{
  if(await isInspectionMode())return;
  if(fanslyFeedSyncRunning)return;
  fanslyFeedSyncRunning=true;
  try{
    const tabs=await chrome.tabs.query({url:["https://fansly.com/messages","https://fansly.com/messages/*"]});
    const conversationTabs=tabs.filter((tab)=>tab.id&&tab.url&&/^\/messages\/[^/]+$/.test(new URL(tab.url).pathname.replace(/\/+$/, ""))).sort((left,right)=>Number(right.lastAccessed??0)-Number(left.lastAccessed??0));
    const currentConversation=conversationTabs[0];
    if(currentConversation?.id&&currentConversation.url)await syncTab(currentConversation.id,currentConversation.url,true);
    const listTab=tabs.find((tab)=>tab.id&&tab.url&&new URL(tab.url).pathname.replace(/\/+$/, "")==="/messages");
    if(listTab?.id&&listTab.url){
      const state=await chrome.storage.local.get("creatorOsFanslyListSyncedAt");
      const elapsed=Date.now()-Number(state.creatorOsFanslyListSyncedAt??0);
      if(elapsed>=115000){
        const ok=await syncTab(listTab.id,listTab.url,true);
        if(ok)await chrome.storage.local.set({creatorOsFanslyListSyncedAt:Date.now()});
      }
    }
  }catch(error){
    console.error("THOT OS collector: Fansly feed refresh failed",error);
  }finally{
    fanslyFeedSyncRunning=false;
  }
};


const runFanslyJobs=async()=>{
  if(await isInspectionMode())return [];
  return Promise.allSettled([processFanslyMessageOutbox(),syncFanslyFeed(),collectNextPendingThread()]);
};
const createBridgeAlarms=async()=>{
  if(await isInspectionMode())return;
  chrome.alarms.create("thot-os-fansly-sync",{periodInMinutes:0.5});
};
chrome.runtime.onInstalled.addListener(()=>{createBridgeAlarms();syncOpenMessageTabs();});
chrome.runtime.onStartup.addListener(()=>{createBridgeAlarms();syncOpenMessageTabs();});
chrome.alarms.onAlarm.addListener((alarm)=>{if(alarm.name==="thot-os-fansly-sync")runFanslyJobs();});
createBridgeAlarms();
runFanslyJobs();
