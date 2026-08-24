const getStoredBridge=async(platform)=>{
  const stored=await chrome.storage.local.get(["creatorOsBridges","creatorOsBridge"]);
  const configured=stored.creatorOsBridges?.[platform];
  if(configured)return configured;
  const legacy=stored.creatorOsBridge;
  return legacy&&(!legacy.platform||legacy.platform===platform)?legacy:undefined;
};
const setStoredBridge=async(config)=>{
  const stored=await chrome.storage.local.get("creatorOsBridges");
  await chrome.storage.local.set({creatorOsBridges:{...(stored.creatorOsBridges??{}),[config.platform]:config}});
};
const removeStoredBridge=async(platform)=>{
  const stored=await chrome.storage.local.get(["creatorOsBridges","creatorOsBridge"]);
  const bridges={...(stored.creatorOsBridges??{})};
  if(bridges[platform])bridges[platform]={...bridges[platform],token:""};
  await chrome.storage.local.set({creatorOsBridges:bridges});
  if(stored.creatorOsBridge&&(!stored.creatorOsBridge.platform||stored.creatorOsBridge.platform===platform))await chrome.storage.local.remove("creatorOsBridge");
};
const getInstallationId=async()=>{
  const stored=await chrome.storage.local.get("creatorOsInstallationId");
  if(stored.creatorOsInstallationId)return stored.creatorOsInstallationId;
  const installationId=crypto.randomUUID();
  await chrome.storage.local.set({creatorOsInstallationId:installationId});
  return installationId;
};
const CLOUD_VAULT_BRIDGE="https://thot-os-vault-bridge-staging.thot-os.workers.dev";
const CLOUD_REDDIT_BRIDGE=`${CLOUD_VAULT_BRIDGE}/reddit`;
const bridgeRequest=(config,path,init={})=>fetch(config?.cloud?`${config.apiBase||CLOUD_VAULT_BRIDGE}${path}`:`http://127.0.0.1:3000${path}`,{
  ...init,
  headers:{authorization:`Bearer ${config.token}`,...(config.installationId?{"x-thot-os-installation-id":config.installationId}:{}),...(init.headers||{})},
});
const messageBridgeRequest=(config,path,init={})=>config?.cloud
  ? bridgeRequest(config,`/messages${path}`,init)
  : fetch(`http://127.0.0.1:3000/api/local-bridge${path}`,{...init,headers:{authorization:`Bearer ${config.token}`,...(init.headers||{})}});

const readRedditPageHandle=async()=>{
  for(const endpoint of ["/api/me.json","/user/me/about.json"]){
    try{
      const response=await fetch(endpoint,{credentials:"include",headers:{accept:"application/json"}});
      const payload=await response.json();
      const handle=String(payload?.data?.name||payload?.name||"").trim();
      if(handle)return handle;
    }catch{}
  }
  const collectRoots=()=>{
    const roots=[document],seen=new Set();
    for(let index=0;index<roots.length;index++)for(const element of roots[index].querySelectorAll("*"))if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot);}
    return roots;
  };
  const readFromRoots=()=>{
    const links=collectRoots().flatMap((root)=>Array.from(root.querySelectorAll('a[href*="/user/"]')));
    const handles=links.map((link)=>({
      handle:new URL(link.href,location.origin).pathname.match(/^\/user\/([^/]+)/i)?.[1]||"",
      text:String(link.textContent||"").trim(),
    })).filter(({handle})=>handle);
    const profileLink=handles.find(({text})=>/view profile/i.test(text));
    if(profileLink)return profileLink.handle;
    const counts=new Map();
    for(const {handle} of handles)counts.set(handle,(counts.get(handle)||0)+1);
    return [...counts.entries()].sort((left,right)=>right[1]-left[1])[0]?.[0]||"";
  };
  const initial=readFromRoots();
  const menuButton=collectRoots().flatMap((root)=>Array.from(root.querySelectorAll("button"))).find((button)=>/expand user menu/i.test(String(button.getAttribute("aria-label")||button.textContent||"")));
  if(menuButton){
    menuButton.click();
    await new Promise((resolve)=>setTimeout(resolve,750));
    return readFromRoots()||initial;
  }
  return initial;
};

