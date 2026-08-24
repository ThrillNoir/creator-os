(()=>{
  if(globalThis.__creatorOsRedditPublisherLoaded)return;
  globalThis.__creatorOsRedditPublisherLoaded=true;

  const PENDING_KEY="creatorOsRedditPending";
  const clean=(value)=>String(value||"").replace(/\s+/g," ").trim();
  const normaliseHandle=(value)=>clean(value).replace(/^u\//i,"").replace(/^@/,"").toLowerCase();
  const sleep=(milliseconds)=>new Promise((resolve)=>setTimeout(resolve,milliseconds));
  const visible=(element)=>{const rect=element.getBoundingClientRect();const style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=="none"&&style.visibility!=="hidden";};
  const deepAll=(selector)=>{
    const roots=[document],seen=new Set();
    for(let index=0;index<roots.length;index++){
      for(const element of roots[index].querySelectorAll("*"))if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot);}
    }
    return roots.flatMap((root)=>Array.from(root.querySelectorAll(selector)));
  };
  const redditMediaControl=()=>{
    const supportedHosts=new Set(["POST-COMPOSER-TOOLBAR-BUTTON-IMAGE","R-POST-MEDIA-INPUT"]);
    const candidates=deepAll('input[type="file"]').map((input)=>({input,host:input.getRootNode()?.host})).filter(({input,host})=>{
      if(input.disabled||!host||!supportedHosts.has(host.tagName))return false;
      return visible(host);
    });
    return candidates.length===1?candidates[0]:undefined;
  };
  const redditComposerHost=()=>{
    const composerHosts=deepAll("r-post-composer-form").filter((host)=>host.isConnected&&visible(host));
    return composerHosts.length===1?composerHosts[0]:undefined;
  };
  const storedBridge=async()=>{
    const stored=await chrome.storage.local.get(["creatorOsBridges","creatorOsBridge"]);
    return stored.creatorOsBridges?.reddit||(stored.creatorOsBridge?.platform==="reddit"?stored.creatorOsBridge:undefined);
  };
  const pendingJob=async()=>(await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY];
  const savePending=(pending)=>chrome.storage.local.set({[PENDING_KEY]:pending});
  const clearPending=async(jobId)=>{
    const current=await pendingJob();
    if(current?.job?.id===jobId)await chrome.storage.local.remove(PENDING_KEY);
  };
  const showStatus=(message,kind="working")=>{
    let banner=document.getElementById("thot-os-reddit-publisher-status");
    if(!banner){
      banner=document.createElement("div");banner.id="thot-os-reddit-publisher-status";
      Object.assign(banner.style,{position:"fixed",zIndex:"2147483647",top:"16px",left:"50%",transform:"translateX(-50%)",maxWidth:"760px",padding:"14px 18px",borderRadius:"12px",color:"#fff",font:"600 14px/1.4 system-ui",boxShadow:"0 10px 30px rgba(0,0,0,.35)"});
      document.documentElement.appendChild(banner);
    }
    banner.style.background=kind==="error"?"#7f1d1d":kind==="success"?"#166534":"#4c1d95";
    banner.textContent=message;
  };
  const bridgeReceipt=async(config,pending,input)=>{
    const response=await fetch(`${config.apiBase}/jobs/${encodeURIComponent(pending.job.id)}/receipt`,{
      method:"POST",
      headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json",...(config.installationId?{"x-thot-os-installation-id":config.installationId}:{})},
      body:JSON.stringify(input),
    });
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(String(payload.error||`THOT OS receipt failed with ${response.status}.`));
    }
    return response.json();
  };
  const readHandle=async(expected)=>{
    for(const endpoint of ["/api/v1/me","/api/me.json","/user/me/about.json"]){
      try{
        const response=await fetch(endpoint,{credentials:"include",headers:{accept:"application/json"}});
        if(!response.ok)continue;
        const payload=await response.json();
        const candidate=clean(payload?.data?.name||payload?.name);
        if(candidate)return candidate;
      }catch{}
    }
    const handles=deepAll('a[href*="/user/"]').map((link)=>{
      try{return new URL(link.href,location.origin).pathname.match(/^\/user\/([^/]+)/i)?.[1]||"";}catch{return "";}
    }).filter(Boolean);
    return handles.find((handle)=>normaliseHandle(handle)===normaliseHandle(expected))||"";
  };
  const waitFor=(read,timeoutMs,error)=>new Promise((resolve,reject)=>{
    const started=Date.now();
    const check=()=>{
      const value=read();
      if(value)return resolve(value);
      if(Date.now()-started>=timeoutMs)return reject(new Error(error));
      setTimeout(check,250);
    };
    check();
  });
  const setControlValue=(control,value)=>{
    control.focus();
    if(control instanceof HTMLInputElement)Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(control,value);
    else if(control instanceof HTMLTextAreaElement)Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set?.call(control,value);
    else control.textContent=value;
    control.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));
    control.dispatchEvent(new Event("change",{bubbles:true}));
  };
  const readControlValue=(control)=>control instanceof HTMLInputElement||control instanceof HTMLTextAreaElement?control.value:control.textContent||"";
  const redditTitleControls=()=>deepAll('input,textarea,[contenteditable="true"]').filter((control)=>{
    const label=clean(`${control.getAttribute("name")||""} ${control.getAttribute("aria-label")||""} ${control.getAttribute("placeholder")||""}`);
    return control.isConnected&&visible(control)&&/(^|\s)title(\s|$)/i.test(label)&&!/search/i.test(label);
  });
  const redditBodyControls=()=>deepAll('textarea,[contenteditable="true"]').filter((control)=>{
    const label=clean(`${control.getAttribute("name")||""} ${control.getAttribute("aria-label")||""} ${control.getAttribute("placeholder")||""}`);
    return control.isConnected&&visible(control)&&/body|post body text field/i.test(label)&&!/search/i.test(label);
  });
  const fillVerifiedControl=async(readControls,value,label)=>{
    for(let attempt=0;attempt<3;attempt++){
      const control=await waitFor(()=>{const controls=readControls();return controls.length===1?controls[0]:undefined;},10000,`Reddit did not expose one live ${label} field after attaching the approved image.`);
      setControlValue(control,value);
      const verified=await waitFor(()=>{
        const controls=readControls();
        return controls.length===1&&clean(readControlValue(controls[0]))===clean(value)?controls[0]:undefined;
      },3000,`Reddit did not retain the approved ${label}.`).catch(()=>undefined);
      if(verified)return verified;
    }
    throw new Error(`Reddit did not retain the approved ${label}.`);
  };
  const sendRuntimeMessage=(message)=>new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage(message,(response)=>{
      if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));
      if(!response?.ok)return reject(new Error(String(response?.error||"The THOT OS extension could not attach the approved media.")));
      resolve(response);
    });
  });
  const renderedMediaSignals=(composerHost)=>{
    const roots=[composerHost],seen=new Set();
    for(let index=0;index<roots.length;index++){
      const root=roots[index].shadowRoot||roots[index];
      for(const element of root.querySelectorAll?.("*")||[])if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element);}
    }
    const elements=roots.flatMap((root)=>Array.from((root.shadowRoot||root).querySelectorAll?.("*")||[]));
    return elements.flatMap((element)=>{
      if(!visible(element))return [];
      const style=getComputedStyle(element);
      const label=clean(`${element.textContent||""} ${element.getAttribute?.("aria-label")||""} ${element.getAttribute?.("title")||""}`);
      const source=clean(`${element.currentSrc||element.getAttribute?.("src")||""} ${element.getAttribute?.("poster")||""} ${style.backgroundImage&&style.backgroundImage!=="none"?style.backgroundImage:""}`);
      const descriptor=clean(`${element.tagName} ${element.className||""} ${element.getAttribute?.("part")||""} ${element.getAttribute?.("data-testid")||""}`);
      const mediaElement=/^(IMG|VIDEO|CANVAS|FACEPLATE-IMG)$/.test(element.tagName);
      const mediaDescriptor=/media|image|preview|thumbnail|upload/i.test(descriptor);
      const removalControl=/remove (?:media|image)|delete (?:media|image)/i.test(label);
      if(!mediaElement&&!mediaDescriptor&&!removalControl&&!source)return [];
      const rect=element.getBoundingClientRect();
      return [`${descriptor}|${label}|${source}|${Math.round(rect.width)}x${Math.round(rect.height)}`];
    });
  };
  const hasRenderedMedia=(baselineSignals,basename)=>{
    const composerHost=redditComposerHost();
    if(!composerHost)return false;
    const mediaControl=redditMediaControl();
    const attachedFile=mediaControl?.input?.files?.length===1&&mediaControl.input.files[0]?.name===basename;
    const currentSignals=renderedMediaSignals(composerHost);
    const previewChanged=currentSignals.some((signal)=>!baselineSignals.has(signal));
    const removalControl=currentSignals.some((signal)=>/remove (?:media|image)|delete (?:media|image)/i.test(signal));
    return previewChanged&&(attachedFile||removalControl);
  };
  const fail=async(config,pending,error,observedHandle,receipt={})=>{
    const message=error instanceof Error?error.message:String(error);
    showStatus(`THOT OS stopped before posting: ${message}`,"error");
    await sendRuntimeMessage({type:"creator-os-reddit-discard-download",jobId:pending.job.id}).catch(()=>{});
    try{
      await bridgeReceipt(config,pending,{status:"failed",error:message,observedHandle,receipt:{...receipt,url:location.href}});
      await clearPending(pending.job.id);
    }catch(receiptError){console.error("THOT OS Reddit failure receipt was rejected",receiptError);}
  };
  const readPublishedMetadata=async(redditId)=>{
    for(let attempt=0;attempt<6;attempt++){
      try{
        const response=await fetch(`/comments/${encodeURIComponent(redditId)}.json?raw_json=1`,{credentials:"include",headers:{accept:"application/json"}});
        if(response.ok){
          const data=(await response.json())?.[0]?.data?.children?.[0]?.data;
          if(data?.id)return {
            id:data.id,author:data.author,subreddit:data.subreddit,title:data.title,is_self:data.is_self,
            is_gallery:data.is_gallery,is_video:data.is_video,is_reddit_media_domain:data.is_reddit_media_domain,
            post_hint:data.post_hint,domain:data.domain,url_overridden_by_dest:data.url_overridden_by_dest,
            media_metadata:data.media_metadata?{present:true}:undefined,
            media:data.media?.reddit_video?.fallback_url?{reddit_video:{fallback_url:data.media.reddit_video.fallback_url}}:undefined,
          };
        }
      }catch{}
      await sleep(1000);
    }
  };
  const completePublished=async(config,pending)=>{
    if(pending.state!=="submitted")return false;
    const match=location.pathname.match(/^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/|$)/i);
    if(!match)return false;
    showStatus("THOT OS is recording the published Reddit post…");
    const redditMetadata=await readPublishedMetadata(match[1]);
    const outcome=await bridgeReceipt(config,pending,{
      status:"published",externalUrl:location.href,externalPostId:`t3_${match[1]}`,
      observedHandle:pending.observedHandle,
      receipt:{...(pending.receipt||{}),externalUrl:location.href,pagePublisher:true,redditMetadata},
    });
    await clearPending(pending.job.id);
    if(outcome.status!=="published"){
      showStatus(`THOT OS did not accept this as a native-media post: ${outcome.error||"Reddit did not retain the approved image."}`,"error");
      return true;
    }
    showStatus("Native-media post verified and recorded in THOT OS.","success");
    return true;
  };
  const publishFromComposer=async(config,pending)=>{
    const job=pending.job;
    const expected=normaliseHandle(job.expected_handle);
    const composerMatch=location.pathname.match(/^\/r\/([^/]+)\/submit\/?$/i);
    if(!composerMatch||composerMatch[1].toLowerCase()!==String(job.community_name).toLowerCase())return;
    showStatus("THOT OS is preparing this approved Reddit post…");
    const observedHandle=await readHandle(expected);
    if(!observedHandle||normaliseHandle(observedHandle)!==expected)throw new Error(`This browser is signed in as ${observedHandle?`u/${observedHandle}`:"an unreadable Reddit account"}; expected u/${expected}.`);
    const controls=await waitFor(()=>{
      const mediaControl=redditMediaControl();
      const titleControls=redditTitleControls();
      const composerHost=redditComposerHost();
      return mediaControl&&composerHost&&titleControls.length===1?{composerHost}:undefined;
    },45000,"Reddit did not expose one active native media input and one title field.");
    const baselineMedia=new Set(renderedMediaSignals(controls.composerHost));
    const attachment=await sendRuntimeMessage({type:"creator-os-reddit-attach",jobId:job.id});
    await waitFor(()=>hasRenderedMedia(baselineMedia,job.basename),90000,"Reddit attached the approved file but did not expose a verifiable visible image preview.");
    await sleep(2000);
    if(!hasRenderedMedia(baselineMedia,job.basename))throw new Error("Reddit removed the approved image from the composer before posting.");
    await sendRuntimeMessage({type:"creator-os-reddit-discard-download",jobId:job.id});
    await fillVerifiedControl(redditTitleControls,job.title,"title");
    const liveBodyControl=job.caption?await fillVerifiedControl(redditBodyControls,job.caption,"post body"):undefined;
    const postButton=await waitFor(()=>{
      const buttons=deepAll("button").filter((button)=>visible(button)&&!button.disabled&&/^Post$/i.test(clean(button.textContent||button.getAttribute("aria-label"))));
      return buttons.length===1?buttons[0]:undefined;
    },45000,"Reddit did not enable one Post button after attaching the approved image.");
    const submitted={...(await pendingJob()),state:"submitted",submittedAt:Date.now(),observedHandle,receipt:{composerUrl:location.href,filename:job.basename,bytes:attachment.bytes||job.bytes||0,nativeMediaProof:"reddit-rendered-preview",bodyFilled:Boolean(job.caption&&liveBodyControl)}};
    await savePending(submitted);
    showStatus("Submitting the approved post to Reddit…");
    postButton.click();
    for(let attempt=0;attempt<120;attempt++){
      if(await completePublished(config,submitted))return;
      await sleep(1000);
    }
    throw new Error("Reddit did not return a post URL within two minutes. Leave this tab open for review.");
  };
  const run=async()=>{
    const [config,pending]=await Promise.all([storedBridge(),pendingJob()]);
    if(!config?.token||!pending?.job?.id)return;
    try{
      if(await completePublished(config,pending))return;
      if(pending.state==="submitted")return;
      await publishFromComposer(config,pending);
    }catch(error){await fail(config,pending,error,pending.observedHandle||pending.job.expected_handle,{state:pending.state||"claimed"});}
  };
  run().catch((error)=>console.error("THOT OS Reddit page publisher failed",error));
})();
