"use strict";

  /* ---------- agent chat ---------- */

  function initAgent(){
    if (typeof claude === 'undefined' || !claude.use) return;
    claude.use('sample').then(function(s){
      sample = s;
      agentReady = !!s;
      if (activeAgent) renderAgentPanel();
    }).catch(function(){ agentReady = false; if (activeAgent) renderAgentPanel(); });
  }

  function initAgentStore(distId){
    if (!db) return;   // db capability unavailable entirely for this view
    var col;
    try { col = db.collection('agent_' + distId + '_messages'); }
    catch (e) { col = null; }
    if (!col) return;
    agentCols[distId] = col;
    col.orderBy('at', 'asc').limit(200).get().then(function(snap){
      var loaded = (snap.docs || []).map(function(doc){
        var v = doc.data() || {}; return {role: v.role, text: v.text};
      });
      if (loaded.length) agentMsgs[distId] = loaded;
      if (activeAgent === distId) renderAgentPanel();
    }).catch(function(){});
  }

  function persistAgentMsg(distId, role, text){
    var col = agentCols[distId];
    if (!col) return;
    // No pruning yet — fine for daily personal use, but an artifact database
    // caps at 5,000 documents total, so this will need rotation eventually.
    col.add({role: role, text: text, at: Date.now()}).catch(function(){});
  }

  var ap = document.getElementById('ap');
  var agentPanel = document.getElementById('agentPanel');
  var apMsgs = document.getElementById('apMsgs');
  var apText = document.getElementById('apText');
  var apSend = document.getElementById('apSend');

  function hexToRgbTriplet(hex){
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? (parseInt(m[1],16)+','+parseInt(m[2],16)+','+parseInt(m[3],16)) : '196,154,60';
  }

  function openAgent(distId){
    activeAgent = distId;
    if (!agentMsgs[distId]) agentMsgs[distId] = [];
    var d = district(distId);
    if (d) agentPanel.style.setProperty('--accent-rgb', hexToRgbTriplet(d.css));
    renderAgentPanel();
    ap.classList.add('open');
    if (!agentStoreInit[distId]) { agentStoreInit[distId] = true; initAgentStore(distId); }
  }
  function closeAgent(){ activeAgent = null; ap.classList.remove('open'); }
  document.getElementById('apClose').onclick = closeAgent;
  document.getElementById('apScrim').onclick = closeAgent;

  function renderAgentPanel(){
    if (!activeAgent) return;
    var d = district(activeAgent);
    var eye = document.getElementById('apEye');
    eye.textContent = d.name + ' · Agent';
    eye.style.color = d.css;
    document.getElementById('apTitle').textContent = d.name;

    var list = agentMsgs[activeAgent] || [];
    var html = '';
    if (!agentReady){
      html = '<div class="mnote" style="padding:16px 0;">Agent unavailable here — open this page inside Claude to talk to ' + esc(d.name) + '.</div>';
    } else if (!list.length){
      html = '<div class="mnote" style="padding:16px 0;">Ask anything about ' + esc(d.name) + ' — open workstreams, next steps, anything on the board.</div>';
    } else {
      list.forEach(function(m){
        if (m.error) html += '<div class="msg agent err">' + esc(m.error) + '</div>';
        else html += '<div class="msg ' + (m.role === 'user' ? 'user' : 'agent') + '">' +
                     esc(m.text) + (m.pending ? '<span class="cursor">▍</span>' : '') + '</div>';
      });
    }
    apMsgs.innerHTML = html;
    apMsgs.scrollTop = apMsgs.scrollHeight;
    apSend.disabled = !agentReady || agentBusy;
  }

  // Tools let the agent act on the board, not just describe it — "mark
  // Doorsong shipped" actually calls setWorkStatus. Scoped to this
  // district's own workstreams (checked in execute, not just trusted from
  // the model) so a company's agent can't touch another company's data.
  function buildAgentTools(distId){
    function findWork(id){
      return works.filter(function(w){ return w.id === id && w.co === distId; })[0];
    }
    return [
      {
        name: 'set_workstream_status',
        description: 'Change a workstream\'s status for this company. Valid statuses: ' +
          WORK_ORDER.join(', ') + '. Returns the updated workstream.',
        inputSchema: {type:'object', properties:{
          workId: {type:'string', description:'The workstream id, as listed in the board context.'},
          status: {type:'string', enum: WORK_ORDER}
        }, required:['workId','status']},
        execute: function(input){
          var w = findWork(String(input.workId||''));
          if (!w) throw new Error('No workstream with that id for this company.');
          var status = String(input.status||'');
          if (!WORK_STATUS[status]) throw new Error('Unknown status: ' + status);
          setWorkStatus(w.id, status);
          return {id: w.id, name: w.name, status: status};
        }
      },
      {
        name: 'touch_workstream',
        description: 'Mark a workstream as touched today, clearing any "gone quiet" warning.',
        inputSchema: {type:'object', properties:{
          workId: {type:'string', description:'The workstream id, as listed in the board context.'}
        }, required:['workId']},
        execute: function(input){
          var w = findWork(String(input.workId||''));
          if (!w) throw new Error('No workstream with that id for this company.');
          touchWork(w.id);
          return {id: w.id, name: w.name, touched: 'today'};
        }
      }
    ];
  }

  function sendAgentMessage(distId, text){
    if (!sample || agentBusy || !text) return;
    agentBusy = true;
    var d = district(distId);
    var list = agentMsgs[distId] || (agentMsgs[distId] = []);
    list.push({role: 'user', text: text});
    persistAgentMsg(distId, 'user', text);
    var pendingIdx = list.length;
    list.push({role: 'agent', text: '', pending: true});
    renderAgentPanel();

    // Fresh company context goes on the latest user turn only, not as a
    // separate leading turn — sample() turns should alternate user/assistant
    // the way the conversation actually happened, so the context rides
    // along with the real message instead of breaking that alternation.
    // Ids are included (not just names) so the model can address a specific
    // workstream when it calls a tool.
    var contextLines = works.filter(function(w){ return w.co === distId; })
      .map(function(w){ return '- ' + w.id + ': ' + w.name + ' (' + ((WORK_STATUS[w.status]||{}).label||w.status) + ')'; });
    var context = 'You are the assistant embedded in the Nuqta Intelligence dashboard for ' +
      d.name + '. Current open workstreams for this company (id: name (status)):\n' +
      (contextLines.length ? contextLines.join('\n') : '(none tracked)') +
      '\n\nYou can change a workstream\'s status or mark it touched using the tools ' +
      'provided, or just answer directly. Be concise.\n\n';

    var turns = list.filter(function(m){ return !m.pending; }).map(function(m, i, arr){
      var isLastUser = (m.role === 'user' && i === arr.length - 1);
      return {role: m.role === 'agent' ? 'assistant' : 'user', content: isLastUser ? context + m.text : m.text};
    });

    sample(turns, {
      modelTier: 'default',
      cache: false,
      tools: buildAgentTools(distId),
      onText: function(ev){ list[pendingIdx].text = ev.text; renderAgentPanel(); }
    }).then(function(res){
      list[pendingIdx] = {role: 'agent', text: res.text};
      agentBusy = false;
      renderAgentPanel();
      persistAgentMsg(distId, 'agent', res.text);
    }).catch(function(e){
      var code = e && e.code;
      var msg = code === 'not_granted' ? 'Agent access was not granted for this view.'
              : code === 'rate_limited' ? 'Rate limited — try again in a moment.'
              : code === 'tools_unavailable' ? 'This view can\'t run board actions — try asking without one.'
              : (e && e.message) || 'The agent could not answer.';
      list[pendingIdx] = {role: 'agent', text: '', error: msg};
      agentBusy = false;
      renderAgentPanel();
    });
  }

  function doSendAgent(){
    if (!agentReady || agentBusy) return;   // matches apSend's own disabled condition
    var v = apText.value.trim();
    if (!v || !activeAgent) return;
    apText.value = '';
    sendAgentMessage(activeAgent, v);
  }
  apSend.onclick = doSendAgent;
  apText.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); doSendAgent(); }
  });