const showRedditPairingError=(message)=>{
  const existing=document.getElementById("thot-os-reddit-pairing-error");if(existing)existing.remove();
  const banner=document.createElement("div");banner.id="thot-os-reddit-pairing-error";banner.textContent=message;
  Object.assign(banner.style,{position:"fixed",zIndex:"2147483647",top:"16px",left:"50%",transform:"translateX(-50%)",maxWidth:"720px",padding:"14px 18px",borderRadius:"12px",background:"#34151d",color:"#fff",font:"600 14px/1.4 system-ui",boxShadow:"0 10px 30px rgba(0,0,0,.35)"});
  document.documentElement.appendChild(banner);
};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || "";
  if(/^https:\/\/thot-os-vault-bridge-staging\.thot-os\.workers\.dev\/pair(?:#|$)/.test(url)&&url.includes("creator_os_bridge_pair=")){
    try{
      const parsed=new URL(url);
      const parameters=new URLSearchParams(parsed.hash.slice(1));
      const token=parameters.get("creator_os_bridge_pair");
      const platform=parameters.get("platform");
      const next=parameters.get("next");
      if(!token||!next||!['fansly','reddit'].includes(platform))return;
      const destination=new URL(next);
      if(platform==='fansly'&&destination.origin!=="https://fansly.com")throw new Error("Untrusted Fansly pairing destination");
      if(platform==='reddit'&&!['https://reddit.com','https://www.reddit.com'].includes(destination.origin))throw new Error("Untrusted Reddit pairing destination");
      const installationId=await getInstallationId();
      const apiBase=platform==='reddit'?CLOUD_REDDIT_BRIDGE:CLOUD_VAULT_BRIDGE;
      const response=await fetch(`${apiBase}/status`,{headers:{authorization:`Bearer ${token}`,"x-thot-os-installation-id":installationId}});
      if(!response.ok)throw new Error(`${platform} pairing failed`);
      const identity=await response.json();
      await chrome.tabs.update(tabId,{url:destination.href});
      await waitForTab(tabId,30000);
      if(platform==='reddit'){
        await new Promise((resolve)=>setTimeout(resolve,1500));
        const observedResult=await chrome.scripting.executeScript({target:{tabId},func:readRedditPageHandle});
        const observed=String(observedResult?.[0]?.result||"").replace(/^u\//i,"").toLowerCase();
        const expected=String(identity.expected_handle||"").replace(/^u\//i,"").replace(/^@/,"").toLowerCase();
        if(!observed||observed!==expected){
          await chrome.scripting.executeScript({target:{tabId},func:showRedditPairingError,args:[`THOT OS did not pair. This browser is signed in as ${observed?`u/${observed}`:"an unreadable Reddit account"}; switch to u/${expected} and open the pairing link again.`]});
          throw new Error(`Reddit browser identity mismatch: ${observed||"unknown"}`);
        }
      }
      await setStoredBridge({platform,creatorId:identity.creator_id,accountId:identity.account_id,profileId:identity.profile_id,installationId,token,cloud:true,apiBase});
    }catch(error){console.error("THOT OS collector: trusted cloud pairing failed",error);}
    return;
  }
  if(/^https:\/\/(?:www\.)?(?:onlyfans\.com|fansly\.com)\//.test(url)&&url.includes("#creator_os_pair=")){
    try{
      const parsed=new URL(url);
      const token=new URLSearchParams(parsed.hash.slice(1)).get("creator_os_pair");
      if(!token)return;
      const response=await fetch(`http://127.0.0.1:3000/api/local-bridge/pair?token=${encodeURIComponent(token)}`,{headers:{accept:"application/json"}});
      if(!response.ok)throw new Error("pairing failed");
      await setStoredBridge(await response.json());
      parsed.hash="";
      await chrome.tabs.update(tabId,{url:parsed.href});
    }catch(error){console.error("Creator OS collector: native pairing failed",error);}
    return;
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3000\/api\/local-bridge\/pair\?/.test(url)) return;
  try {
    const response = await fetch(url,{headers:{accept:"application/json"}});
    if (!response.ok) return;
    const config = await response.json();
    await setStoredBridge(config);
    const destination = config.platform === "onlyfans" ? "https://onlyfans.com/my/chats/" : "https://fansly.com/messages";
    await chrome.tabs.update(tabId,{url:destination});
  } catch { /* Creator OS may be restarting; opening the collector again creates a fresh pairing. */ }
});

chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  if(message?.type==="creator-os-pair-token"&&typeof message.token==="string"){
    fetch(`http://127.0.0.1:3000/api/local-bridge/pair?token=${encodeURIComponent(message.token)}`,{headers:{accept:"application/json"}})
      .then(async(response)=>{if(!response.ok)throw new Error("pairing failed");const config=await response.json();await setStoredBridge(config);sendResponse({ok:true,platform:config.platform});})
      .catch(()=>sendResponse({ok:false}));
    return true;
  }
  if (message?.type !== "creator-os-claim" || !["onlyfans","fansly"].includes(message.platform)) return;
  sendResponse({ok:false,error:"Open Creator OS and start an explicit pairing."});
  return true;
});

const claim = async (platform) => {
  console.info("Creator OS collector: checking authentication",{platform});
  const stored = await getStoredBridge(platform);
  if (stored?.token) return stored;
  throw new Error(`Open and pair ${platform} from Creator OS again.`);
};

