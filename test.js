#!/usr/bin/env node
"use strict";

// Unit tests for logic.js — the pure functions pulled out of world.js/board.js
// specifically so they could be tested without a browser, THREE, or a DOM.
// No framework: matches the rest of the project's zero-dependency approach.
// Run with: node test.js

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var sandbox = { Date: Date, Math: Math, Array: Array, JSON: JSON };
vm.createContext(sandbox);
var src = fs.readFileSync(path.join(__dirname, 'logic.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'logic.js' });

var passed = 0, failed = 0;
function check(name, actual, expected){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; }
  else {
    failed++;
    console.log('FAIL ' + name);
    console.log('  expected: ' + JSON.stringify(expected));
    console.log('  actual:   ' + JSON.stringify(actual));
  }
}
function ok(name, cond){
  if (cond) passed++;
  else { failed++; console.log('FAIL ' + name); }
}

// ---- daysBetween / daysAgo ----
check('daysBetween: exact day', sandbox.daysBetween(0, 86400000), 1);
check('daysBetween: rounds up a partial day', sandbox.daysBetween(0, 86400001), 2);
check('daysBetween: negative when a is later than b', sandbox.daysBetween(86400000, 0), -1);
ok('daysAgo: a timestamp from now is 0 days ago', sandbox.daysAgo(Date.now()) === 0);
ok('daysAgo: a week-old timestamp is 7 days ago', sandbox.daysAgo(Date.now() - 7 * 86400000) === 7);

// ---- isVendor ----
ok('isVendor: no-reply local part is a vendor', sandbox.isVendor('no-reply@example.com'));
ok('isVendor: noreply (no hyphen) local part is a vendor', sandbox.isVendor('noreply@example.com'));
ok('isVendor: marketing infra domain is a vendor', sandbox.isVendor('hello@mail.mailchimp.com') || sandbox.isVendor('anything@mailchimp.com'));
ok('isVendor: hubspotemail domain is a vendor', sandbox.isVendor('deals@track.hubspotemail.net'));
ok('isVendor: empty/missing address is treated as a vendor (can\'t reply to nothing)', sandbox.isVendor('') && sandbox.isVendor(null));
ok('isVendor: address with no @ is treated as a vendor', sandbox.isVendor('not-an-email'));
ok('isVendor: a real person at a normal domain is NOT a vendor', !sandbox.isVendor('sam@acme.com'));
ok('isVendor: is case-insensitive on the local part', sandbox.isVendor('NoReply@example.com'));

// ---- parseDeals ----
ok('parseDeals: null payload returns null', sandbox.parseDeals(null) === null);
ok('parseDeals: garbage string payload returns null', sandbox.parseDeals('not json') === null);
ok('parseDeals: object with no results/items/array shape returns null', sandbox.parseDeals({foo:1}) === null);
(function(){
  var out = sandbox.parseDeals({
    results: [{ id: '1', properties: {
      dealname: 'Test Deal', dealstage: 'stage1', amount: '500',
      deal_currency_code: 'USD', closedate: '2026-01-01', createdate: '2025-12-01',
      hs_lastmodifieddate: '2025-12-15'
    }}],
    urlTemplate: 'https://x/{id}'
  });
  ok('parseDeals: parses a HubSpot-shaped results array', out && out.length === 1);
  ok('parseDeals: reads amount as a number', out[0].amount === 500);
  ok('parseDeals: builds the record URL from the template', out[0].url === 'https://x/1');
  ok('parseDeals: falls back to a placeholder name when dealname is missing',
    sandbox.parseDeals({results:[{id:'2', properties:{}}]})[0].name === 'Untitled deal');
})();

// ---- parseMail ----
(function(){
  var out = sandbox.parseMail({ content: [
    { type:'text', text: JSON.stringify({ id:'m1', receivedDateTime:'2026-01-01T00:00:00Z',
      sender:'sam@acme.com', subject:'Hi', isRead:false }) },
    { type:'text', text: JSON.stringify({ id:'m2', receivedDateTime:'2026-01-01T00:00:00Z',
      sender:'no-reply@vendor.com', subject:'Receipt' }) },
    { type:'text', text: JSON.stringify({ totalResultCount: 2 }) }
  ]});
  ok('parseMail: splits human senders from vendor senders', out.human.length === 1 && out.vendor.length === 1);
  ok('parseMail: human list has the real sender', out.human[0].from === 'sam@acme.com');
  ok('parseMail: reads the pagination summary for total', out.total === 2);
  ok('parseMail: empty content returns empty, zero-total result',
    sandbox.parseMail({content:[]}).human.length === 0 && sandbox.parseMail({content:[]}).total === 0);
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
