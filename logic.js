"use strict";

// Pure, side-effect-free logic pulled out of world.js/board.js specifically so
// it can be unit tested (test.js) without needing THREE, a DOM, or a
// WebGLRenderer in the loop. Nothing in this file touches window, document,
// or the network — it only transforms the arguments it's given.

function daysBetween(a,b){ return Math.ceil((b-a)/86400000); }
function daysAgo(ts){ return Math.floor((Date.now()-ts)/86400000); }

// A business inbox is mostly robots. These patterns sort the senders that
// can't be replied to from the ones that can, so the panel counts people.
var NOISE_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|notify|onboarding|newsletter|news|marketing|mailer|mailer-daemon|postmaster|dmarcreport|member|hello|updates?|connect|automated|alerts?)$/i;
var NOISE_DOMAIN = /(^|\.)(mkt|marketo|mailchimp|sendgrid|hubspotemail|amazonses|sparkpost|surveymonkeyuser|mcmap|bounce|notifications|mailgun|postmarkapp)\./i;
function isVendor(addr){
  if (!addr) return true;
  var at = addr.indexOf('@');
  if (at < 0) return true;
  var local = addr.slice(0, at), domain = addr.slice(at+1);
  return NOISE_LOCAL.test(local) || NOISE_DOMAIN.test(domain);
}

function parseDeals(payload){
  var p = payload;
  if (typeof p === 'string'){ try { p = JSON.parse(p); } catch(e){ return null; } }
  if (!p) return null;
  var rows = p.results || p.items || (Array.isArray(p) ? p : null);
  if (!rows) return null;
  var tpl = p.urlTemplate || '';
  return rows.map(function(r){
    var pr = r.properties || r;
    var mod = Date.parse(pr.hs_lastmodifieddate || pr.createdate || '') || Date.now();
    return {
      id: r.id || pr.hs_object_id,
      name: pr.dealname || r.displayName || 'Untitled deal',
      stage: pr.dealstage || '',
      amount: pr.amount ? Number(pr.amount) : null,
      currency: pr.deal_currency_code || 'USD',
      closedate: pr.closedate || null,
      created: Date.parse(pr.createdate||'') || null,
      modified: mod,
      url: tpl ? tpl.replace('{id}', r.id || pr.hs_object_id) : null
    };
  });
}

// This connector answers with one text block per message rather than a
// single JSON array, so read result.content and parse each block. The
// last block is a pagination summary and carries no id.
function parseMail(result){
  var rows = [];
  var blocks = (result && result.content) || [];
  var summary = null;
  blocks.forEach(function(b){
    if (!b || b.type !== 'text' || !b.text) return;
    var o; try { o = JSON.parse(b.text); } catch(e){ return; }
    if (o && o.id && o.receivedDateTime) rows.push(o);
    else if (o && (o.totalResultCount != null || o.moreResults != null)) summary = o;
  });
  if (!rows.length && result && Array.isArray(result.payload)) rows = result.payload;
  var human = [], vendor = [];
  rows.forEach(function(r){
    var addr = (r.sender || '').toLowerCase();
    var rec = {
      id: (r.id || r.internetMessageId || Math.random()).toString().slice(-24),
      subject: r.subject,
      from: addr,
      fromName: addr.split('@')[0] + '@' + (addr.split('@')[1] || ''),
      at: Date.parse(r.receivedDateTime) || Date.now(),
      unread: r.isRead === false,
      snippet: (r.summary || '').replace(/[͏​\r\n\s]+/g, ' ').trim().slice(0, 260),
      link: r.webLink || null
    };
    (isVendor(addr) ? vendor : human).push(rec);
  });
  return {human:human, vendor:vendor,
          total: (summary && summary.totalResultCount) || rows.length};
}
