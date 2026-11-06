(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = payload => invoke('plugin:event|emit',{event:'drive-report',payload});
  const sample = () => {
    const root=document.querySelector('.tray-panel');
    const scroll=root.querySelector('.overflow-y-auto');
    const footer=root.lastElementChild;
    const last=[...scroll.querySelectorAll('button')].at(-1);
    return {viewport:innerHeight,rootHeight:root.offsetHeight,footerBottom:footer.getBoundingClientRect().bottom,
      scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,
      footerVisible:footer.getBoundingClientRect().bottom<=innerHeight+1,
      lastVisible:last ? last.getBoundingClientRect().bottom<=Math.min(innerHeight,scroll.getBoundingClientRect().bottom)+1 : true,
      bottomReached:Math.abs(scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop)<=1};
  };
  const show = async (theme,count,height) => {
    const settings={theme,language:'zh',notifyWhenDone:false};
    localStorage.setItem('tandem.settings',JSON.stringify(settings));
    window.dispatchEvent(new Event('focus'));
    await pause(100);
    const summary={
      tasks:Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),title:'滚动验证任务 '+(i+1),agent:'codex',status:'elsewhere',project:'测试项目',queuedCount:0})),
      sources:count ? [{agent:'claude',windows:[{name:'short',remaining:69,resetIn:'2小时',isLow:false},{name:'week',remaining:16,resetIn:'3天',isLow:true}]},{agent:'codex',windows:[{name:'week',remaining:4,resetIn:'3天',isLow:true}]}] : []
    };
    await invoke('update_tray',{update:{summary}});
    for(let i=0;i<60;i++){
      const found=count ? document.body.innerText.includes('滚动验证任务 '+count) : document.body.innerText.includes('没有进行中的任务');
      if(found)break;
      await pause(50);
    }
    await pause(400);
    if(height){
      await invoke('resize_tray_panel',{height});
      for(let i=0;i<60&&innerHeight!==height;i++)await pause(50);
    } else {
      for(let i=0;i<60&&innerHeight>=360;i++)await pause(50);
    }
    const scroll=document.querySelector('.tray-panel .overflow-y-auto');
    scroll.scrollTop=scroll.scrollHeight;
    scroll.dispatchEvent(new Event('scroll'));
    await pause(120);
    const result={phase:'fixed-scroll',theme,count,height,...sample()};
    await report(result);
    if(!result.footerVisible||!result.lastVisible||!result.bottomReached||result.rootHeight>result.viewport+1)throw Error('Scroll boundary failed: '+JSON.stringify(result));
    return result;
  };
  window.scrollAudit={invoke,report,pause,show};
  await pause(1500);
  for(const count of [7,30]) for(const height of [560,480,360]) await show('light',count,height);
  const compact=await show('light',0,null);
  if(compact.viewport>=360)throw Error('Panel stayed tall after the list cleared');
  await show('dark',30,480);
  await show('light',7,480);
  await report({phase:'fixed-ready',...sample()});
})().catch(error=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'drive-report',payload:{phase:'driver-error',error:String(error)}}));
