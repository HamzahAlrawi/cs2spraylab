import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';

// Bounded diagnostic only: runtime wrappers, no application source changes.
const prefix=process.env.REPORT??'research/round-start-work';
const warmAudio=process.argv.includes('--warm-audio');
const noShaderDiagnostics=process.argv.includes('--no-shader-diagnostics');
const browser=await chromium.launch({channel:'chromium'});
const results=[],errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const cdp=await page.context().newCDPSession(page);
  await page.addInitScript(()=>{
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'auto',frameLimit:60}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:5,skill:3,playerHealth:10000,realMapChunk:'dust2-mid-ct',feedbackSeconds:2}));
    window.startAudit={phase:'load',events:[],frames:[],gaps:[],engine:null};
    new PerformanceObserver(list=>{
      const a=window.startAudit;
      for(const e of list.getEntries())a.events.push({phase:a.phase,name:'longtask',at:e.startTime,ms:e.duration});
    }).observe({type:'longtask',buffered:true});
    let last;
    const raf=t=>{if(last)window.startAudit.gaps.push({phase:window.startAudit.phase,at:t,ms:t-last});last=t;requestAnimationFrame(raf);};
    requestAnimationFrame(raf);
  });
  page.on('pageerror',e=>errors.push(e.stack??e.message));
  await page.goto(process.env.DUEL_URL??'http://127.0.0.1:5176/');
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/duel/DuelEngine.ts')).name;
    const [{DuelEngine},{PrefireLighting}]=await Promise.all([
      import(url),import('/src/range/prefire/lighting.ts')]);
    const a=window.startAudit;
    const wrap=(object,name,label=name)=>{
      const fn=object[name];if(!fn)return;
      object[name]=function(...args){
        const at=performance.now(),phase=a.phase,dirty=this.dirty;
        try {
          const value=fn.apply(this,args);
          if(value?.then)value.then(()=>a.events.push({phase,name:label+'.resolved',at,ms:performance.now()-at}),()=>{});
          return value;
        }finally{a.events.push({phase,name:label,at,ms:performance.now()-at,...(label==='lighting.beginFrame'?{dirty}: {})});}
      };
    };
    for(const name of ['enter','restart','finishRestart','createSimulation','rebuildCovers','rebuildActors','syncEnvironment','syncDrops','syncActors','loadWorldWeapons','report'])wrap(DuelEngine.prototype,name);
    wrap(PrefireLighting.prototype,'beginFrame','lighting.beginFrame');
    wrap(PrefireLighting.prototype,'configure','lighting.configure');
    const tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time){
      a.engine=this;
      if(!this.renderer.__audit){
        const r=this.renderer;r.__audit=true;
        for(const n of ['render','compileAsync','initTexture'])wrap(r,n,'renderer.'+n);
        wrap(this.scenario,'prepareRound','scenario.prepareRound');
        wrap(this.scenario,'create','scenario.create');
        wrap(this.scenario,'updateView','scenario.updateView');
        wrap(this.radar,'update','radar.update');
        // Use the live classes: Vite timestamp imports can otherwise produce duplicates.
        for(const name of ['advance','start','renderSnapshot','drainEvents'])wrap(this.sim.constructor.prototype,name,'simulation.'+name);
        for(const name of ['unlockContext','unlock'])wrap(this.audio.constructor.prototype,name,'audio.'+name);
        const gl=r.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
        a.graphics=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable';
        const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');a.timerExtension=!!ext;
        for(const n of ['compileShader','linkProgram','getProgramParameter','getProgramInfoLog','bufferData','texImage2D','texSubImage2D','texStorage2D'])wrap(gl,n,'gl.'+n);
        a.gpu=[];
        if(ext){
          const pending=[],counts={},render=r.render;
          a.pollGpu=()=>{
            for(let i=pending.length-1;i>=0;i--){const q=pending[i];
              if(!gl.getQueryParameter(q.query,gl.QUERY_RESULT_AVAILABLE))continue;
              a.gpu.push({phase:q.phase,at:q.at,ms:gl.getQueryParameter(q.query,gl.QUERY_RESULT)/1e6,
                disjoint:!!gl.getParameter(ext.GPU_DISJOINT_EXT)});gl.deleteQuery(q.query);pending.splice(i,1);
            }
          };
          r.render=function(...args){
            const phase=a.phase,at=performance.now();
            if(phase==='load'||phase==='between'||(counts[phase]??0)>=40)return render.apply(this,args);
            counts[phase]=(counts[phase]??0)+1;const query=gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
            try{return render.apply(this,args);}finally{gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query,phase,at});}
          };
        }
      }
      a.pollGpu?.();
      const at=performance.now(),phase=a.phase;
      try{return tick.call(this,time);}finally{
        a.frames.push({phase,at,ms:performance.now()-at,loading:this.loadingMap,sim:this.sim.phase,
          map:this.scenario.chunk.id,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles});
      }
    };
  });
  await page.getByRole('button',{name:'Enter duel',exact:true}).waitFor({timeout:120000});
  await page.waitForFunction(()=>!!window.startAudit.engine);
  await page.evaluate(({warmAudio,noShaderDiagnostics})=>{
    const e=window.startAudit.engine;
    if(warmAudio)void e.audio.unlockContext();
    if(noShaderDiagnostics)e.renderer.debug.checkShaderErrors=false;
  },{warmAudio,noShaderDiagnostics});
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  const capture=async(name,action,ms=1800)=>{
    await cdp.send('Profiler.start');
    await page.evaluate(name=>{window.startAudit.phase=name;window.startAudit.mark=performance.now();},name);
    await action();await page.waitForTimeout(ms);
    const {profile}=await cdp.send('Profiler.stop');
    await fs.writeFile(prefix+'-'+name+'.cpuprofile',JSON.stringify(profile));
    const row=await page.evaluate(name=>{
      const a=window.startAudit,events=a.events.filter(e=>e.phase===name),frames=a.frames.filter(e=>e.phase===name),
        gaps=a.gaps.filter(e=>e.phase===name&&e.at-e.ms>=a.mark),gpu=a.gpu.filter(e=>e.phase===name);
      const quant=(rows,key,q)=>{const s=rows.map(e=>e[key]).sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]??0;};
      const parts={};
      for(const e of events){const p=parts[e.name]??={count:0,totalMs:0,maxMs:0};p.count++;p.totalMs+=e.ms;p.maxMs=Math.max(p.maxMs,e.ms);}
      const resume=events.find(e=>e.name==='simulation.start'),combat=resume?frames.filter(f=>f.at>=resume.at&&!f.loading&&f.sim==='fighting'):[];
      return {name,mark:a.mark,parts,gpu,frames:frames.slice(0,100),maxTickMs:quant(frames,'ms',1),p50TickMs:quant(frames,'ms',.5),p95TickMs:quant(frames,'ms',.95),
        resumeDelayMs:resume?resume.at-a.mark:null,firstCombatTickMs:combat[0]?.ms??null,
        firstCombatTicks:combat.slice(0,5),postResumeProgramLinks:resume?events.filter(e=>e.name==='gl.linkProgram'&&e.at>=resume.at).length:null,
        maxRafGapMs:quant(gaps,'ms',1),p50RafGapMs:quant(gaps,'ms',.5),gaps:gaps.filter(e=>e.ms>25),longTasks:events.filter(e=>e.name==='longtask'),
        slowEvents:events.filter(e=>e.ms>5),map:a.engine.scenario.chunk.id,paused:a.engine.paused,sim:a.engine.sim.phase,
        graphics:a.graphics,timerExtension:a.timerExtension,programs:a.engine.renderer.info.programs.length};
    },name);
    results.push(row);console.log(JSON.stringify({name,maxTickMs:row.maxTickMs,maxRafGapMs:row.maxRafGapMs,
      resumeDelayMs:row.resumeDelayMs,firstCombatTickMs:row.firstCombatTickMs,postResumeProgramLinks:row.postResumeProgramLinks,
      enter:row.parts.enter,prepareRound:row.parts['scenario.prepareRound'],rebuildActors:row.parts.rebuildActors,
      finishRestart:row.parts.finishRestart,longTasks:row.longTasks}));
    await page.evaluate(()=>window.startAudit.phase='between');
  };
  await fs.mkdir('research',{recursive:true});
  await capture('first-enter',()=>page.getByRole('button',{name:'Enter duel',exact:true}).click());
  await page.evaluate(()=>{const e=window.startAudit.engine;e.sim.actors[0].health=1e9;e.sim.config.roundSeconds=10000;});
  await capture('same-chunk-restart',()=>page.evaluate(()=>window.startAudit.engine.restart(true,false)),1000);
  for(const id of ['dust2-a-short','dust2-b-entry']) {
    await page.evaluate(async id=>{
      const a=window.startAudit,e=a.engine;a.phase='prepare-'+id;
      e.config={...e.config,realMapChunk:id};e.scenario.configureDuel(e.config);
      const {prepareSceneGpu}=await import('/src/range/duel/scene-preparation.ts');
      e.scenario.prefetchRound(e.seed,(scene,signal)=>prepareSceneGpu(e.renderer,scene,e.scene,e.camera,signal,e.settings.quality));
    },id);
    await page.waitForFunction(()=>window.startAudit.engine.scenario.prepared.ready,null,{timeout:90000});
    await capture('handoff-'+id,()=>page.evaluate(()=>window.startAudit.engine.restart(true)),1500);
  }
  const preparation=await page.evaluate(()=>{
    const a=window.startAudit,events=a.events.filter(e=>e.phase.startsWith('prepare-'));
    return {slowEvents:events.filter(e=>e.ms>8),longTasks:events.filter(e=>e.name==='longtask'),
      phases:[...new Set(events.map(e=>e.phase))].map(phase=>{const rows=events.filter(e=>e.phase===phase);return {phase,elapsedMs:Math.max(...rows.map(e=>e.at+e.ms))-Math.min(...rows.map(e=>e.at))};})};
  });
  await fs.writeFile(prefix+'.json',JSON.stringify({note:'Local Chromium development server, 1440x1000, auto quality, 5 bots, no CPU throttling. JS wrapper timings are nested, render time is CPU submission not GPU elapsed; bounded 1 kHz CPU profiles. Shared host load is uncontrolled. GPU samples are capped at 40 renders per phase; do not use frame calls/triangles as world totals (last viewmodel render).',warmAudio,noShaderDiagnostics,hardware:os.cpus()[0]?.model,results,preparation,errors},null,2));
}finally{await browser.close();}
