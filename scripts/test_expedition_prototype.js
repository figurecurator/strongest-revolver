// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 RainbowSoft
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/);
if(!match) throw new Error('inline game script not found');

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
function fakeElement(id=''){
  const element = {
    id, style:{}, className:'', textContent:'', disabled:false,
    clientWidth:600, width:600, height:400,
    classList:{ add(){}, remove(){}, toggle(){} },
    addEventListener(){}, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { width:id === 'cyl' ? 66 : 600, height:id === 'field' ? 360 : 66 }; },
    getContext(){
      return new Proxy({}, { get(target, key){
        if(!(key in target)) target[key] = () => {};
        return target[key];
      }, set(target, key, value){ target[key] = value; return true; } });
    }
  };
  Object.defineProperty(element, 'innerHTML', {
    get(){ return this._innerHTML || ''; },
    set(value){ this._innerHTML = String(value); }
  });
  return element;
}

const elements = Object.fromEntries(ids.map(id => [id, fakeElement(id)]));
const storage = new Map();
const localStorage = {
  getItem:key => storage.has(key) ? storage.get(key) : null,
  setItem:(key,value) => storage.set(key, String(value)),
  removeItem:key => storage.delete(key)
};
const document = {
  documentElement:{ lang:'ko' }, hidden:false,
  title:'', getElementById:id => elements[id] || (elements[id] = fakeElement(id)),
  addEventListener(){}, querySelectorAll(){ return []; }
};
const window = {
  document, localStorage, devicePixelRatio:1,
  addEventListener(){}, removeEventListener(){},
  requestAnimationFrame(){}, storage:null
};
class FakeImage { set src(value){ this._src = value; } }

const context = {
  console, document, window, localStorage,
  navigator:{ language:'ko-KR', sendBeacon(){ return true; } },
  location:{ reload(){} }, Image:FakeImage,
  performance, requestAnimationFrame(){}, cancelAnimationFrame(){},
  setTimeout, clearTimeout, crypto:globalThis.crypto
};
context.globalThis = context;

const injected = match[1].replace(/\}\)\(\);\s*$/, `
  globalThis.__gameTest = {
    S, startExpedition, finishExpedition, enterTownReady, newDuel,
    topOffCylinder, startReload, shopOpen, capacity, reserveCapacity,
    snapshot, applySave, foeDown, syncDom, update
  };
})();`);
vm.runInNewContext(injected, context, { filename:'index.inline.js' });

function assert(condition, message){
  if(!condition) throw new Error(message);
}

(async () => {
  await Promise.resolve();
  const g = context.__gameTest;
  const S = g.S;

  assert(S.phase === 'between' && !S.expedition.active, 'new save should open in town');
  assert(g.shopOpen(), 'shop should be open in town');
  assert(S.ammo === 5 && S.expedition.reserveAmmo === 15, 'town should prepare 5+15 rounds');

  g.startExpedition();
  assert(S.expedition.active && !g.shopOpen(), 'starting a hunt should lock the shop');
  assert(S.hp === 100 && S.ammo === 5 && S.expedition.reserveAmmo === 15, 'hunt should start fully supplied');
  g.syncDom();

  S.hp = 61; S.ammo = 2;
  g.newDuel();
  assert(S.hp === 61, 'health should persist between duels');
  assert(S.ammo === 5 && S.expedition.reserveAmmo === 12, 'next duel should top off from reserve ammo');

  S.phase = 'fight'; S.ammo = 1; S.expedition.reserveAmmo = 2;
  g.startReload();
  assert(S.reload > 0 && S.reloadLoad === 2, 'reload should only load available reserve rounds');
  assert(S.expedition.reserveAmmo === 0, 'reload should spend reserve rounds');
  assert(g.snapshot().ammo === 3, 'saving during reload should preserve all allocated rounds');
  S.aimDur = 1000; S.foeAim = 0;
  g.update(3);
  assert(S.ammo === 3 && S.reload === 0, 'reload should finish with only the reserved rounds');

  S.reload = 0; S.reloadLoad = 0; S.phase = 'fight'; S.chain = 0;
  g.foeDown();
  assert(S.gold === 0, 'duel bounty should not be spendable during a hunt');
  assert(S.expedition.securedGold === 14 && S.expedition.carriedGold === 14, 'stage 1 bounty should split 50:50');
  assert(g.snapshot().stage === S.stage + 1, 'saving during the fall scene should preserve the cleared duel');

  g.finishExpedition(true);
  assert(S.gold === 28 && !S.expedition.active && g.shopOpen(), 'safe return should bank all bounty and open shop');
  g.syncDom();

  g.startExpedition();
  S.expedition.kills = 1; S.expedition.securedGold = 10; S.expedition.carriedGold = 12;
  S.phase = 'beaten';
  g.finishExpedition(false, true);
  assert(S.gold === 38 && S.expeditionResult.lost === 12, 'defeat should bank secured bounty and lose carried bounty');
  g.finishExpedition(false);
  assert(S.phase === 'between' && g.shopOpen(), 'defeat should finish in town after the fall scene');

  g.startExpedition(); S.hp = 47; S.ammo = 3; S.expedition.reserveAmmo = 7;
  const saved = g.snapshot();
  g.enterTownReady();
  g.applySave(saved);
  assert(S.expedition.active && S.hp === 47 && S.ammo === 3 && S.expedition.reserveAmmo === 7,
    'active hunt resources should survive save migration');

  console.log('expedition prototype tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
