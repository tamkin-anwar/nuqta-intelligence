"use strict";

  /* ==================== HubSpot feed ==================== */

  var FEED_COPY = {
    needs_reauth:        {t:'HubSpot needs reconnecting', b:'Reconnect HubSpot in claude.ai Settings → Connectors to bring the pipeline back.'},
    server_not_connected:{t:'HubSpot not connected here', b:'Add HubSpot in claude.ai Settings → Connectors, then reload this page.'},
    selection_required:  {t:'Choose a HubSpot account',   b:'More than one HubSpot connector is available. Pick one when prompted, then reload.'},
    not_in_manifest:     {t:'HubSpot is off for this page', b:'The connector was declined or switched off for this artifact. Re-enable it to see live deals.'},
    blocked_by_policy:   {t:'Blocked by policy',          b:'Your organisation blocks this HubSpot tool. The tracked items below still work.'},
    approval_required:   {t:'Needs approval',             b:'This HubSpot call requires per-call approval, which artifacts cannot request yet.'},
    tool_error:          {t:'HubSpot returned an error',  b:'The connector answered but reported a failure. The tracked items below are unaffected.'},
    server_unavailable:  {t:'HubSpot unreachable',        b:'Showing the last data received. It will refresh on its own.'},
    upstream_error:      {t:'HubSpot call failed',        b:'Showing the last data received. It will refresh on its own.'}
  };
  var RETRACTING = {needs_reauth:1, server_not_connected:1, not_in_manifest:1, blocked_by_policy:1, approval_required:1, selection_required:1};

  function startFeed(){
    if (typeof claude === 'undefined' || !claude.use){
      feed = {state:'nomcp'}; render(); return;
    }
    claude.use('mcp').then(function(mcp){
      if (!mcp){ feed = {state:'nomcp'}; render(); return; }
      var input = {
        objectType:'DEAL',
        properties:['dealname','dealstage','amount','deal_currency_code','closedate','hs_lastmodifieddate','createdate'],
        limit:100,
        chatInsights:{userIntent:'Show the live sales pipeline on a personal operations dashboard', satisfaction:'NEUTRAL'}
      };
      mcp.watchTool('HubSpot','search_crm_objects', input, function(ev){
        if (ev.type === 'data'){
          var parsed = parseDeals(ev.result && ev.result.payload);
          if (parsed){
            deals = parsed;
            feed = {state:'ok', storedAt: (ev.result.cache && ev.result.cache.storedAt) || Date.now(),
                    cached: !!(ev.result.cache)};
            renderDealPillars();
          } else {
            feed = {state:'error', code:'tool_error'};
          }
        } else {
          var code = (ev.error && ev.error.code) || 'upstream_error';
          if (RETRACTING[code]){ deals = []; renderDealPillars(); }
          feed = {state:'error', code:code};
        }
        render();
      }, {refetchInterval: 300000});
    }).catch(function(){ feed = {state:'nomcp'}; render(); });
  }

  // Outlook connector answers with one text block per message rather than a
  // single JSON array; parseMail (in logic.js) reads result.content and
  // parses each block.
  function startMailFeed(){
    if (typeof claude === 'undefined' || !claude.use) { mailFeed = {state:'nomcp'}; return; }
    claude.use('mcp').then(function(mcp){
      if (!mcp){ mailFeed = {state:'nomcp'}; render(); return; }
      mcp.watchTool('Microsoft 365','outlook_email_search',
        {folderName:'Inbox', order:'newest', limit:25},
        function(ev){
          if (ev.type === 'data'){
            mail = parseMail(ev.result);
            mailFeed = {state:'ok',
              storedAt:(ev.result.cache && ev.result.cache.storedAt) || Date.now(),
              cached: !!(ev.result.cache)};
          } else {
            var code = (ev.error && ev.error.code) || 'upstream_error';
            if (RETRACTING[code]) mail = {human:[], vendor:[], total:0};
            mailFeed = {state:'error', code:code};
          }
          render();
        }, {refetchInterval: 300000});
    }).catch(function(){ mailFeed = {state:'nomcp'}; render(); });
  }

  /* ==================== persistence ==================== */

  // Shared document shapes (schema v1). Not enforced anywhere — these are
  // the fields absorb()/writeWork()/saveMilestones() read and write, written
  // down so a future v2 knows what it's migrating from:
  //   workstreams/<id>:  {v, name, co, status, note, link, surface, home, touched}
  //   workspace/milestones: {v, done: {milestoneId: timestamp}, updatedAt}
  //   agent_<distId>_messages/<id>: {v, role, text, at}   -- see agent.js
  function initDb(){
    if (typeof claude === 'undefined' || !claude.use) return;
    claude.use('db').then(function(h){
      if (!h) return;
      db = h;
      var ref = db.doc('workspace/milestones');
      ref.get().then(function(s){
        if (s.exists && s.data() && s.data().done){ doneMap = s.data().done; render(); }
      }).catch(function(){});
      ref.onSnapshot(function(s){
        if (s.exists && s.data() && s.data().done){ doneMap = s.data().done; render(); }
      }, function(){});
      msRef = ref;

      // Workstreams live one doc per thread so any conversation can add or edit
      // a single thread without rewriting the whole board.
      // A one-shot get() runs alongside the subscription: if live updates are
      // unavailable the board still fills in, and any failure is shown, not swallowed.
      var col;
      try { col = db.collection('workstreams'); }
      catch (e){ workErr('bad collection path: ' + (e && e.message)); return; }
      worksCol = col;

      function absorb(snap){
        var next = [];
        (snap && snap.docs ? snap.docs : []).forEach(function(doc){
          var v = doc.data() || {};
          next.push({
            id: doc.id,
            v: v.v || 1,
            name: v.name || doc.id,
            co: v.co || 'av',
            status: WORK_STATUS[v.status] ? v.status : 'active',
            note: v.note || '',
            link: v.link || '',
            surface: v.surface || 'chat',
            home: v.home || '',
            touched: v.touched || null
          });
        });
        works = next; worksLoaded = true;
        worksFeed = {state:'ok', msg:''};
        render(); renderWorkers();
      }

      col.get().then(absorb).catch(function(e){
        workErr('read failed: ' + ((e && (e.code || e.message)) || 'unknown'));
      });
      try {
        col.onSnapshot(absorb, function(e){
          // a live-update failure is not fatal if get() already filled the board
          if (!worksLoaded) workErr('live updates failed: ' + ((e && (e.code || e.message)) || 'unknown'));
        });
      } catch (e){ /* get() is the fallback */ }
    }).catch(function(e){
      workErr('store unavailable: ' + ((e && (e.code || e.message)) || 'unknown'));
    });
  }

  function workErr(msg){
    if (window.console && console.error) console.error('[nuqta] workstreams — ' + msg);
    worksLoaded = true;
    worksFeed = {state:'error', msg:msg};
    render();
  }

  function writeWork(id, patch){
    patch.v = 1;   // stamps the doc with the current schema version on every write
    var w = works.filter(function(x){ return x.id === id; })[0];
    if (w) { for (var k in patch) w[k] = patch[k]; }   // optimistic, snapshot corrects
    render(); renderWorkers();
    if (worksCol) worksCol.doc(id).update(patch).catch(function(e){
      workErr('write failed: ' + ((e && (e.code || e.message)) || 'unknown'));
    });
  }
  function touchWork(id){ writeWork(id, {touched: Date.now()}); }
  function setWorkStatus(id, st){
    var patch = {status: st};
    if (st !== 'shipped' && st !== 'parked') patch.touched = Date.now();
    writeWork(id, patch);
  }
  function saveMilestones(){
    if (msRef) msRef.set({v:1, done:doneMap, updatedAt:Date.now()}).catch(function(){});
  }
  function toggleMilestone(id){
    if (doneMap[id]) delete doneMap[id]; else doneMap[id] = Date.now();
    saveMilestones(); render();
  }

  /* ==================== rendering ==================== */

  var listEl = document.getElementById('list');

  function render(){
    renderClocks();
    renderList();
    renderMail();
    renderFoot();
    renderExec();
    if (activeId) renderDrawer();
  }

  function renderClocks(){
    var g = daysBetween(new Date(), GATE_DATE);
    var w = daysBetween(new Date(), WEDDING);
    var gEl = document.getElementById('gateN'), wEl = document.getElementById('wedN');
    gEl.textContent = g < 0 ? '—' : g;
    gEl.classList.toggle('warn', g <= 45);
    wEl.textContent = w < 0 ? '—' : w;
  }

  function renderList(){
    var all = signals();
    var shown = filterMode === 'needs' ? all.filter(function(s){ return s.needs; })
              : filterMode === 'work'  ? all.filter(function(s){ return s.kind === 'work'; })
              : all;
    var nc = filterMode === 'work'
      ? all.filter(function(x){ return x.kind === 'work' && x.needs; }).length
      : needsCount();
    document.getElementById('cnt').textContent = nc ? nc+' need you' : 'All clear';
    document.getElementById('cnt').classList.toggle('warn', nc>0);

    var html = '';
    if (feed.state === 'error' && FEED_COPY[feed.code]){
      var c = FEED_COPY[feed.code];
      html += '<div class="notice'+(RETRACTING[feed.code]?' bad':'')+'"><h4>HubSpot — '+c.t+'</h4><p>'+c.b+'</p></div>';
    }
    if (worksFeed.state === 'error'){
      html += '<div class="notice bad"><h4>Workstream board did not load</h4>'+
              '<p>'+esc(worksFeed.msg)+'</p></div>';
    }
    if (feed.state === 'nomcp'){
      html += '<div class="notice"><h4>Live deal feed unavailable here</h4>'+
              '<p>Open this page inside Claude with the HubSpot connector on to see deals. Workstreams and tracked items below work either way.</p></div>';
    }

    GROUPS.forEach(function(d){
      var rows = shown.filter(function(s){ return s.dist === d.id; });
      if (!rows.length && (filterMode !== 'all' || d.virtual)) return;
      var KO = {work:0, deal:1, milestone:2};
      rows = rows.slice().sort(function(a,b){
        if (KO[a.kind] !== KO[b.kind]) return KO[a.kind] - KO[b.kind];
        if (a.kind === 'work'){
          var oa = WORK_RANK.indexOf(a.work.status), ob = WORK_RANK.indexOf(b.work.status);
          if (oa !== ob) return oa - ob;
          return (b.work.touched||0) - (a.work.touched||0);
        }
        return 0;
      });
      html += '<div class="grp" style="--accent:'+d.css+'">';
      html += '<div class="grp-head" data-focus="'+d.id+'">'+
                '<span class="tag">'+d.tag+'</span>'+
                '<span class="nm">'+d.name+'</span>'+
                '<span class="src '+d.feed+'">'+(d.feed==='live'?'Live':d.feed==='dormant'?'Dormant':'Tracked')+'</span>'+
                (!d.virtual ? '<button class="talk" data-agent="'+d.id+'" title="Talk to '+esc(d.name)+'">&#9998;</button>' : '')+
              '</div>';
      // Finished and parked work folds away, otherwise the board silts up and
      // stops being something you can read at a glance.
      function settled(s){
        return s.kind === 'work' && (s.work.status === 'shipped' || s.work.status === 'parked');
      }
      var live = rows.filter(function(s){ return !settled(s); });
      var rest = rows.filter(settled);

      if (!live.length && !rest.length){
        html += '<div class="empty" style="padding:8px 10px;font-size:11.5px;">Nothing open.</div>';
      }
      function rowHtml(s){
        var jump = (s.kind === 'work' && s.work.link)
          ? '<button class="jump" data-open="'+esc(s.work.link)+'" title="Open it">&#8599;</button>' : '';
        return '<div class="row'+(s.needs?' needs':'')+(s.done?' done':'')+(activeId===s.id?' active':'')+
               '" style="--accent:'+d.css+'" data-id="'+s.id+'">'+
               '<div class="tick">'+(s.done?'✓':'')+'</div>'+
               '<div class="bd"><div class="t1"><div class="ttl">'+esc(s.title)+'</div>'+
               '<div class="st'+(s.needs?' warn':(s.done?' ok':''))+'">'+s.status+'</div></div>'+
               '<div class="meta">'+esc(s.meta)+'</div></div>'+ jump +'</div>';
      }
      live.forEach(function(s){ html += rowHtml(s); });
      if (rest.length){
        var shipped = rest.filter(function(s){ return s.work.status === 'shipped'; }).length;
        var parked  = rest.length - shipped;
        var bits = [];
        if (shipped) bits.push(shipped + ' shipped');
        if (parked)  bits.push(parked + ' parked');
        html += '<div class="arch'+(archOpen[d.id]?' open':'')+'" data-arch="'+d.id+'">'+
                '<span class="cv">&#9656;</span>' + bits.join(' · ') + '</div>';
        if (archOpen[d.id]) rest.forEach(function(s){ html += rowHtml(s); });
      }
      html += '</div>';
    });

    if (!shown.length && filterMode === 'needs') html += '<div class="empty">Nothing waiting on you.</div>';
    if (!shown.length && filterMode === 'work')
      html += '<div class="empty">No chats on the board yet. Tell me in any conversation to add one and it appears here and in the world.</div>';
    listEl.innerHTML = html;

    Array.prototype.forEach.call(listEl.querySelectorAll('.row'), function(r){
      r.addEventListener('click', function(){ openDrawer(r.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.jump'), function(j){
      j.addEventListener('click', function(ev){
        ev.stopPropagation();          // the arrow goes to the thread, not the drawer
        window.open(j.getAttribute('data-open'), '_blank', 'noopener');
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.arch'), function(a){
      a.addEventListener('click', function(){
        var k = a.getAttribute('data-arch');
        archOpen[k] = !archOpen[k]; renderList();
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.grp-head'), function(g){
      g.addEventListener('click', function(){
        var dd = district(g.getAttribute('data-focus'));
        if (dd) focusDistrict(dd);   // Anwar Ventures is a group, not a place on the map
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.talk'), function(t){
      t.addEventListener('click', function(ev){
        ev.stopPropagation();   // don't also pan the camera via the group-head handler above
        openAgent(t.getAttribute('data-agent'));
      });
    });
  }

  function renderFoot(){
    var s = document.getElementById('feedState'), t = document.getElementById('feedTime');
    function bit(f, okText){
      if (f.state === 'ok')    return '<span class="dot"></span>' + okText;
      if (f.state === 'error') return '<span class="dot bad"></span>offline';
      if (f.state === 'nomcp') return '<span class="dot idle"></span>off';
      return '<span class="dot idle"></span>…';
    }
    var live = works.filter(function(w){ return w.status==='active'||w.status==='blocked'||w.status==='review'; }).length;
    s.innerHTML =
      '<span><span class="dot'+(worksLoaded?'':' idle')+'"></span>' + live + ' running</span>' +
      '<span style="opacity:.4;margin:0 7px">|</span>' +
      bit(feed, deals.length + ' deal' + (deals.length===1?'':'s'));
    var newest = feed.storedAt||0;
    if (newest){
      var mins = Math.floor((Date.now()-newest)/60000);
      t.textContent = mins < 1 ? 'just now' : mins+'m ago';
    } else t.textContent = '';
  }

  var mailPanel = document.getElementById('mailp');
  document.getElementById('mailHead').onclick = function(){
    mailOpen = !mailOpen; mailPanel.classList.toggle('open', mailOpen); renderMail();
  };

  function renderMail(){
    var v = document.getElementById('mailV'), b = document.getElementById('mailBody');
    if (mailFeed.state === 'ok'){
      v.textContent = mail.human.length ? mail.human.length + ' from people' : 'no people';
      v.classList.toggle('warn', mail.human.length > 0);
    } else if (mailFeed.state === 'error'){ v.textContent = 'offline'; v.classList.remove('warn'); }
    else if (mailFeed.state === 'nomcp'){ v.textContent = 'off'; v.classList.remove('warn'); }
    else { v.textContent = '…'; v.classList.remove('warn'); }
    if (!mailOpen) return;

    if (mailFeed.state !== 'ok'){
      b.innerHTML = '<div class="mnote">' +
        (mailFeed.state === 'nomcp'
          ? 'Open this page inside Claude with the Microsoft 365 connector on.'
          : mailFeed.state === 'error' ? 'Outlook is not answering right now.'
          : 'Checking Outlook…') + '</div>';
      return;
    }
    var h = '';
    if (!mail.human.length){
      h += '<div class="mnote">Nothing from a person. ' + mail.vendor.length +
           ' vendor and automated message' + (mail.vendor.length===1?'':'s') +
           ' out of ' + mail.total + ' in the inbox.</div>';
    } else {
      mail.human.forEach(function(m){
        var age = daysAgo(m.at);
        h += '<div class="mrow" data-link="'+esc(m.link||'')+'">'+
             '<div class="s">'+esc(m.subject || '(no subject)')+'</div>'+
             '<div class="f">'+esc(m.fromName)+' · '+(age===0?'today':age+'d ago')+
             (m.unread?' · unread':'')+'</div></div>';
      });
      h += '<div class="mnote" style="font-style:normal;padding-top:8px;">'+
           mail.vendor.length+' vendor / automated hidden</div>';
    }
    b.innerHTML = h;
    Array.prototype.forEach.call(b.querySelectorAll('.mrow'), function(r){
      r.onclick = function(){
        var l = r.getAttribute('data-link');
        if (l) window.open(l,'_blank','noopener');
      };
    });
  }

  function esc(x){ return String(x==null?'':x).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  /* ---------- drawer ---------- */

  var dw = document.getElementById('dw');
  function openDrawer(id){ activeId = id; renderDrawer(); dw.classList.add('open'); renderList(); }
  function closeDrawer(){ activeId = null; dw.classList.remove('open'); renderList(); }
  document.getElementById('dwClose').onclick = closeDrawer;
  document.getElementById('dwScrim').onclick = closeDrawer;

  function renderDrawer(){
    var s = signalById(activeId);
    if (!s){ closeDrawer(); return; }
    var d = group(s.dist);
    var eye = document.getElementById('dEye');
    eye.textContent = d.name + ' · ' + (s.kind === 'deal' ? 'Live from HubSpot' :
      s.kind === 'work' ? (SURFACE[s.work.surface] || 'Chat') : 'Tracked here');
    eye.style.color = d.css;
    document.getElementById('dTitle').textContent = s.title;
    var sub = document.getElementById('dSub');
    sub.textContent = s.status;
    sub.style.color = s.needs ? 'var(--amber)' : (s.done ? 'var(--go)' : 'var(--text-dim)');

    var kv = document.getElementById('dDetail'), rows = '';
    if (s.kind === 'work'){
      rows += '<dt>Company</dt><dd>'+esc(d.name)+'</dd>';
      rows += '<dt>Where</dt><dd>'+esc(SURFACE[s.work.surface] || 'Chat')+
              (s.work.home ? ' <span style="color:var(--text-faint)">· '+esc(s.work.home)+'</span>' : '')+'</dd>';
      rows += '<dt>Status</dt><dd>'+esc(s.wstat.label)+'</dd>';
      rows += '<dt>Last touched</dt><dd>'+(s.age===null?'<span style="color:var(--text-faint)">never</span>':s.age===0?'today':s.age===1?'yesterday':s.age+' days ago')+'</dd>';
      if (s.work.link) rows += '<dt>Link</dt><dd style="color:var(--text-dim);word-break:break-all">'+esc(s.work.link.replace(/^https?:\/\//,''))+'</dd>';
    } else if (s.kind === 'deal'){
      rows += '<dt>Stage</dt><dd>'+esc(s.stage.label)+'</dd>';
      rows += '<dt>Last touched</dt><dd>'+(s.age===0?'today':s.age+' days ago')+'</dd>';
      if (s.deal.amount) rows += '<dt>Amount</dt><dd>'+s.deal.currency+' '+s.deal.amount.toLocaleString()+'</dd>';
      else rows += '<dt>Amount</dt><dd style="color:var(--text-faint)">not set</dd>';
      rows += '<dt>Close date</dt><dd>'+(s.deal.closedate ? new Date(s.deal.closedate).toLocaleDateString() : '<span style="color:var(--text-faint)">not set</span>')+'</dd>';
      if (s.deal.created) rows += '<dt>Created</dt><dd>'+new Date(s.deal.created).toLocaleDateString()+'</dd>';
    } else {
      rows += '<dt>District</dt><dd>'+esc(d.name)+'</dd>';
      rows += '<dt>Status</dt><dd>'+(s.done?'Done':'Open')+'</dd>';
      if (s.done) rows += '<dt>Marked</dt><dd>'+new Date(doneMap[s.id]).toLocaleDateString()+'</dd>';
      rows += '<dt>Source</dt><dd>Tracked in this workspace</dd>';
    }
    kv.innerHTML = rows;

    var why = document.getElementById('dWhy');
    if (s.kind === 'work'){
      why.textContent = s.work.note ? s.work.note :
        s.work.status === 'blocked' ? 'Stopped until you decide something or hand something over.' :
        s.work.status === 'review'  ? 'The work is done. It is waiting on you to look at it.' :
        s.stale ? 'Open for ' + s.age + ' days with nothing moving. Either pick it back up or park it — a board full of quiet threads stops meaning anything.' :
        s.work.status === 'parked'  ? 'Deliberately paused. Not a failure, just not now.' :
        s.work.status === 'shipped' ? 'Done and out.' :
        'Running. Nothing needed from you right now.';
    } else if (s.kind === 'deal'){
      why.textContent = s.needs
        ? 'No activity for ' + s.age + ' days. A deal at ' + s.stage.label + ' that goes quiet usually needs a call, not another email.'
        : 'Open and recently touched. Nothing to do here right now.';
    } else {
      why.textContent = s.done
        ? 'Closed out. Untick it if that changes.'
        : (s.note || 'Open item.');
    }

    var ft = document.getElementById('dFoot');
    ft.innerHTML = '';
    function btn(txt, cls, fn){
      var b = document.createElement('button'); b.className='btn '+cls; b.textContent=txt;
      b.onclick = fn; ft.appendChild(b);
    }
    if (s.kind === 'work'){
      if (s.work.link){
        var dest = /\/project\//.test(s.work.link) ? 'Open the project'
                 : /\/artifact\//.test(s.work.link) ? 'Open the page' : 'Open';
        btn(dest,'link', function(){ window.open(s.work.link,'_blank','noopener'); });
      }
      if (s.work.status !== 'shipped') btn('Touched today','undo', function(){ touchWork(s.work.id); });
      var sel = document.createElement('select');
      sel.className = 'wsel';
      WORK_ORDER.forEach(function(k){
        var o = document.createElement('option');
        o.value = k; o.textContent = WORK_STATUS[k].label;
        if (k === s.work.status) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function(){ setWorkStatus(s.work.id, sel.value); };
      ft.appendChild(sel);
    } else if (s.kind === 'deal'){
      if (s.deal.url) btn('Open in HubSpot','link', function(){ window.open(s.deal.url,'_blank','noopener'); });
      else { var n=document.createElement('div'); n.className='ftnote'; n.textContent='No record link available'; ft.appendChild(n); }
    } else {
      if (s.done) btn('Mark not done','undo', function(){ toggleMilestone(s.id); });
      else btn('Mark done','pri', function(){ toggleMilestone(s.id); });
    }
  }


  /* ---------- filters, exec ---------- */

  document.getElementById('fAll').onclick   = function(){ setFilter('all'); };
  document.getElementById('fNeeds').onclick = function(){ setFilter('needs'); };
  document.getElementById('fWork').onclick  = function(){ setFilter('work'); };
  function setFilter(mode){
    filterMode = mode;
    document.getElementById('fAll').classList.toggle('on', mode==='all');
    document.getElementById('fNeeds').classList.toggle('on', mode==='needs');
    document.getElementById('fWork').classList.toggle('on', mode==='work');
    renderList();
  }

  var execLayer = document.getElementById('execLayer'), ecards = {};
  DISTRICTS.forEach(function(d){
    var e = document.createElement('div');
    e.className='ecard'; e.style.setProperty('--accent', d.css);
    e.innerHTML = '<div class="en"></div><div class="es"></div><div class="bar"><i></i></div>';
    e.onclick = function(){ focusDistrict(d); };
    execLayer.appendChild(e); ecards[d.id] = e;
  });
  document.getElementById('execBtn').onclick = function(){ setExec(!execOn); };
  function setExec(on){
    execOn = on;
    document.getElementById('execBtn').classList.toggle('on', on);
    document.body.classList.toggle('exec', on);
    if (on){ closeDrawer(); camG.set(CITY.x, 0, CITY.z); ZOOM.tgt = 50; } else { camG.set(2,0,8); ZOOM.tgt = 34; }
    renderExec();
  }
  function renderExec(){
    if (!execOn) return;
    DISTRICTS.forEach(function(d){
      var e = ecards[d.id]; if(!e) return;
      var mine = signalsOf(d.id);
      var needs = mine.filter(function(s){return s.needs;}).length;
      var done = mine.filter(function(s){return s.done;}).length;
      var total = mine.length;
      e.querySelector('.en').textContent = d.name;
      var bits = [];
      if (d.feed === 'live') bits.push(deals.length + ' deal' + (deals.length===1?'':'s'));
      if (d.feed === 'dormant') bits.push('dormant');
      bits.push('<span class="'+(needs?'w':'')+'">'+needs+' need you</span>');
      bits.push(done+'/'+total+' done');
      e.querySelector('.es').innerHTML = bits.map(function(b){return '<span>'+b+'</span>';}).join('');
      e.querySelector('.bar i').style.width = (total ? Math.round(done/total*100) : 0)+'%';
      e.classList.toggle('alert', needs>0);
    });
  }
  function positionExec(){
    if (!execOn) return;
    var v = new THREE.Vector3();
    DISTRICTS.forEach(function(d){
      var e = ecards[d.id]; if(!e) return;
      v.set(d.pos.x, 7, d.pos.z).project(camera);
      e.style.transform = 'translate(-50%,-50%) translate('+
        Math.round((v.x*0.5+0.5)*window.innerWidth)+'px,'+
        Math.round((-v.y*0.5+0.5)*window.innerHeight)+'px)';
    });
  }

