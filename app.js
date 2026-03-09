'use strict';
(function(){
  var DESIGN = 540 + 24;
  var stage = document.getElementById('stage');
  function rescale(){
    if(!stage) return;
    stage.style.transform = 'none';
  }

  var rowsEl=document.getElementById('rows');
  var pool=document.getElementById('pool');
  var sidePaletteEl=document.querySelector('.side.palette');
  var topNavEl=document.querySelector('.topNav');
  var bookletTitleEl=document.getElementById('bookletTitle');
  var pageCount=document.getElementById('pageCount');
  var pageBadge=document.getElementById('pageBadge');
  var applyBtn=document.getElementById('applyBtn');
  var undoBtn=document.getElementById('undoBtn');
  var saveStatusEl=document.getElementById('saveStatus');
  var lastSyncedEl=document.getElementById('lastSyncedStatus');
  var labelSortEl=document.getElementById('labelSort');
  var sendRaniaBtn=document.getElementById('sendRaniaBtn');
  var backToTopBtn=document.getElementById('backToTopBtn');
  var syncDiagStatusEl=document.getElementById('syncDiagStatus');
  var syncDiagDetailEl=document.getElementById('syncDiagDetail');
  var addNameBtn=document.getElementById('addName');
  var resetNamesBtn=document.getElementById('resetNames');
  var multiLabelModal=document.getElementById('multiLabelModal');
  var multiLabelFields=document.getElementById('multiLabelFields');
  var addMultiLabelFieldBtn=document.getElementById('addMultiLabelField');
  var confirmMultiLabelBtn=document.getElementById('confirmMultiLabel');
  var cancelMultiLabelBtn=document.getElementById('cancelMultiLabel');
  var renameLabelModal=document.getElementById('renameLabelModal');
  var renameLabelInput=document.getElementById('renameLabelInput');
  var confirmRenameLabelBtn=document.getElementById('confirmRenameLabel');
  var cancelRenameLabelBtn=document.getElementById('cancelRenameLabel');

  var BOOKLET_KEY=getBookletKeyFromUrl();
  var BOOKLET_TITLE=bookletTitleForKey(BOOKLET_KEY);
  var DEFAULT_PAGES=defaultPagesForKey(BOOKLET_KEY);
  var STORAGE='booklet-v2-sortable-'+BOOKLET_KEY;
  var SORT_STORAGE=STORAGE+'-sort-v2';
  var API_STATE='/api/state?booklet='+encodeURIComponent(BOOKLET_KEY);
  var API_NOTIFY='/api/notify?booklet='+encodeURIComponent(BOOKLET_KEY);
  var MAX=4, START=1;
  var labelSortMode='recent';
  var saveTimer=null;
  var globalSyncTimer=null;
  var isGlobalSaveInFlight=false;
  var hasPendingGlobalSave=false;
  var lastServerFingerprint='';
  var lastKnownServerRev='';
  var suppressGlobalSave=false;
  var pendingRenameLabelId='';
  var undoStack=[];
  var UNDO_MAX=30;
  var isUndoing=false;

  function uid(){return Math.random().toString(36).slice(2,9);}

  function sanitizeBookletKey(raw){
    var cleaned=(raw||'').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
    return cleaned || 'mykonos';
  }
  function getBookletKeyFromUrl(){
    try{
      var params=new URLSearchParams(window.location.search||'');
      return sanitizeBookletKey(params.get('booklet')||'mykonos');
    }catch(_){
      return 'mykonos';
    }
  }
  function titleCaseWords(text){
    return (text||'').split(/[-_\s]+/).filter(Boolean).map(function(part){
      return part.charAt(0).toUpperCase()+part.slice(1);
    }).join(' ');
  }
  function bookletTitleForKey(key){
    var titles={
      mykonos:'Mykonos Best',
      santorini:'Santorini Best',
      paros:'Paros Best',
      'flying-to-greece':'Flying to Greece',
      'best-destinations':'Best Destinations'
    };
    return titles[key] || (titleCaseWords(key)+' Best');
  }
  function defaultPagesForKey(key){
    var defaults={
      mykonos:82,
      santorini:82,
      paros:24,
      'flying-to-greece':24,
      'best-destinations':24
    };
    return Number(defaults[key]||82);
  }
  function updateTopNavActive(){
    var items=[].slice.call(document.querySelectorAll('.topNav .navItem[data-booklet]'));
    items.forEach(function(item){
      var key=sanitizeBookletKey(item.getAttribute('data-booklet')||'');
      var active=(key===BOOKLET_KEY);
      item.classList.toggle('is-active', active);
      if(active) item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    });
  }

  function updateFixedSidebarMetrics(){
    if(!topNavEl) return;
    var top = 16 + topNavEl.offsetHeight + 12;
    document.documentElement.style.setProperty('--side-fixed-top', top+'px');
  }

  function cloneState(src){ return JSON.parse(JSON.stringify(src)); }
  function preserveWindowScroll(work){
    var sx=window.scrollX||0;
    var sy=window.scrollY||0;
    work();
    requestAnimationFrame(function(){
      window.scrollTo(sx, sy);
    });
  }
  function stateFingerprint(src){
    try{ return JSON.stringify(src||{}); }
    catch(_){ return ''; }
  }
  function restoreScrollIfJumped(beforeX, beforeY){
    if(beforeY<80) return;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        var afterY=window.scrollY||0;
        if(afterY<20 && beforeY-afterY>120){
          window.scrollTo(beforeX, beforeY);
        }
      });
    });
  }
  function updateBackToTopVisibility(){
    if(!backToTopBtn) return;
    var show=(window.scrollY||0) > 260;
    backToTopBtn.classList.toggle('is-visible', show);
  }

  function updateUndoButton(){
    if(!undoBtn) return;
    undoBtn.disabled = undoStack.length===0;
  }

  function rememberState(){
    if(isUndoing) return;
    undoStack.push(cloneState(state));
    if(undoStack.length>UNDO_MAX) undoStack.shift();
    updateUndoButton();
  }

  function setSaveStatus(kind){
    if(!saveStatusEl) return;
    saveStatusEl.classList.remove('is-saving','is-saved','is-error');
    if(kind==='saving'){
      saveStatusEl.textContent='Saving…';
      saveStatusEl.classList.add('is-saving');
      return;
    }
    if(kind==='error'){
      saveStatusEl.textContent='Save failed';
      saveStatusEl.classList.add('is-error');
      return;
    }
    saveStatusEl.textContent='Saved';
    saveStatusEl.classList.add('is-saved');
  }
  function setLastSyncedNow(){
    if(!lastSyncedEl) return;
    var now=new Date();
    var hh=String(now.getHours()).padStart(2,'0');
    var mm=String(now.getMinutes()).padStart(2,'0');
    var ss=String(now.getSeconds()).padStart(2,'0');
    lastSyncedEl.textContent='Last synced '+hh+':'+mm+':'+ss;
  }
  function setSyncDiagnostic(kind, detail){
    if(syncDiagStatusEl){
      syncDiagStatusEl.classList.remove('is-ok','is-pending','is-error');
      if(kind==='ok'){
        syncDiagStatusEl.textContent='Sync: OK';
        syncDiagStatusEl.classList.add('is-ok');
      }else if(kind==='pending'){
        syncDiagStatusEl.textContent='Sync: Pending';
        syncDiagStatusEl.classList.add('is-pending');
      }else if(kind==='error'){
        syncDiagStatusEl.textContent='Sync: Error';
        syncDiagStatusEl.classList.add('is-error');
      }else{
        syncDiagStatusEl.textContent='Sync: --';
      }
    }
    if(syncDiagDetailEl){
      var now=new Date();
      var hh=String(now.getHours()).padStart(2,'0');
      var mm=String(now.getMinutes()).padStart(2,'0');
      var ss=String(now.getSeconds()).padStart(2,'0');
      syncDiagDetailEl.textContent='['+hh+':'+mm+':'+ss+'] '+(detail||'');
    }
  }
  function setLabelNewState(labelId, isNew){
    if(!Array.isArray(state.names)) return;
    for(var i=0;i<state.names.length;i++){
      var rec=state.names[i];
      if(rec && rec.id===labelId){
        rec.isNew=!!isNew;
        return;
      }
    }
  }
  function setLabelTextState(labelId, text){
    if(!Array.isArray(state.names)) return false;
    for(var i=0;i<state.names.length;i++){
      var rec=state.names[i];
      if(rec && rec.id===labelId){
        rec.text=text;
        return true;
      }
    }
    return false;
  }
  function normalizeLabelText(text){
    return ((text||'').toString().trim()).toLowerCase();
  }
  function labelExists(text, excludeId){
    var needle=normalizeLabelText(text);
    if(!needle || !Array.isArray(state.names)) return false;
    for(var i=0;i<state.names.length;i++){
      var rec=state.names[i];
      if(!rec) continue;
      if(excludeId && rec.id===excludeId) continue;
      if(normalizeLabelText(rec.text)===needle) return true;
    }
    return false;
  }
  function dedupeLabelsInState(){
    if(!Array.isArray(state.names)) state.names=[];

    var idRemap={};
    var seenById={};
    var uniqueNames=[];

    for(var i=0;i<state.names.length;i++){
      var rec=state.names[i];
      if(!rec || !rec.id) continue;
      var key=normalizeLabelText(rec.text);
      if(!key) continue;

      if(seenById[rec.id]){
        idRemap[rec.id]=seenById[rec.id];
        continue;
      }

      seenById[rec.id]=rec.id;
      uniqueNames.push(rec);
    }

    state.names=uniqueNames;

    var validIds={};
    state.names.forEach(function(rec){ validIds[rec.id]=true; });

    if(state.assignments && typeof state.assignments==='object'){
      Object.keys(state.assignments).forEach(function(page){
        var arr=state.assignments[page];
        if(!Array.isArray(arr)) return;
        var out=[];
        var seen={};
        for(var j=0;j<arr.length;j++){
          var id=arr[j];
          if(idRemap[id]) id=idRemap[id];
          if(!validIds[id]) continue;
          if(seen[id]) continue;
          seen[id]=true;
          out.push(id);
        }
        state.assignments[page]=out;
      });
    }

    if(state.spreads && typeof state.spreads==='object'){
      Object.keys(state.spreads).forEach(function(anchor){
        var info=state.spreads[anchor];
        if(!info || !info.id){
          delete state.spreads[anchor];
          return;
        }
        var mapped=idRemap[info.id] || info.id;
        if(!validIds[mapped]){
          delete state.spreads[anchor];
          return;
        }
        info.id=mapped;
      });
    }
  }
  function normalizeLabelSortMode(mode){
    if(mode==='az') return 'az';
    if(mode==='oldest') return 'oldest';
    return 'recent';
  }
  function currentLabelSort(){
    if(labelSortEl && labelSortEl.value) return normalizeLabelSortMode(labelSortEl.value);
    return normalizeLabelSortMode(labelSortMode);
  }
  function sortNamesForPool(names){
    var copy=(names||[]).slice();
    var mode=currentLabelSort();
    if(mode==='az'){
      copy.sort(function(a,b){
        var at=((a&&a.text)||'').toLowerCase();
        var bt=((b&&b.text)||'').toLowerCase();
        return at.localeCompare(bt);
      });
      return copy;
    }
    if(mode==='oldest'){
      copy.sort(function(a,b){
        var av=Number((a&&a.createdAt)||0);
        var bv=Number((b&&b.createdAt)||0);
        return av-bv;
      });
      return copy;
    }
    copy.sort(function(a,b){
      var av=Number((a&&a.createdAt)||0);
      var bv=Number((b&&b.createdAt)||0);
      return bv-av;
    });
    return copy;
  }
  function sortPoolTagsOnly(){
    if(!pool) return;
    var tags=[].slice.call(pool.querySelectorAll('.tag[data-id]'));
    if(tags.length<2) return;

    var mode=currentLabelSort();
    var byId={};

    if(Array.isArray(state.names)){
      for(var i=0;i<state.names.length;i++){
        var rec=state.names[i];
        if(!rec || !rec.id) continue;
        byId[rec.id]=rec;
      }
    }

    tags.sort(function(a,b){
      var aid=a.getAttribute('data-id')||'';
      var bid=b.getAttribute('data-id')||'';
      var arec=byId[aid]||{};
      var brec=byId[bid]||{};

      if(mode==='az'){
        var at=((arec.text||'').toLowerCase());
        var bt=((brec.text||'').toLowerCase());
        var cmp=at.localeCompare(bt);
        if(cmp!==0) return cmp;
        return aid.localeCompare(bid);
      }

      if(mode==='oldest'){
        var ao=Number(arec.createdAt||0);
        var bo=Number(brec.createdAt||0);
        if(ao!==bo) return ao-bo;
        return aid.localeCompare(bid);
      }

      var av=Number(arec.createdAt||0);
      var bv=Number(brec.createdAt||0);
      if(av!==bv) return bv-av;
      return aid.localeCompare(bid);
    });

    tags.forEach(function(tag){ pool.appendChild(tag); });
  }
  function applyCurrentSortToPoolOnly(){
    var sx=window.scrollX||0;
    var sy=window.scrollY||0;
    preserveWindowScroll(function(){
      sortPoolTagsOnly();
      adjustAllFonts();
    });
    restoreScrollIfJumped(sx, sy);
  }
  function deleteLabelEverywhere(labelId){
    if(!labelId) return;

    if(Array.isArray(state.names)){
      state.names=state.names.filter(function(rec){ return rec && rec.id!==labelId; });
    }

    if(state.assignments && typeof state.assignments==='object'){
      Object.keys(state.assignments).forEach(function(key){
        var arr=state.assignments[key];
        if(Array.isArray(arr)) state.assignments[key]=arr.filter(function(id){ return id!==labelId; });
      });
    }

    if(state.spreads && typeof state.spreads==='object'){
      Object.keys(state.spreads).forEach(function(key){
        var info=state.spreads[key];
        if(info && info.id===labelId){
          removeSpan(Number(key));
          delete state.spreads[key];
        }
      });
    }

    build();
    save();
  }

  function setNotifyButtonState(kind){
    if(!sendRaniaBtn) return;
    sendRaniaBtn.classList.remove('is-sent','is-error');
    if(kind==='sending'){
      sendRaniaBtn.disabled=true;
      sendRaniaBtn.textContent='Sending…';
      return;
    }
    sendRaniaBtn.disabled=false;
    if(kind==='sent'){
      sendRaniaBtn.textContent='Sent ✓';
      sendRaniaBtn.classList.add('is-sent');
      setTimeout(function(){
        if(!sendRaniaBtn) return;
        sendRaniaBtn.classList.remove('is-sent');
        sendRaniaBtn.textContent='Send to Rania';
      },1800);
      return;
    }
    if(kind==='error'){
      sendRaniaBtn.textContent='Send failed';
      sendRaniaBtn.classList.add('is-error');
      setTimeout(function(){
        if(!sendRaniaBtn) return;
        sendRaniaBtn.classList.remove('is-error');
        sendRaniaBtn.textContent='Send to Rania';
      },2200);
      return;
    }
    sendRaniaBtn.textContent='Send to Rania';
  }

  var selected=null;
  var pointerDrag=null;

  function clearDropTargets(){
    [].slice.call(document.querySelectorAll('.cell.drop-target')).forEach(function(c){
      c.classList.remove('drop-target');
    });
  }

  function findDroppableCellFromPoint(x,y){
    var el=document.elementFromPoint(x,y);
    if(!el) return null;
    var cell=el.closest && el.closest('.cell[data-page]');
    if(!cell) return null;
    var p=Number(cell.getAttribute('data-page'));
    if(!p || p===1 || p===2) return null;
    var aff=affecting(p);
    if(aff) return null;
    return cell;
  }

  function startPointerDrag(ev, tag){
    if(ev.button!==0) return;
    if(ev.pointerType && ev.pointerType!=='mouse') return;
    if(ev.target && ev.target.classList && (ev.target.classList.contains('kill') || ev.target.classList.contains('tagSpread') || ev.target.classList.contains('tagNew'))) return;

    var ghost=document.createElement('div');
    ghost.className='dragGhost';
    ghost.textContent=(tag.querySelector('.label')||tag).textContent || '';
    document.body.appendChild(ghost);

    pointerDrag={ id: tag.getAttribute('data-id'), ghost: ghost, targetCell: null };
    ghost.style.left=(ev.clientX+12)+'px';
    ghost.style.top=(ev.clientY+12)+'px';
  }

  function movePointerDrag(ev){
    if(!pointerDrag) return;
    pointerDrag.ghost.style.left=(ev.clientX+12)+'px';
    pointerDrag.ghost.style.top=(ev.clientY+12)+'px';

    clearDropTargets();
    var hit=findDroppableCellFromPoint(ev.clientX, ev.clientY);
    if(!hit){
      pointerDrag.targetCell=null;
      return;
    }
    pointerDrag.targetCell=hit;
    hit.classList.add('drop-target');
  }

  function endPointerDrag(){
    if(!pointerDrag) return;
    var id=pointerDrag.id;
    var cell=pointerDrag.targetCell;
    if(pointerDrag.ghost) pointerDrag.ghost.remove();
    clearDropTargets();
    pointerDrag=null;

    if(!id || !cell) return;
    var tag=document.querySelector('.tag[data-id="'+id+'"]');
    if(tag){
      drop(tag, cell);
      clearSel();
    }
  }

  function makeTag(name,id){
    if(!id)id=uid();
    var el=document.createElement('div');
    el.className='tag'; el.setAttribute('data-id',id); el.draggable=false;
    el.innerHTML='<span class="label"></span><button type="button" class="tagNew" title="Mark as New">NEW</button><button type="button" class="tagSpread" title="Spread">↔</button><button type="button" class="tagEdit" title="Edit label">✎</button><button type="button" class="kill" title="Remove">×</button>';
    el.querySelector('.label').textContent=name;
    var isNew=false;
    if(Array.isArray(state.names)){
      for(var i=0;i<state.names.length;i++){
        var rec=state.names[i];
        if(rec && rec.id===id){
          isNew=!!rec.isNew;
          break;
        }
      }
    }
    if(isNew) el.classList.add('is-new');
    el.querySelector('.kill').addEventListener('click',function(e){
      e.stopPropagation();
      rememberState();
      if(el.closest('#pool')){
        deleteLabelEverywhere(id);
        return;
      }
      moveToPool(el);
    });
    el.querySelector('.tagSpread').addEventListener('click',function(e){e.stopPropagation(); toggleTagSpread(el);});
    el.querySelector('.tagNew').addEventListener('click',function(e){
      e.stopPropagation();
      rememberState();
      var nowNew=!el.classList.contains('is-new');
      el.classList.toggle('is-new', nowNew);
      setLabelNewState(id, nowNew);
      save();
    });
    el.querySelector('.tagEdit').addEventListener('click',function(e){
      e.stopPropagation();
      if(!el.closest('#pool')) return;
      openRenameLabelModal(id, (el.querySelector('.label').textContent||'').trim());
    });
    el.addEventListener('click',function(e){ e.stopPropagation(); selectTag(el); });
    el.addEventListener('pointerdown',function(e){ startPointerDrag(e, el); });
    el.addEventListener('mousedown',function(e){
      if(pointerDrag) return;
      startPointerDrag(e, el);
    });
    return el;
  }

  function toggleTagSpread(tag){
    var cell=tag.closest('.cell');
    if(!cell) return;
    var p=Number(cell.getAttribute('data-page'));
    if(!p || p%2===0 || p===1 || p===2) return;

    var slot=cell.querySelector('.slot');
    if(!slot) return;
    if(slot.querySelectorAll('.tag').length!==1) return;

    var active=state.spreads[p];
    rememberState();
    if(active && active.id===tag.getAttribute('data-id')){
      removeSpan(p);
      delete state.spreads[p];
      layoutCell(cell);
      save();
      return;
    }

    var other=p+1, oc=getCell(other);
    if(!oc) return;
    clearCell(oc);
    state.spreads[p]={id:tag.getAttribute('data-id'),dir:'next'};
    layoutCell(cell);
    applySpanVisual(p);
    save();
  }

  function computeTargetTagWidth(){
    try{
      var probe = makeTag('Divine Property', 'probe-'+uid());
      probe.style.position='absolute';
      probe.style.visibility='hidden';
      document.body.appendChild(probe);
      var w = probe.offsetWidth; probe.remove();
      if(w && isFinite(w)) document.documentElement.style.setProperty('--tag-w', w+'px');
    }catch(_){ }
  }

  function adjustTagFont(tag){
    try{
      var label = tag.querySelector('.label'); if(!label) return;
      var cell = tag.closest('.cell');
      var inPool = !!tag.closest('#pool');
      var isMobileView = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
      if(!cell && !inPool){
        label.style.fontSize = '';
        return;
      }

      var len = ((label.textContent || '').trim()).length || 1;
      var isRight = !!(cell && cell.classList.contains('page-right'));

      var kind = 'single';
      if(tag.classList.contains('is-spread')) kind = 'spread';
      else if(tag.classList.contains('is-quarter')) kind = 'quarter';
      else if(tag.classList.contains('is-half')) kind = 'half';

      if(inPool){
        var poolSize = isMobileView ? 12 : 19;
        if(len > 12) poolSize = isMobileView ? 11 : 17;
        if(len > 18) poolSize = isMobileView ? 10 : 16;
        if(len > 26) poolSize = isMobileView ? 9.5 : 15;
        if(len > 34) poolSize = isMobileView ? 9 : 14;
        label.style.fontSize = poolSize.toFixed(1) + 'px';
        return;
      }

      var cfg = {
        spread: isMobileView ? { base: 24, min: 14, max: 30, rightBoost: 1 } : { base: 56, min: 34, max: 72, rightBoost: 1.16 },
        single: isMobileView ? { base: 18, min: 10, max: 22, rightBoost: 1 } : { base: 44, min: 24, max: 62, rightBoost: 1.28 },
        half: isMobileView ? { base: 16, min: 10, max: 20, rightBoost: 1 } : { base: 34, min: 20, max: 52, rightBoost: 1.4 },
        quarter: isMobileView ? { base: 12, min: 8, max: 14, rightBoost: 1 } : { base: 22, min: 13, max: 40, rightBoost: 1.5 }
      }[kind];

      var factor = 1;
      if(len > 12) factor *= 0.92;
      if(len > 18) factor *= 0.88;
      if(len > 26) factor *= 0.84;
      if(len > 36) factor *= 0.8;
      if(isMobileView){
        if(len > 10) factor *= 0.9;
        if(len > 16) factor *= 0.86;
        if(len > 22) factor *= 0.82;
      }

      var size = cfg.base * factor * (isRight ? cfg.rightBoost : 1);
      if(size < cfg.min) size = cfg.min;
      if(size > cfg.max) size = cfg.max;

      label.style.fontSize = size.toFixed(1) + 'px';
    }catch(_){ }
  }
  function adjustAllFonts(){ document.querySelectorAll('.tag').forEach(adjustTagFont); }

  window.addEventListener('resize', function(){
    rescale();
    updateFixedSidebarMetrics();
    computeTargetTagWidth();
    adjustAllFonts();
  });
  window.addEventListener('pointermove', movePointerDrag);
  window.addEventListener('pointerup', endPointerDrag);
  window.addEventListener('pointercancel', endPointerDrag);
  window.addEventListener('mousemove', function(e){ if(pointerDrag) movePointerDrag(e); });
  window.addEventListener('mouseup', endPointerDrag);
  window.addEventListener('beforeunload', function(){
    if(suppressGlobalSave) return;
    if(!lastKnownServerRev) return;
    try{
      var payload = JSON.stringify(state);
      var blob = new Blob([payload], {type:'application/json'});
      if(navigator.sendBeacon){
        var beaconUrl=API_STATE+'&rev='+encodeURIComponent(lastKnownServerRev);
        navigator.sendBeacon(beaconUrl, blob);
      }
    }catch(_){ }
  });
  document.addEventListener('click', function(ev){
    var target=ev.target;
    var button=target && target.closest ? target.closest('button') : null;
    if(!button) return;
    if(button===backToTopBtn) return;
    restoreScrollIfJumped(window.scrollX||0, window.scrollY||0);
  }, true);
  window.addEventListener('scroll', updateBackToTopVisibility, {passive:true});
  if(backToTopBtn) backToTopBtn.addEventListener('click', function(){
    window.scrollTo({top:0, behavior:'smooth'});
  });
  rescale();
  updateBackToTopVisibility();

  var PROVIDED=[
    "Deos","Resorts Mykonos","Unmistakably Katikies","Nammos","Kalesma","Once in Mykonos","Epic Blue","San Marco",
    "Semeli Hotel","Semeli Coast","Ornos Beach","Casa Del Mar","Divine Property","Andronikos Hotel","Theoxenia","Elia",
    "Mykonos Dove","Million Stars","Ftelia Black Villas","Asty Mykonos","Kivotos","Omnia","Petra Blu","Salty Houses",
    "Dionysos Hotel","Is Mykonos","Villa Aegeas","Ataraxia","MykonosVillas","Zinas","MykonosAmmosVillas",
    "Mykonos Dream Villas","Katikies Villas","Gofas","Cavo Paradiso","Nammos World","Nammos Village","Principote",
    "SantAnna","Paraj","Aperanto Galazio","beefbar","PereUbu","Dsquared2","Queen","Queen Saloni","Semeli Group",
    "Mosaic","Katrin","Blublu","Roca","Missoni","Cape Ftelia","Pnoe","Beauty World","Baboulas","Fiora Super Market",
    "Portioli","OneExchange","Cinema","Costa Lekka","GMT Voyager","Premium Legal","MPOS","Priveon","Traffic","Autopower",
    "Nilina","Elixir","Lionsbay","Dolphin","Advanced VIP","Yaloou"
  ];
  var FLYING_TO_GREECE=[
    "Flying to Greece",
    "New York Tourism Advisory Group",
    "Interconnection Projects",
    "Xenodocheio Milos",
    "Estiatorio Milos",
    "Louis Hotels",
    "Donkey Hotels",
    "NOŪS",
    "InterContinental Athens",
    "NEW Hotel",
    "Semiramis",
    "Periscope Hotel",
    "Electra Hotels & Resorts",
    "Electra Kefalonia",
    "Academias Hotel, Autograph Collection",
    "Coral Hotel",
    "CBS Yachts",
    "Nilina Management",
    "Elixir Cruises",
    "Alpha Marine R Group",
    "Gofas Jewelry",
    "Poniros",
    "Barbarossa Athens",
    "Sea Satin Market by Caprice",
    "Pasaji",
    "Clemente VIII",
    "Drakoulis Restaurants",
    "DRY & RAW",
    "Papaioannou",
    "Zen Beach",
    "Pere Ubu",
    "nice n easy organic restaurant",
    "Iguazu Athens",
    "Toy Room Athens",
    "Panagiota Plus",
    "Anemolia Mountain Resort",
    "Likoria",
    "Santa Marina Arachova Resort & Spa",
    "Ceci Luxury Suites",
    "AJM Luxury Hotel",
    "Paeonia",
    "Aegli Arachova",
    "ParaMount Livadi Arachovas",
    "La Fabbrica Della Pizza",
    "Hotel City Zen",
    "Le Grand Chalet",
    "Balcony",
    "Xenonas Kiriaki",
    "Due-S",
    "Manifest Hotel",
    "Cape Ftelia",
    "Castro Hotel Syros",
    "Aithrio Lounge",
    "Cellar 1857",
    "Cavo Fregada Syros",
    "Château Nico Lazaridi",
    "Optima Lodgings"
  ];
  var SANTORINI=[
    "Santorini Best",
    "Caldera Yachting",
    "New York Tourism Advisory Group",
    "Katikies",
    "West East Suites",
    "Fly Away",
    "Cresanto Luxury Suites",
    "Aestian",
    "Sperisma",
    "Sienna Eco Resort",
    "Rizes",
    "Etereo Suites",
    "Venus Sunrise",
    "Santorini Princess",
    "Le Ciel",
    "NOUS Santorini",
    "Lilium Holiday Homes & Villas Santorini",
    "Lilium Hotel Santorini",
    "mysantorini hotels",
    "Blue Dolphins",
    "Grand View",
    "Casa Grande",
    "Just Blue",
    "Yposkafo Jacuzzi House",
    "Atoles Retreat",
    "Gofas Jewelry",
    "Poniros",
    "Nikki Beach Resort & Spa",
    "Topos Exclusive",
    "Oia Suites",
    "LVKAS Aetherial Living",
    "Caldera Villas",
    "Elies Suites",
    "Vogue Suites",
    "Phaos Santorini Suites",
    "Phaos 1870",
    "Phaos Cellaria",
    "Phaos St John Villas",
    "Villa Renos",
    "Santo Wines 1911",
    "Barolo Beach",
    "Barolo Santorini",
    "Taste and Feel Santorini",
    "Hill Suites Santorini",
    "Hillside Suites",
    "Hillside Elegance Suites",
    "Cacio e Pepe",
    "Fusionnelle",
    "Frati Santorini",
    "Skala Restaurant",
    "Skiza Café",
    "Deck Santorini",
    "Portioli Super Premium Italian Espresso",
    "Luxury Spot Helicopter Tours",
    "Santorini's Luxury Travel",
    "Therapy",
    "Elixir Cruises"
  ];
  var PROVIDED_SET=(function(){
    var map={};
    for(var i=0;i<PROVIDED.length;i++) map[PROVIDED[i]]=true;
    return map;
  })();

  function defaultNamesForBooklet(){
    if(BOOKLET_KEY==='mykonos') return PROVIDED.slice();
    if(BOOKLET_KEY==='santorini') return SANTORINI.slice();
    if(BOOKLET_KEY==='flying-to-greece') return FLYING_TO_GREECE.slice();
    return [];
  }
  function seedDefaultNamesIfEmpty(){
    if(!Array.isArray(state.names) || state.names.length) return false;
    var defaults=defaultNamesForBooklet();
    if(!defaults.length) return false;
    state.names=defaults.map(function(t,idx){
      return {id:uid(),text:t,isNew:false,createdAt:idx+1,bookletKey:BOOKLET_KEY};
    });
    return true;
  }

  function stripForeignLabelsFromState(){
    if(!Array.isArray(state.names)) state.names=[];

    var removed={};
    state.names=state.names.filter(function(rec){
      var labelBooklet=(rec && rec.bookletKey) ? sanitizeBookletKey(rec.bookletKey) : BOOKLET_KEY;
      var drop=labelBooklet!==BOOKLET_KEY;
      if(drop && rec.id) removed[rec.id]=true;
      return !drop;
    });

    if(Object.keys(removed).length){
      if(state.assignments && typeof state.assignments==='object'){
        Object.keys(state.assignments).forEach(function(key){
          var arr=state.assignments[key];
          if(Array.isArray(arr)) state.assignments[key]=arr.filter(function(id){ return !removed[id]; });
        });
      }

      if(state.spreads && typeof state.spreads==='object'){
        Object.keys(state.spreads).forEach(function(key){
          var info=state.spreads[key];
          if(info && removed[info.id]) delete state.spreads[key];
        });
      }
    }

    dedupeLabelsInState();
  }

  var state={pages:DEFAULT_PAGES,names:[],assignments:{},spreads:{},layout3:{}};

  function getThreeBottom(page){
    return !!(state.layout3 && state.layout3[page]);
  }
  function setThreeBottom(page, value){
    if(!state.layout3 || typeof state.layout3!=='object') state.layout3={};
    if(value) state.layout3[page]=true;
    else delete state.layout3[page];
  }

  function list(p){return state.assignments[p]||(state.assignments[p]=[]);}
  function nb(p){return (p%2===0)?p-1:p+1;}
  function displayPageNumber(page){
    var total=Number(state.pages)||2;
    if(page===1) return total;
    if(page===2) return 1;
    return page-1;
  }
  function isLockedCoverPage(page){ return page===1 || page===2; }
  function coverNameForPage(page){
    if(page===1) return 'Back Cover';
    if(page===2) return 'Front Cover';
    return '';
  }
  function updateBadge(){
    var t=Number(pageCount.value)||2;
    pageBadge.textContent=t;
    pageBadge.classList.toggle('bad',t%4!==0);
  }

  function loadLocal(){
    try{
      var raw=localStorage.getItem(STORAGE); if(!raw) return false;
      var s=JSON.parse(raw);
      if(!s.names||!Array.isArray(s.names)||!s.names.length){
        s.names=defaultNamesForBooklet().map(function(t,idx){return{id:uid(),text:t,isNew:false,createdAt:idx+1,bookletKey:BOOKLET_KEY};});
        s.assignments={}; s.spreads={};
      } else {
        s.names=s.names.map(function(n,idx){
          return {
            id:n.id,
            text:n.text,
            isNew:!!n.isNew,
            createdAt:Number(n.createdAt)||idx+1,
            bookletKey:sanitizeBookletKey(n.bookletKey||BOOKLET_KEY)
          };
        });
      }
      if(!s.layout3 || typeof s.layout3!=='object') s.layout3={};
      state=s;
      stripForeignLabelsFromState();
      dedupeLabelsInState();
      pageCount.value=String(state.pages||DEFAULT_PAGES);
      return true;
    }catch(_){return false;}
  }
  function saveLocal(){try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch(_){} }

  function isValidState(s){
    return !!(s && typeof s==='object' && Array.isArray(s.names));
  }

  function normalizeSpreads(){
    if(!state.spreads || typeof state.spreads!=='object'){
      state.spreads={};
      return;
    }

    var normalized={};
    Object.keys(state.spreads).forEach(function(key){
      var anchor=Number(key);
      var info=state.spreads[key]||{};
      var id=info.id;
      if(!anchor || !id) return;

      if(anchor===1 || anchor===2) return;

      if(info.dir==='prev'){
        var prevAnchor=anchor-1;
        if(prevAnchor<1) return;
        var fromPrev=list(anchor);
        var toPrev=list(prevAnchor);
        var idxPrev=fromPrev.indexOf(id);
        if(idxPrev>-1){
          fromPrev.splice(idxPrev,1);
          if(toPrev.indexOf(id)===-1) toPrev.push(id);
        }
        anchor=prevAnchor;
      }

      if(anchor%2===0){
        var leftAnchor=anchor-1;
        var fromEven=list(anchor);
        var toLeft=list(leftAnchor);
        var idxEven=fromEven.indexOf(id);
        if(idxEven>-1){
          fromEven.splice(idxEven,1);
          if(toLeft.indexOf(id)===-1) toLeft.push(id);
        }
        anchor=leftAnchor;
      }

      if(anchor===1 || anchor===2) return;
      normalized[anchor]={id:id,dir:'next'};
    });

    state.spreads=normalized;
  }

  function applyState(s){
    if(!isValidState(s)) return false;
    s.names=s.names.map(function(n,idx){
      return {
        id:n.id,
        text:n.text,
        isNew:!!n.isNew,
        createdAt:Number(n.createdAt)||idx+1,
        bookletKey:sanitizeBookletKey(n.bookletKey||BOOKLET_KEY)
      };
    });
    if(!s.assignments || typeof s.assignments!=='object') s.assignments={};
    if(!s.spreads || typeof s.spreads!=='object') s.spreads={};
    if(!s.layout3 || typeof s.layout3!=='object') s.layout3={};
    if(!s.pages || !isFinite(Number(s.pages))) s.pages=DEFAULT_PAGES;
    state=s;
    stripForeignLabelsFromState();
    dedupeLabelsInState();
    seedDefaultNamesIfEmpty();
    normalizeSpreads();
    pageCount.value=String(state.pages||DEFAULT_PAGES);
    return true;
  }

  function loadGlobal(opts){
    opts=opts||{};
    if(isGlobalSaveInFlight || hasPendingGlobalSave || saveTimer) return Promise.resolve();
    if(!opts.silent) setSaveStatus('saving');
    if(!opts.silent) setSyncDiagnostic('pending','GET /api/state');
    return fetch(API_STATE,{cache:'no-store'})
      .then(function(res){
        if(res.ok){
          lastKnownServerRev=res.headers.get('ETag') || lastKnownServerRev;
        }
        if(res.status===404) return null;
        if(!res.ok) throw new Error('GET /api/state '+res.status);
        return res.json();
      })
      .then(function(serverState){
        if(serverState===null){
          saveLocal();
          queueGlobalSave();
          if(!opts.silent) setSaveStatus('saved');
          if(!opts.silent) setSyncDiagnostic('ok','No remote state yet, uploading local');
          return;
        }
        var incomingFingerprint=stateFingerprint(serverState);
        if(incomingFingerprint && incomingFingerprint===lastServerFingerprint){
          setLastSyncedNow();
          if(!opts.silent) setSaveStatus('saved');
          if(!opts.silent) setSyncDiagnostic('ok','GET up-to-date');
          return;
        }
        if(pointerDrag) return;
        if(!applyState(serverState)) return;
        if(seedDefaultNamesIfEmpty()){
          saveLocal();
          queueGlobalSave();
        }
        suppressGlobalSave=true;
        preserveWindowScroll(function(){ build(); });
        suppressGlobalSave=false;
        saveLocal();
        lastServerFingerprint=incomingFingerprint;
        setLastSyncedNow();
        if(!opts.silent) setSaveStatus('saved');
        if(!opts.silent) setSyncDiagnostic('ok','GET applied global state');
      })
        .catch(function(err){
          if(!opts.silent) setSaveStatus('error');
          if(!opts.silent) setSyncDiagnostic('error', (err&&err.message) ? err.message : 'GET failed');
        });
  }

  function queueGlobalSave(){
    if(suppressGlobalSave) return;
    hasPendingGlobalSave=true;
    if(saveTimer) clearTimeout(saveTimer);
    setSaveStatus('saving');
    setSyncDiagnostic('pending','POST /api/state queued');
    if(isGlobalSaveInFlight) return;
    saveTimer=setTimeout(function(){
      saveTimer=null;
      flushGlobalSave();
    },0);
  }

  function flushGlobalSave(){
    if(isGlobalSaveInFlight) return;
    if(!hasPendingGlobalSave) return;
    hasPendingGlobalSave=false;
    try{
      var payload=JSON.stringify(state);
      lastServerFingerprint=payload;
      isGlobalSaveInFlight=true;
      var requestHeaders={'Content-Type':'application/json'};
      if(lastKnownServerRev) requestHeaders['If-Match']=lastKnownServerRev;
      fetch(API_STATE,{
        method:'POST',
        cache:'no-store',
        headers:requestHeaders,
        body:payload,
        keepalive:true
      }).then(function(res){
        if(res.status===409){
          lastKnownServerRev=res.headers.get('ETag') || lastKnownServerRev;
          throw new Error('stale-state-409');
        }
        if(!res.ok) throw new Error('state-save-failed-'+res.status);
        lastKnownServerRev=res.headers.get('ETag') || lastKnownServerRev;
        setLastSyncedNow();
        setSaveStatus('saved');
        setSyncDiagnostic('ok','POST /api/state '+res.status);
      }).catch(function(err){
        if(err && err.message==='stale-state-409'){
          hasPendingGlobalSave=true;
          setSaveStatus('saving');
          setSyncDiagnostic('pending','Stale revision, retrying save');
          return;
        }
        setSaveStatus('error');
        setSyncDiagnostic('error','POST /api/state failed');
      }).finally(function(){
        isGlobalSaveInFlight=false;
        if(hasPendingGlobalSave) flushGlobalSave();
      });
    }catch(_){
      isGlobalSaveInFlight=false;
      setSaveStatus('error');
      setSyncDiagnostic('error','POST serialization failed');
    }
  }

  function save(){
    saveLocal();
    queueGlobalSave();
  }

  function clearPlacedTagsFromDom(){
    [].slice.call(rowsEl.querySelectorAll('.cell[data-page]')).forEach(function(cell){
      var slot=cell.querySelector('.slot');
      if(slot) slot.innerHTML='';
      cell.classList.remove('spanning-host','spread-locked');
    });
  }

  function refreshTagDomFromState(){
    var sx=window.scrollX||0;
    var sy=window.scrollY||0;
    preserveWindowScroll(function(){
      clearPlacedTagsFromDom();
      renderAllTagsToPool();
      syncPlacedTagsFromState();
    });
    restoreScrollIfJumped(sx, sy);
  }

  function renderAllTagsToPool(){
    pool.innerHTML='';
    var visibleNames=sortNamesForPool(state.names);
    for(var i=0;i<visibleNames.length;i++){
      var n=visibleNames[i]; pool.appendChild(makeTag(n.text,n.id));
    }
    computeTargetTagWidth();
    adjustAllFonts();
  }

  function syncPlacedTagsFromState(){
    for(var pg=START; pg<=state.pages; pg+=1){
      var cell=getCell(pg);
      if(!cell) continue;
      var ids=(state.assignments[pg]||[]).slice();
      for(var k=0;k<ids.length;k++){
        var tag=document.querySelector('.tag[data-id="'+ids[k]+'"]');
        if(tag) placeInCell(tag,cell,false,true);
      }
      layoutCell(cell);
    }

    for(var a in state.spreads){ applySpanVisual(Number(a)); }
    adjustAllFonts();
  }

  function build(){
    if(sidePaletteEl) sidePaletteEl.classList.add('is-rebuilding');

    var total=Math.max(2,(Number(pageCount.value)||DEFAULT_PAGES));
    if(total%2===1) total+=1;
    state.pages=total;
    dedupeLabelsInState();
    normalizeSpreads();
    state.assignments[1]=[];
    state.assignments[2]=[];
    if(state.spreads[1]) delete state.spreads[1];
    if(state.spreads[2]) delete state.spreads[2];
    updateBadge();

    rowsEl.innerHTML='';
    renderAllTagsToPool();

    for(var p=START; p<=total; p+=2){
      var row=document.createElement('div');
      row.className='row';
      row.setAttribute('data-left',String(p));

      var g=document.createElement('div');
      g.className='gutter';
      row.appendChild(g);

      var bubble=document.createElement('div');
      bubble.className='bubble';
      bubble.innerHTML='<div class="bubbleGrid">\
        <div class="cell" data-page="'+p+'"></div>\
        <div class="centerDiv"></div>\
        <div class="cell" data-page="'+(p+1)+'"></div>\
      </div>';
      row.appendChild(bubble);

      if(p!==1){
        var pucks=document.createElement('div');
        pucks.className='pucks';
        pucks.innerHTML=
          '<button class="puck rem" title="Remove Spread">Del</button>'+
          '<button class="puck add" title="Add Spread">Add</button>'+
          '<div class="swap">'+
            '<button class="miniBtn up" title="Move Up">Up</button>'+
            '<button class="miniBtn down" title="Move Down">Down</button>'+
          '</div>';
        bubble.appendChild(pucks);

        (function(left){
          pucks.querySelector('.add').addEventListener('click',function(e){
            e.stopPropagation();
            rememberState();
            insertSpread(left);
          });
          var remBtn=pucks.querySelector('.puck.rem');
          if(remBtn) remBtn.addEventListener('click',function(e){
            e.stopPropagation();
            rememberState();
            removeSpread(left);
          });
          pucks.querySelector('.up').addEventListener('click',function(e){
            e.stopPropagation();
            rememberState();
            moveRow(left,-1);
          });
          pucks.querySelector('.down').addEventListener('click',function(e){
            e.stopPropagation();
            rememberState();
            moveRow(left,1);
          });
        })(p);
      }

      rowsEl.appendChild(row);

      initCell(getCell(p),p);
      initCell(getCell(p+1),p+1);

      [p,p+1].forEach(function(pg){
        var ids=(state.assignments[pg]||[]).slice();
        for(var k=0;k<ids.length;k++){
          var tag=document.querySelector('.tag[data-id="'+ids[k]+'"]');
          if(tag) placeInCell(tag,getCell(pg),false,true);
        }
        layoutCell(getCell(pg));
      });
    }

    for(var a in state.spreads){ applySpanVisual(Number(a)); }
    adjustAllFonts();

    requestAnimationFrame(function(){
      if(sidePaletteEl) sidePaletteEl.classList.remove('is-rebuilding');
    });
  }

  function getCell(p){ return rowsEl.querySelector('.cell[data-page="'+p+'"]'); }

  function initCell(cell,page){
    var locked=isLockedCoverPage(page);
    cell.classList.remove('page-left','page-right');
    cell.classList.add(page%2===0 ? 'page-right' : 'page-left');
    var dot='<div class="pageDot '+(page%2===0?'right':'left')+'">'+displayPageNumber(page)+'</div>';
    var cover = locked ? '<div class="coverFixed">'+coverNameForPage(page)+'</div>' : '';
    cell.innerHTML= '<div class="slot"></div>' + cover + dot;
    if(locked) cell.classList.add('locked');
    if(!locked) wireCell(cell);
  }

  function wireCell(cell){
    var p=Number(cell.getAttribute('data-page'));
    cell.addEventListener('dragover',function(e){e.preventDefault(); cell.classList.add('drop-target');});
    cell.addEventListener('dragleave',function(){ cell.classList.remove('drop-target'); });
    cell.addEventListener('drop',function(e){
      e.preventDefault();
      cell.classList.remove('drop-target');
      var id=e.dataTransfer.getData('text/plain');
      if(!id && selected) id=selected.getAttribute('data-id');
      var tag=id ? document.querySelector('.tag[data-id="'+id+'"]') : null;
      if(tag) drop(tag,cell);
    });
    cell.addEventListener('click',function(){
      if(!selected) return;
      drop(selected,cell);
      clearSel();
    });

  }

  function applySpanVisual(anchor){
    var info=state.spreads[anchor]; if(!info) return;
    var cell=getCell(anchor); if(!cell) return;
    var t=cell.querySelector('.slot .tag[data-id="'+info.id+'"]'); if(!t) return;
    cell.classList.add('spanning-host');
    t.classList.add('spanning','is-spread');
    if(info.dir==='next') t.classList.add('next'); else t.classList.add('prev');
    var oc=getCell(nb(anchor));
    if(oc){
      oc.classList.add('spread-locked');
      oc.querySelector('.slot').innerHTML='';
    }
  }
  function removeSpan(anchor){
    var cell=getCell(anchor);
    if(cell){
      cell.classList.remove('spanning-host');
      var t=cell.querySelector('.tag.spanning');
      if(t){
        t.classList.remove('spanning','is-spread','next','prev');
        t.classList.add('is-single');
      }
    }
    var oc=getCell(nb(anchor));
    if(oc) oc.classList.remove('spread-locked');
  }

  function setDominantInThree(cell, tag){
    var p=Number(cell.getAttribute('data-page'));
    if(!p || isLockedCoverPage(p)) return false;
    var slot=cell.querySelector('.slot');
    if(!slot) return false;
    var visualTags=[].slice.call(slot.querySelectorAll('.tag'));
    if(visualTags.length!==3) return false;

    var ids=list(p);
    if(!Array.isArray(ids) || ids.length!==3) return false;

    var id=tag.getAttribute('data-id');
    var idx=ids.indexOf(id);
    if(idx<=0) return false;

    ids.splice(idx,1);
    ids.unshift(id);

    var byId={};
    visualTags.forEach(function(t){ byId[t.getAttribute('data-id')] = t; });
    ids.forEach(function(currentId){
      var node=byId[currentId];
      if(node) slot.appendChild(node);
    });

    layoutCell(cell);
    return true;
  }

  function selectTag(t){
    var cell=t.closest('.cell');
    if(cell){
      var p=Number(cell.getAttribute('data-page'));
      var ids=list(p);
      var id=t.getAttribute('data-id');
      if(Array.isArray(ids) && ids.length===3){
        var idx=ids.indexOf(id);
        if(idx>0){
          rememberState();
          if(setDominantInThree(cell, t)) save();
        } else if(idx===0){
          rememberState();
          setThreeBottom(p, !getThreeBottom(p));
          layoutCell(cell);
          save();
        }
      }
    }
    if(selected) selected.classList.remove('sel');
    selected=t;
    t.classList.add('sel');
  }
  function clearSel(){
    if(selected){
      selected.classList.remove('sel');
      selected=null;
    }
  }

  function affecting(page){
    for(var a in state.spreads){
      var an=Number(a), info=state.spreads[a],
          other=(info.dir==='next'?an+1:an-1);
      if(page===an||page===other) return {anchor:an,id:info.id};
    }
    return null;
  }

  function drop(tag,cell){
    var p=Number(cell.getAttribute('data-page'));
    if(isLockedCoverPage(p)) return;
    var ids=list(p);
    var from=tag.closest('.cell');

    var aff=affecting(p);
    if(aff && !(aff.anchor===p && aff.id===tag.getAttribute('data-id'))){
      alert('Το ζεύγος είναι κλειδωμένο από spread. Απενεργοποιήστε το ↔ πρώτα.');
      return;
    }

    if(ids.length>=MAX){
      if(from && from!==cell){
        var first=ids[0];
        var ft=cell.querySelector('.tag[data-id="'+first+'"]');
        if(ft) placeInCell(ft,from,false);
      } else {
        alert('Η σελίδα έχει ήδη 4 ονόματα.');
        return;
      }
    }

    rememberState();
    placeInCell(tag,cell,true);
    save();
  }

  function placeInCell(tag,cell,focus,skip){
    var prev=tag.closest('.cell');
    if(prev){
      var pp=Number(prev.getAttribute('data-page'));
      var L=list(pp);
      var i=L.indexOf(tag.getAttribute('data-id'));
      if(i>-1) L.splice(i,1);
      if(state.spreads[pp] && state.spreads[pp].id===tag.getAttribute('data-id')){
        removeSpan(pp);
        delete state.spreads[pp];
      }
      layoutCell(prev);
    }

    var p=Number(cell.getAttribute('data-page'));
    var ids=list(p);
    if(!skip && ids.indexOf(tag.getAttribute('data-id'))===-1) ids.push(tag.getAttribute('data-id'));

    cell.querySelector('.slot').appendChild(tag);
    tag.onclick=function(e){e.stopPropagation(); selectTag(tag);};
    layoutCell(cell);

    if(focus){
      try{tag.scrollIntoView({block:'nearest',behavior:'smooth'});}catch(_){ }
    }
  }

  function moveToPool(tag){
    var prev=tag.closest('.cell');
    if(prev){
      var pp=Number(prev.getAttribute('data-page'));
      var L=list(pp);
      var i=L.indexOf(tag.getAttribute('data-id'));
      if(i>-1)L.splice(i,1);
      if(state.spreads[pp] && state.spreads[pp].id===tag.getAttribute('data-id')){
        removeSpan(pp);
        delete state.spreads[pp];
      }
      layoutCell(prev);
    }

    tag.classList.remove('is-half','is-quarter','is-single','half-row','spanning','is-spread','next','prev');
    tag.classList.remove('can-spread');
    [].slice.call(tag.querySelectorAll('.chip')).forEach(function(x){x.remove();});
    var lbl=tag.querySelector('.label'); if(lbl) lbl.style.fontSize='';
    pool.appendChild(tag);
    adjustTagFont(tag);
    save();
  }

  function layoutCell(cell){
    var slot=cell.querySelector('.slot');
    var tags=[].slice.call(slot.querySelectorAll('.tag'));
    var count=tags.length;

    slot.className='slot count-'+(count||1);

    var p=Number(cell.getAttribute('data-page'));
    if(count!==3) setThreeBottom(p, false);
    slot.classList.toggle('half-bottom', count===3 && getThreeBottom(p));
    if(count!==1 && state.spreads[p]){
      removeSpan(p);
      delete state.spreads[p];
    }

    tags.forEach(function(t){
      t.classList.remove('is-half','is-quarter','is-single','half-row','spanning','is-spread','next','prev','can-spread');
      [].slice.call(t.querySelectorAll('.chip.half,.chip.quarter')).forEach(function(x){x.remove();});
    });

    if(count===0) return;

    if(count===1){
      tags[0].classList.add('is-single');
      if(p%2===1 && p!==1 && p!==2){
        tags[0].classList.add('can-spread');
      }
    } else if(count===2){
      tags.forEach(function(t){
        t.classList.add('is-half');
        var b=document.createElement('span');
        b.className='chip half';
        b.textContent='1/2';
        t.appendChild(b);
      });
    } else if(count===3){
      tags.forEach(function(t,i){
        if(i===0){
          t.classList.add('is-half','half-row');
          var h=document.createElement('span');
          h.className='chip half';
          h.textContent='1/2';
          t.appendChild(h);
        } else {
          t.classList.add('is-quarter');
          var q=document.createElement('span');
          q.className='chip quarter';
          q.textContent='1/4';
          t.appendChild(q);
        }
      });
    } else {
      tags.forEach(function(t){
        t.classList.add('is-quarter');
        var q=document.createElement('span');
        q.className='chip quarter';
        q.textContent='1/4';
        t.appendChild(q);
      });
    }

    tags.forEach(adjustTagFont);
  }

  function clearCell(cell){
    var p=Number(cell.getAttribute('data-page'));
    if(state.spreads[p]){
      removeSpan(p);
      delete state.spreads[p];
    } else {
      var aff=affecting(p);
      if(aff && aff.anchor!==p){
        var ac=getCell(aff.anchor);
        if(ac){
          var t=ac.querySelector('.tag[data-id="'+aff.id+'"]');
          if(t) moveToPool(t);
          removeSpan(aff.anchor);
          delete state.spreads[aff.anchor];
          layoutCell(ac);
        }
      }
    }

    var ids=(list(p)||[]).slice();
    for(var i=0;i<ids.length;i++){
      var t=cell.querySelector('.tag[data-id="'+ids[i]+'"]');
      if(t) moveToPool(t);
    }
    state.assignments[p]=[];
    layoutCell(cell);
    save();
  }

  function insertSpread(left){
    var after=left+1;
    var na={}, keys=Object.keys(state.assignments).map(Number).sort(function(a,b){return a-b;});
    keys.forEach(function(k){ na[k<=after?k:k+2]=state.assignments[k]; });
    state.assignments=na;

    var ns={};
    for(var a in state.spreads){
      var an=Number(a);
      ns[an>after?an+2:an]=state.spreads[a];
    }
    state.spreads=ns;

    state.pages+=2;
    pageCount.value=String(state.pages);
    updateBadge();
    build();
    save();
  }

  function removeSpread(left){
    if(left===1) return;
    var right=left+1;

    [left,right].forEach(function(p){
      var ids=(list(p)||[]).slice();
      ids.forEach(function(id){
        var t=document.querySelector('.tag[data-id="'+id+'"]');
        if(t) moveToPool(t);
      });
      state.assignments[p]=[];
      if(state.spreads[p]){
        removeSpan(p);
        delete state.spreads[p];
      }
    });

    var na={}, keys=Object.keys(state.assignments).map(Number).sort(function(a,b){return a-b;});
    keys.forEach(function(k){
      if(k<left) na[k]=state.assignments[k];
      else if(k>right) na[k-2]=state.assignments[k];
    });
    state.assignments=na;

    var ns={};
    for(var a in state.spreads){
      var an=Number(a), info=state.spreads[a];
      if(an>right) ns[an-2]=info;
      else if(an<left) ns[an]=info;
    }
    state.spreads=ns;

    state.pages=Math.max(2,state.pages-2);
    pageCount.value=String(state.pages);
    updateBadge();
    build();
    save();
  }

  function moveRow(left,dir){
    var targetLeft = left + dir*2;
    if(targetLeft<1 || targetLeft+1>state.pages) return;
    if(left<=2 && dir<0) return;

    var A=[left,left+1], B=[targetLeft,targetLeft+1];
    var map={}; for(var p=1;p<=state.pages;p++){ map[p]=p; }
    map[A[0]]=B[0]; map[A[1]]=B[1]; map[B[0]]=A[0]; map[B[1]]=A[1];

    var newAssign={};
    Object.keys(state.assignments).forEach(function(k){
      var old=Number(k);
      newAssign[ map[old] ] = state.assignments[k];
    });
    state.assignments=newAssign;

    var newSp={};
    Object.keys(state.spreads).forEach(function(k){
      var old=Number(k);
      newSp[ map[old] ] = state.spreads[k];
    });
    state.spreads=newSp;

    build();
    focusMovedRow(targetLeft);
    save();
  }

  function focusMovedRow(leftPage){
    var row=rowsEl.querySelector('.row[data-left="'+leftPage+'"]');
    if(!row) return;
    try{
      row.scrollIntoView({behavior:'smooth', block:'center'});
    }catch(_){
      row.scrollIntoView();
    }
    row.classList.add('follow-focus');
    setTimeout(function(){
      row.classList.remove('follow-focus');
    },450);
  }

  function createMultiLabelField(value){
    var input=document.createElement('input');
    input.type='text';
    input.className='multiLabelInput';
    input.placeholder='Enter label…';
    input.value=value||'';
    return input;
  }

  function closeRenameLabelModal(){
    if(!renameLabelModal) return;
    renameLabelModal.hidden=true;
    pendingRenameLabelId='';
    if(renameLabelInput) renameLabelInput.value='';
  }

  function openRenameLabelModal(labelId, currentText){
    if(!renameLabelModal || !renameLabelInput) return;
    pendingRenameLabelId=labelId||'';
    renameLabelInput.value=currentText||'';
    renameLabelModal.hidden=false;
    setTimeout(function(){
      renameLabelInput.focus();
      try{ renameLabelInput.select(); }catch(_){ }
    },0);
  }

  function submitRenameLabel(){
    if(!pendingRenameLabelId || !renameLabelInput) return;
    var id=pendingRenameLabelId;
    var next=(renameLabelInput.value||'').trim();
    var current='';
    if(Array.isArray(state.names)){
      for(var i=0;i<state.names.length;i++){
        var rec=state.names[i];
        if(rec && rec.id===id){
          current=(rec.text||'').trim();
          break;
        }
      }
    }
    if(!next || next===current){
      closeRenameLabelModal();
      return;
    }
    if(labelExists(next, id)){
      alert('This name already exists.');
      return;
    }
    rememberState();
    if(!setLabelTextState(id, next)){
      closeRenameLabelModal();
      return;
    }
    closeRenameLabelModal();
    refreshTagDomFromState();
    save();
  }

  function appendMultiLabelField(value, shouldFocus){
    if(!multiLabelFields) return null;
    var input=createMultiLabelField(value);
    multiLabelFields.appendChild(input);
    if(shouldFocus){
      setTimeout(function(){ input.focus(); },0);
    }
    return input;
  }

  function closeMultiLabelModal(){
    if(!multiLabelModal) return;
    multiLabelModal.hidden=true;
    if(multiLabelFields) multiLabelFields.innerHTML='';
  }

  function openMultiLabelModal(){
    if(!multiLabelModal || !multiLabelFields) return;
    multiLabelFields.innerHTML='';
    appendMultiLabelField('', true);
    multiLabelModal.hidden=false;
  }

  addNameBtn.onclick=function(){
    openMultiLabelModal();
  };
  if(addMultiLabelFieldBtn) addMultiLabelFieldBtn.onclick=function(){
    appendMultiLabelField('', true);
  };
  if(cancelMultiLabelBtn) cancelMultiLabelBtn.onclick=function(){
    closeMultiLabelModal();
  };
  if(cancelRenameLabelBtn) cancelRenameLabelBtn.onclick=function(){
    closeRenameLabelModal();
  };
  if(confirmMultiLabelBtn) confirmMultiLabelBtn.onclick=function(){
    if(!multiLabelFields) return;
    var inputs=[].slice.call(multiLabelFields.querySelectorAll('input.multiLabelInput'));
    var seenDraft={};
    var created=[];
    var baseTime=Date.now();

    for(var i=0;i<inputs.length;i++){
      var raw=(inputs[i].value||'').trim();
      if(!raw) continue;

      var key=normalizeLabelText(raw);
      if(!key || seenDraft[key]) continue;
      seenDraft[key]=true;

      if(labelExists(raw)) continue;

      created.push({
        id:uid(),
        text:raw,
        isNew:false,
        createdAt:baseTime+i,
        bookletKey:BOOKLET_KEY
      });
    }

    if(!created.length){
      alert('No new labels to add.');
      return;
    }

    rememberState();
    if(!state.names) state.names=[];
    for(var j=0;j<created.length;j++) state.names.push(created[j]);
    closeMultiLabelModal();
    refreshTagDomFromState();
    save();
  };
  if(confirmRenameLabelBtn) confirmRenameLabelBtn.onclick=function(){
    submitRenameLabel();
  };
  document.addEventListener('keydown', function(ev){
    if(ev.key==='Escape'){
      if(renameLabelModal && !renameLabelModal.hidden){
        closeRenameLabelModal();
        return;
      }
      if(multiLabelModal && !multiLabelModal.hidden){
        closeMultiLabelModal();
        return;
      }
    }
    if(ev.key==='Enter' && renameLabelModal && !renameLabelModal.hidden){
      var renameTarget=ev.target;
      var isRenameInput=renameTarget===renameLabelInput;
      if(isRenameInput){
        ev.preventDefault();
        submitRenameLabel();
        return;
      }
    }
    if(ev.key==='Enter' && multiLabelModal && !multiLabelModal.hidden){
      var target=ev.target;
      var isInput=target && target.classList && target.classList.contains('multiLabelInput');
      if(isInput){
        ev.preventDefault();
        if(confirmMultiLabelBtn) confirmMultiLabelBtn.click();
      }
    }
  });
  if(renameLabelModal) renameLabelModal.addEventListener('click', function(ev){
    if(ev.target===renameLabelModal) closeRenameLabelModal();
  });
  if(multiLabelModal) multiLabelModal.addEventListener('click', function(ev){
    if(ev.target===multiLabelModal) closeMultiLabelModal();
  });
  resetNamesBtn.onclick=function(){
    if(!confirm('Return all labels to the right and clear all spreads/placements?')) return;
    rememberState();
    state.assignments={};
    state.spreads={};
    state.layout3={};
    build();
    save();
  };

  if(undoBtn) undoBtn.onclick=function(){
    if(!undoStack.length) return;
    isUndoing=true;
    state=undoStack.pop();
    pageCount.value=String(state.pages||DEFAULT_PAGES);
    updateUndoButton();
    build();
    save();
    isUndoing=false;
  };

  function initNames(){
    if(!state.names.length){
      state.names=defaultNamesForBooklet().map(function(t,idx){return{id:uid(),text:t,isNew:false,createdAt:idx+1,bookletKey:BOOKLET_KEY};});
    }
    stripForeignLabelsFromState();
  }
  function init(){ updateBadge(); build(); }

  if(!loadLocal()){
    pageCount.value=String(DEFAULT_PAGES);
    initNames();
  }
  if(bookletTitleEl) bookletTitleEl.textContent=BOOKLET_TITLE;
  updateTopNavActive();
  setNotifyButtonState('idle');
  try{
    var savedSort=localStorage.getItem(SORT_STORAGE);
    labelSortMode=normalizeLabelSortMode(savedSort);
  }catch(_){ labelSortMode='recent'; }
  if(labelSortEl){
    labelSortEl.value=labelSortMode;
    labelSortEl.onchange=function(){
      labelSortMode=normalizeLabelSortMode(labelSortEl.value);
      try{ localStorage.setItem(SORT_STORAGE,labelSortMode); }catch(_){ }
      applyCurrentSortToPoolOnly();
    };
  }
  updateFixedSidebarMetrics();
  updateUndoButton();
  setSaveStatus('saved');
  init();
  loadGlobal();
  globalSyncTimer=setInterval(function(){
    if(document.hidden) return;
    loadGlobal({silent:true});
  },2000);
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) loadGlobal({silent:true});
  });
  window.addEventListener('focus', function(){
    loadGlobal({silent:true});
  });

  if(sendRaniaBtn) sendRaniaBtn.onclick=function(){
    setNotifyButtonState('sending');
    fetch(API_NOTIFY,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        booklet: BOOKLET_TITLE,
        pages: Number(state.pages)||0,
        updatedAt: new Date().toISOString()
      })
    }).then(function(res){
      if(!res.ok) throw new Error('notify-failed');
      setNotifyButtonState('sent');
    }).catch(function(){
      setNotifyButtonState('error');
      alert('Could not send email notification. Please check server email settings.');
    });
  };

  applyBtn.onclick=function(){ rememberState(); build(); save(); };
  pageCount.oninput=updateBadge;
})();