const snapshotPage = (platform) => {
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
    return platform === "onlyfans" ? /^\/my\/chats\/chat\/[^/]+$/.test(href) : /^\/messages\/[^/]+$/.test(href);
  }).slice(0,100);
  const threads = [];
  const seen = new Set();
  for (const link of threadLinks) {
    const href = normaliseThreadId(link.getAttribute("href") || "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    threads.push({externalThreadId:href,participantName:participantLabel(link),unreadCount:link.querySelector('[class*="unread"], [aria-label*="unread" i]') ? 1 : 0,messages:[]});
  }
  const currentThread = normaliseThreadId(platform === "onlyfans" ? location.pathname.match(/\/my\/chats\/chat\/[^/?#]+/)?.[0] : location.pathname.match(/\/messages\/[^/?#]+/)?.[0]);
  if (currentThread) {
    const candidateSelector = platform === "fansly"
      ? ".message-text"
      : ".b-chat__message__text-holder";
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
      const positionedBubble = platform === "fansly"
        ? (node.closest(".message-text-wrapper") || node.closest(".message-wrapper") || node)
        : (node.closest(".b-chat__message__text-wrapper") || node.closest(".b-chat__message__text") || node);
      const rect = positionedBubble.getBoundingClientRect();
      const bubbleStyle = getComputedStyle(positionedBubble);
      const alignedToEnd = /flex-end|end|right/.test(`${bubbleStyle.justifyContent} ${bubbleStyle.alignSelf}`);
      const visuallyOutgoing = alignedToEnd || (rect.width > 0 && rect.width < window.innerWidth * 0.8 && rect.left + rect.width / 2 > window.innerWidth * 0.58);
      const fanslyMessageGroup = platform === "fansly" ? node.closest("app-group-message") : null;
      const direction = platform === "fansly"
        ? (fanslyMessageGroup ? (fanslyMessageGroup.classList.contains("my-message") ? "outbound" : "inbound") : (visuallyOutgoing ? "outbound" : "inbound"))
        : (/outgoing|outbound|mine|self|sent/i.test(classes) || visuallyOutgoing ? "outbound" : "inbound");
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
  const activeThread=new URL(url).pathname.replace(/\/+$/,"/");
  const response=await messageBridgeRequest(config,`/outbox?thread=${encodeURIComponent(activeThread)}`);
  if(!response.ok)return;
  const {job}=await response.json();
  if(!job)return;
  const executed=await chrome.scripting.executeScript({target:{tabId},func:sendPreparedMessage,args:[job.body]});
  const receipt=executed?.[0]?.result??{sent:false,error:"No browser execution receipt."};
  await messageBridgeRequest(config,"/outbox",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:job.id,sent:Boolean(receipt.sent),error:receipt.error,receipt})});
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

const stageVaultFile = async (mediaUrl,token,installationId,filename) => {
  const findMediaInputs=()=>Array.from(document.querySelectorAll('input[type="file"]')).filter((input)=>!input.disabled).filter((input)=>{
    const context=`${input.accept||""} ${input.getAttribute("aria-label")||""} ${input.closest("label")?.textContent||""}`;
    return !/avatar|profile|cover|banner/i.test(context)&&(!input.accept||/image|video|\.jpg|\.jpeg|\.png|\.webp|\.heic|\.mp4|\.mov/i.test(input.accept));
  });
  let mediaInputs=findMediaInputs();
  if(mediaInputs.length===0&&location.hostname==="onlyfans.com"){
    const uniqueControls=Array.from(document.querySelectorAll('button#attach_file_photo[aria-label="Add media"]')).filter((control)=>{
      const rect=control.getBoundingClientRect();
      const style=getComputedStyle(control);
      return rect.width>0&&rect.height>0&&rect.bottom>window.innerHeight*0.7&&style.display!=="none"&&style.visibility!=="hidden";
    });
    if(uniqueControls.length!==1)return {status:"failed",error:`Expected one OnlyFans media control; found ${uniqueControls.length}.`,receipt:{mediaControlCount:uniqueControls.length,url:location.href}};
    uniqueControls[0].click();
    await new Promise((resolve)=>setTimeout(resolve,500));
    mediaInputs=findMediaInputs();
  }
  const candidates=Array.from(document.querySelectorAll('input[type="file"]')).filter((input)=>!input.disabled);
  if(mediaInputs.length!==1)return {status:"failed",error:`Expected one native vault media input; found ${mediaInputs.length}.`,receipt:{candidateCount:candidates.length,mediaInputCount:mediaInputs.length,url:location.href}};
  const response=await fetch(mediaUrl,{headers:{authorization:`Bearer ${token}`,"x-thot-os-installation-id":installationId}});
  if(!response.ok)return {status:"failed",error:`Creator OS media download failed with ${response.status}.`,receipt:{url:location.href}};
  const blob=await response.blob();
  const file=new File([blob],filename,{type:blob.type||"application/octet-stream",lastModified:Date.now()});
  const transfer=new DataTransfer();
  transfer.items.add(file);
  const input=mediaInputs[0];
  input.files=transfer.files;
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
  await new Promise((resolve)=>setTimeout(resolve,2500));
  const retained=input.files?.length===1&&input.files[0]?.name===filename;
  return {status:"staged",receipt:{filename,bytes:file.size,type:file.type,inputAccepted:true,inputRetained:retained,url:location.href}};
};

let vaultUploadRunning=false;
const ONLYFANS_STAGING_THREAD="/my/chats/chat/320771405";
const vaultPlatformForUrl=(url)=>{
  const parsed=new URL(url);
  const pathname=parsed.pathname.replace(/\/+$/,"");
  if(parsed.hostname==="onlyfans.com"&&pathname===ONLYFANS_STAGING_THREAD)return "onlyfans";
  if(parsed.hostname==="fansly.com"&&/\/(?:vault|media)(?:\/|$)/i.test(parsed.pathname))return "fansly";
  return null;
};
const processVaultQueue=async(tabId,url)=>{
  const platform=vaultPlatformForUrl(url);
  if(!platform)return {ok:false,state:"wrong_page",error:"Open the configured native upload page first."};
  if(vaultUploadRunning)return {ok:false,state:"busy",error:"A vault upload is already in progress."};
  vaultUploadRunning=true;
  let config,job;
  try{
    if(platform==="fansly"){
      const prepared=await chrome.scripting.executeScript({target:{tabId},func:prepareFanslyVault});
      const preparation=prepared?.[0]?.result??{ready:false,error:"The Fansly preparation step did not return a result."};
      if(!preparation.ready)return {ok:false,state:"not_ready",error:preparation.error,receipt:preparation.receipt};
    }
    config=await claim(platform);
    const response=await bridgeRequest(config,config.cloud?"/jobs/claim":"/api/local-bridge/vault",{headers:config.cloud?{"x-thot-os-vault-client":"explicit-v4"}:{"x-creator-os-vault-client":"explicit-v3"}});
    if(response.status===401){await removeStoredBridge(platform);return {ok:false,state:"unpaired",error:"This Chrome profile must be paired with Creator OS again."};}
    if(!response.ok)return {ok:false,state:"bridge_error",error:`Creator OS returned ${response.status}.`};
    job=(await response.json()).job;
    if(!job)return {ok:true,state:"empty",message:"No approved vault upload is waiting for this creator."};
    console.info("Creator OS collector: staging approved vault asset",{platform,jobId:job.id,filename:job.basename});
    let result;
    if(platform==="fansly"){
      const baselineResults=await chrome.scripting.executeScript({target:{tabId},func:readFanslyVaultState});
      const baseline=baselineResults?.[0]?.result;
      if(!baseline)throw new Error("Fansly did not return its saved-vault baseline before attachment.");
      const download=await downloadBridgeMedia(config,job);
      try{
        await attachLocalFileToNativeInput(tabId,download.localMediaPath,"fansly");
        const executed=await chrome.scripting.executeScript({target:{tabId},func:verifyFanslyVaultAttachment,args:[job.basename,baseline]});
        result=executed?.[0]?.result??{status:"failed",error:"Fansly did not return an attachment receipt after the native file was set."};
        if(result.receipt)result.receipt={...result.receipt,bytes:download.downloadBytes,nativeAttachment:true};
      }finally{await discardBridgeDownload(download.downloadId);}
    }else{
      const executed=await chrome.scripting.executeScript({target:{tabId},func:stageVaultFile,args:[job.mediaUrl,config.token,config.installationId,job.basename]});
      result=executed?.[0]?.result??{status:"failed",error:"No native vault execution receipt."};
    }
    const receiptResponse=await bridgeRequest(config,config.cloud?`/jobs/${encodeURIComponent(job.id)}/receipt`:"/api/local-bridge/vault",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:job.id,status:result.status,error:result.error,receipt:result.receipt})});
    if(!receiptResponse.ok)return {ok:false,state:"receipt_error",error:"The file was handled, but Creator OS could not record the result."};
    return {ok:result.status==="staged",state:result.status,filename:job.basename,error:result.error};
  }catch(error){
    console.error("Creator OS collector: vault staging failed",error);
    if(config?.token&&job?.id)await bridgeRequest(config,config.cloud?`/jobs/${encodeURIComponent(job.id)}/receipt`:"/api/local-bridge/vault",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:job.id,status:"failed",error:error instanceof Error?error.message:String(error),receipt:{url}})}).catch(()=>{});
    return {ok:false,state:"failed",error:error instanceof Error?error.message:String(error)};
  }
  finally{vaultUploadRunning=false;}
};

let redditPublishRunning=false;
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
const attachLocalFileToNativeInput=async(tabId,localMediaPath,platform)=>{
  const target={tabId};
  let attached=false;
  try{
    await chrome.debugger.attach(target,"1.3");attached=true;
    await chrome.debugger.sendCommand(target,"DOM.enable");
    const platformLiteral=JSON.stringify(platform);
    const remote=await chrome.debugger.sendCommand(target,"Runtime.evaluate",{
      expression:`(()=>{const platform=${platformLiteral};const roots=[document],seen=new Set();for(let i=0;i<roots.length;i++){for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot);}}const inputs=roots.flatMap(root=>Array.from(root.querySelectorAll('input[type="file"]'))).filter(input=>{if(input.disabled)return false;if(platform==='reddit'){const host=input.getRootNode()?.host;if(!host||!['POST-COMPOSER-TOOLBAR-BUTTON-IMAGE','R-POST-MEDIA-INPUT'].includes(host.tagName))return false;const rect=host.getBoundingClientRect();const style=getComputedStyle(host);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';}const context=(input.accept||'')+' '+(input.getAttribute('aria-label')||'')+' '+(input.closest('label')?.textContent||'');return !/avatar|profile|cover|banner/i.test(context)&&(!input.accept||/image|video|\\.jpg|\\.jpeg|\\.png|\\.webp|\\.heic|\\.mp4|\\.mov/i.test(input.accept));});return inputs.length===1?inputs[0]:null;})()`,
      returnByValue:false,
    });
    if(!remote?.result?.objectId)throw new Error(`${platform==="fansly"?"Fansly":"Reddit"} did not expose exactly one active native media input.`);
    await chrome.debugger.sendCommand(target,"DOM.setFileInputFiles",{files:[localMediaPath],objectId:remote.result.objectId});
  }finally{if(attached)await chrome.debugger.detach(target).catch(()=>{});}
};
const attachRedditMedia=async(tabId,jobId)=>{
  const stored=await chrome.storage.local.get("creatorOsRedditPending");
  const pending=stored.creatorOsRedditPending;
  if(!pending?.job?.id||pending.job.id!==jobId||pending.tabId!==tabId||!pending.localMediaPath)throw new Error("The approved Reddit media is not bound to this composer tab.");
  await attachLocalFileToNativeInput(tabId,pending.localMediaPath,"reddit");
  await chrome.storage.local.set({creatorOsRedditPending:{...pending,state:"media_attached",mediaAttachedAt:Date.now()}});
  return {ok:true,bytes:pending.downloadBytes||pending.job.bytes||0};
};
const discardRedditDownload=async(jobId)=>{
  const stored=await chrome.storage.local.get("creatorOsRedditPending");
  const pending=stored.creatorOsRedditPending;
  if(pending?.job?.id!==jobId||!pending.downloadId)return;
  await discardBridgeDownload(pending.downloadId);
  await chrome.storage.local.set({creatorOsRedditPending:{...pending,downloadId:undefined,localMediaPath:undefined}});
};
const processRedditQueue=async()=>{
  if(redditPublishRunning)return {ok:false,state:"busy"};
  redditPublishRunning=true;
  let config,job,createdTab;
  try{
    config=await getStoredBridge("reddit");
    if(!config?.token)return {ok:false,state:"unpaired",error:"Pair Adelaide’s Reddit browser from THOT OS first."};
    const pendingState=await chrome.storage.local.get("creatorOsRedditPending");
    const pending=pendingState.creatorOsRedditPending;
    if(pending?.job?.id){
      if(Date.now()-Number(pending.claimedAt||0)<5*60*1000)return {ok:true,state:"pending",jobId:pending.job.id};
      await bridgeRequest(config,`/jobs/${encodeURIComponent(pending.job.id)}/receipt`,{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
          status:"failed",error:"The paired browser did not finish the Reddit composer within five minutes.",
          observedHandle:pending.job.expected_handle,uncertain:pending.state==="submitted",receipt:{state:pending.state||"unknown",url:pending.url||null},
        }),
      }).catch(()=>{});
      await discardRedditDownload(pending.job.id);
      await chrome.storage.local.remove("creatorOsRedditPending");
    }
    const claimResponse=await bridgeRequest(config,"/jobs/claim",{headers:{"x-thot-os-reddit-client":"native-v1"}});
    if(claimResponse.status===401){await removeStoredBridge("reddit");return {ok:false,state:"unpaired",error:"Reddit pairing has expired."};}
    if(!claimResponse.ok)return {ok:false,state:"bridge_error",error:`THOT OS returned ${claimResponse.status}.`};
    job=(await claimResponse.json()).job;
    if(!job)return {ok:true,state:"empty"};
    const download=await downloadBridgeMedia(config,job);
    const pendingJob={job,claimedAt:Date.now(),state:"claimed",...download};
    await chrome.storage.local.set({creatorOsRedditPending:pendingJob});
    createdTab=await chrome.tabs.create({url:`https://www.reddit.com/r/${encodeURIComponent(job.community_name)}/submit?type=IMAGE`,active:false});
    if(!createdTab.id)throw new Error("Chrome did not create the Reddit composer tab.");
    await chrome.storage.local.set({creatorOsRedditPending:{...pendingJob,tabId:createdTab.id,url:createdTab.url}});
    return {ok:true,state:"composer_opened",jobId:job.id};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    console.error("THOT OS collector: native Reddit publishing failed",error);
    if(config?.token&&job?.id){
      await bridgeRequest(config,`/jobs/${encodeURIComponent(job.id)}/receipt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:"failed",error:message,observedHandle:job.expected_handle,receipt:{url:createdTab?.url}})}).catch(()=>{});
      await chrome.storage.local.remove("creatorOsRedditPending");
    }
    return {ok:false,state:"failed",error:message};
  }finally{redditPublishRunning=false;}
};

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="creator-os-reddit-attach"){
    if(!sender.tab?.id||!/^https:\/\/(?:www\.)?reddit\.com\//i.test(sender.tab.url||"")){sendResponse({ok:false,error:"Chrome could not identify the Reddit composer tab."});return;}
    attachRedditMedia(sender.tab.id,String(message.jobId||"")).then(sendResponse).catch((error)=>sendResponse({ok:false,error:error instanceof Error?error.message:String(error)}));
    return true;
  }
  if(message?.type==="creator-os-reddit-discard-download"){
    discardRedditDownload(String(message.jobId||"")).then(()=>sendResponse({ok:true})).catch((error)=>sendResponse({ok:false,error:error instanceof Error?error.message:String(error)}));
    return true;
  }
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="creator-os-vault-status"){
    getStoredBridge("fansly").then((config)=>sendResponse({ok:true,paired:Boolean(config?.token),creatorId:config?.creatorId,accountId:config?.accountId})).catch(()=>sendResponse({ok:false,paired:false}));
    return true;
  }
  if(message?.type!=="creator-os-process-fansly-vault")return;
  if(!sender.tab?.id||!sender.tab.url){sendResponse({ok:false,state:"wrong_page",error:"Chrome could not identify the Fansly vault tab."});return;}
  processVaultQueue(sender.tab.id,sender.tab.url).then(sendResponse).catch((error)=>sendResponse({ok:false,state:"failed",error:error instanceof Error?error.message:String(error)}));
  return true;
});

const syncTab = async (tabId,url,retried=false,backgroundCollection=false) => {
  const platform = url.includes("onlyfans.com/my/chats") ? "onlyfans" : url.includes("fansly.com/messages") ? "fansly" : null;
  if (!platform) return;
  try {
    console.info("Creator OS collector: synchronising tab",{platform,url});
    const config = await claim(platform);
    const delay=(milliseconds)=>new Promise((resolve)=>setTimeout(resolve,milliseconds));
    if(platform==="onlyfans")await delay(1200);
    if(platform==="fansly"){
      const readiness=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
        const deadline=Date.now()+12000;
        let state={ready:false,currentThread:false,threadLinks:0,messageBubbles:0,composer:false};
        while(Date.now()<deadline){
          const currentThread=/^\/messages\/[^/]+$/.test(location.pathname.replace(/\/+$/,""));
          const threadLinks=Array.from(document.querySelectorAll('a[href]')).filter((link)=>{
            try{return /^\/messages\/[^/]+$/.test(new URL(link.getAttribute("href")||"",location.origin).pathname.replace(/\/+$/,""));}
            catch{return false;}
          }).length;
          const messageBubbles=document.querySelectorAll(".message-text").length;
          const composer=Boolean(document.querySelector("textarea.message-input"));
          const messageSurface=Boolean(document.querySelector("app-group-message-container,.message-content-list"));
          state={ready:currentThread?(composer&&messageSurface):threadLinks>0,currentThread,threadLinks,messageBubbles,composer};
          if(state.ready)return state;
          await new Promise((resolve)=>setTimeout(resolve,600));
        }
        return state;
      }});
      console.info("Creator OS collector: Fansly surface readiness",readiness?.[0]?.result??{});
    }
    let result = await chrome.scripting.executeScript({target:{tabId},func:snapshotPage,args:[platform]});
    let threads = result?.[0]?.result ?? [];
    const visibleMessageCount=threads.reduce((sum,thread)=>sum+(thread.messages?.length??0),0);
    if(platform==="onlyfans"&&visibleMessageCount===0){
      await delay(2200);
      result=await chrome.scripting.executeScript({target:{tabId},func:snapshotPage,args:[platform]});
      threads=result?.[0]?.result??threads;
    }
    const response = await messageBridgeRequest(config,"/ingest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({platform,threads})});
    const responseBody = await response.json().catch(() => ({}));
    console.info("Creator OS collector: sync response",{status:response.status,threads:threads.length,response:responseBody});
    if (response.status === 401 && config.cloud) {
      await removeStoredBridge(platform);
      return false;
    }
    if (response.status === 401 && !retried) {
      await removeStoredBridge(platform);
      return await syncTab(tabId,url,true,backgroundCollection);
    }
    if(response.ok&&!backgroundCollection){
      await processOutbox(tabId,url,config);
      setTimeout(()=>collectNextPendingThread(platform).catch((error)=>console.error("Creator OS collector: queue start failed",error)),750);
    }
    return response.ok;
  } catch (error) {
    console.error("Creator OS collector: sync failed",error);
    return false;
  }
};

const rotationRunning=new Set();
const backgroundTabIds=new Set();
const waitForTab = (tabId,timeoutMs=15000) => new Promise((resolve,reject) => {
  const timer=setTimeout(() => {chrome.tabs.onUpdated.removeListener(listener);reject(new Error("Conversation load timed out."));},timeoutMs);
  const listener=(changedTabId,changeInfo,tab) => {
    if(changedTabId!==tabId||changeInfo.status!=="complete")return;
    clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve(tab.url);
  };
  chrome.tabs.onUpdated.addListener(listener);
});

const collectNextPendingThread = async (platform) => {
  if(rotationRunning.has(platform))return;
  rotationRunning.add(platform);
  let createdTab;
  let pending;
  let config;
  try{
    config=await getStoredBridge(platform);
    if(!config?.token||!["onlyfans","fansly"].includes(config.platform)){
      console.warn("Creator OS collector: queue skipped because pairing details are incomplete",{hasToken:Boolean(config?.token),platform:config?.platform});
      return;
    }
    const throttle=await chrome.storage.local.get("creatorOsLastRotationAtByPlatform");
    const timestamps=throttle.creatorOsLastRotationAtByPlatform??{};
    const elapsed=Date.now()-Number(timestamps[platform]??0);
    const rotationInterval=platform==="fansly"?25000:55000;
    if(elapsed<rotationInterval){
      console.info("Creator OS collector: queue waiting for rate limit",{secondsRemaining:Math.ceil((rotationInterval-elapsed)/1000)});
      return;
    }
    await chrome.storage.local.set({creatorOsLastRotationAtByPlatform:{...timestamps,[platform]:Date.now()}});
    console.info("Creator OS collector: checking background queue",{platform:config.platform});
    const response=await messageBridgeRequest(config,"/pending-threads");
    if(response.status===401){await removeStoredBridge(platform);return;}
    if(!response.ok)return;
    pending=(await response.json()).thread;
    if(!pending){console.info("Creator OS collector: background queue is empty",{platform:config.platform});return;}
    console.info("Creator OS collector: collecting queued conversation",{platform:config.platform,threadId:pending.id});
    const origin=config.platform==="onlyfans"?"https://onlyfans.com":"https://fansly.com";
    const destination=new URL(pending.external_thread_id,origin).href;
    createdTab=await chrome.tabs.create({url:destination,active:false});
    if(!createdTab.id)throw new Error("Chrome did not create the collection tab.");
    backgroundTabIds.add(createdTab.id);
    await waitForTab(createdTab.id);
    await new Promise((resolve)=>setTimeout(resolve,config.platform==="onlyfans"?3500:2200));
    const ok=await syncTab(createdTab.id,destination,false,true);
    if(!ok)throw new Error("The conversation did not synchronise.");
  }catch(error){
    console.error("Creator OS collector: pending thread failed",error);
    if(config?.token&&pending?.id)await messageBridgeRequest(config,"/pending-threads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({threadId:pending.id,error:error instanceof Error?error.message:String(error)})}).catch(()=>{});
  }finally{
    if(createdTab?.id){backgroundTabIds.delete(createdTab.id);await chrome.tabs.remove(createdTab.id).catch(()=>{});}
    rotationRunning.delete(platform);
  }
};

let fanslyMessageOutboxRunning=false;
const processFanslyMessageOutbox=async()=>{
  if(fanslyMessageOutboxRunning)return {ok:false,state:"busy"};
  fanslyMessageOutboxRunning=true;
  let createdTab;
  try{
    const config=await getStoredBridge("fansly");
    if(!config?.token)return {ok:false,state:"unpaired"};
    const response=await messageBridgeRequest(config,"/outbox/next");
    if(response.status===401){await removeStoredBridge("fansly");return {ok:false,state:"unpaired"};}
    if(!response.ok)return {ok:false,state:"bridge_error"};
    const job=(await response.json()).job;
    if(!job?.externalThreadId)return {ok:true,state:"empty"};
    const destination=new URL(job.externalThreadId,"https://fansly.com").href;
    const existingTabs=await chrome.tabs.query({url:"https://fansly.com/messages/*"});
    const expectedPath=new URL(destination).pathname.replace(/\/+$/,"");
    const existing=existingTabs.find((tab)=>tab.id&&tab.url&&new URL(tab.url).pathname.replace(/\/+$/ ,"")===expectedPath);
    if(existing?.id){
      const ok=await syncTab(existing.id,destination,false,false);
      return {ok,state:ok?"processed":"failed",jobId:job.id};
    }
    createdTab=await chrome.tabs.create({url:destination,active:false});
    if(!createdTab.id)throw new Error("Chrome did not create the Fansly send tab.");
    backgroundTabIds.add(createdTab.id);
    await waitForTab(createdTab.id,30000);
    const ok=await syncTab(createdTab.id,destination,false,false);
    return {ok,state:ok?"processed":"failed",jobId:job.id};
  }catch(error){
    console.error("THOT OS collector: automatic Fansly send failed",error);
    return {ok:false,state:"failed",error:error instanceof Error?error.message:String(error)};
  }finally{
    if(createdTab?.id){backgroundTabIds.delete(createdTab.id);await chrome.tabs.remove(createdTab.id).catch(()=>{});}
    fanslyMessageOutboxRunning=false;
  }
};

chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab) => {
  if (changeInfo.status === "complete" && tab.url && !backgroundTabIds.has(tabId)){
    syncTab(tabId,tab.url);
  }
});

const syncOpenMessageTabs = async () => {
  const tabs = await chrome.tabs.query({});
  console.info("Creator OS collector: scanning open tabs",{count:tabs.length});
  for (const tab of tabs) if (tab.id && tab.url)await syncTab(tab.id,tab.url);
};

let fanslyFeedSyncRunning=false;
const syncFanslyFeed=async()=>{
  if(fanslyFeedSyncRunning)return;
  fanslyFeedSyncRunning=true;
  try{
    const tabs=await chrome.tabs.query({url:["https://fansly.com/messages","https://fansly.com/messages/*"]});
    const conversationTabs=tabs.filter((tab)=>tab.id&&tab.url&&/^\/messages\/[^/]+$/.test(new URL(tab.url).pathname.replace(/\/+$/, ""))).sort((left,right)=>Number(right.lastAccessed??0)-Number(left.lastAccessed??0));
    const currentConversation=conversationTabs[0];
    if(currentConversation?.id&&currentConversation.url)await syncTab(currentConversation.id,currentConversation.url,false,true);
    const listTab=tabs.find((tab)=>tab.id&&tab.url&&new URL(tab.url).pathname.replace(/\/+$/, "")==="/messages");
    if(listTab?.id&&listTab.url){
      const state=await chrome.storage.local.get("creatorOsFanslyListSyncedAt");
      const elapsed=Date.now()-Number(state.creatorOsFanslyListSyncedAt??0);
      if(elapsed>=115000){
        const ok=await syncTab(listTab.id,listTab.url,false,true);
        if(ok)await chrome.storage.local.set({creatorOsFanslyListSyncedAt:Date.now()});
      }
    }
  }catch(error){
    console.error("THOT OS collector: Fansly feed refresh failed",error);
  }finally{
    fanslyFeedSyncRunning=false;
  }
};

chrome.runtime.onInstalled.addListener(syncOpenMessageTabs);
chrome.runtime.onStartup.addListener(syncOpenMessageTabs);
const createBridgeAlarms=()=>{
  chrome.alarms.create("creator-os-thread-sync",{periodInMinutes:1});
  chrome.alarms.create("thot-os-fansly-outbox",{periodInMinutes:0.5});
};
chrome.runtime.onInstalled.addListener(createBridgeAlarms);
chrome.runtime.onStartup.addListener(createBridgeAlarms);
chrome.alarms.onAlarm.addListener(async(alarm)=>{
  if(alarm.name==="thot-os-fansly-outbox"){
    await Promise.allSettled([processFanslyMessageOutbox(),syncFanslyFeed()]);
    await collectNextPendingThread("fansly");
    return;
  }
  if(alarm.name!=="creator-os-thread-sync")return;
  await Promise.allSettled([collectNextPendingThread("onlyfans"),processRedditQueue()]);
});
createBridgeAlarms();
chrome.action.onClicked.addListener(async(tab)=>{
  if(tab.id&&tab.url&&vaultPlatformForUrl(tab.url))await processVaultQueue(tab.id,tab.url);
  else if(tab.url&&/^https:\/\/(?:www\.)?reddit\.com\//.test(tab.url))await processRedditQueue();
  else await Promise.allSettled([syncOpenMessageTabs(),processFanslyMessageOutbox()]);
});
syncOpenMessageTabs().catch((error) => console.error("Creator OS collector: startup scan failed",error));
processRedditQueue().catch((error)=>console.error("THOT OS collector: Reddit startup queue failed",error));
processFanslyMessageOutbox().catch((error)=>console.error("THOT OS collector: Fansly startup outbox failed",error));
