/** 탐색용: 지정 URL 로 이동(또는 현재 페이지 유지) 후 대기·클릭·입력·스크린샷.
 * node tools/shot.mjs --port 9240 [--url <u>] [--wait 12000] --out <name> [--click x,y[,waitMs]]... [--text "..."] [--drag x1,y1,x2,y2]
 */
import fs from 'node:fs';
import { DEFAULT_ATTACH_CDP_PORT } from './form-coords.mjs';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>-1?process.argv[i+1]:d;};
const all=(n)=>process.argv.map((v,i)=>v==='--'+n?process.argv[i+1]:null).filter(Boolean);
const PORT=arg('port',String(DEFAULT_ATTACH_CDP_PORT)), EV=arg('ev','D:/pjt/eformsign/kiosk-product/evidence/final');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const targets=await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t=targets.find(x=>x.type==='page'&&!/devtools/.test(x.url))||targets.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl);
let id=0;const pend=new Map();
const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}};
await new Promise(r=>ws.onopen=r);
await send('Page.enable',{});
await send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:false});
const url=arg('url',null);
if(url){await send('Page.navigate',{url});}
await sleep(Number(arg('wait','12000')));
for(const c of all('click')){const[x,y,w]=c.split(',').map(Number);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  await sleep(w||1200);}
const text=arg('text',null);
if(text){for(const ch of text) await send('Input.insertText',{text:ch}); await sleep(800);}
const drag=arg('drag',null);
if(drag){const[x1,y1,x2,y2]=drag.split(',').map(Number);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x1,y:y1,button:'left',clickCount:1});
  for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x1+(x2-x1)*i/12,y:y1+(y2-y1)*(i%2?0.3:1)/1,button:'left'});await sleep(30);}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x2,y:y2,button:'left',clickCount:1});
  await sleep(800);}
const evalJs=arg('eval',null);
if(evalJs){const r=await send('Runtime.evaluate',{expression:evalJs,returnByValue:true,awaitPromise:true});console.log('EVAL',JSON.stringify(r.result?.value));}
const out=arg('out',null);
if(out){const r=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(EV,{recursive:true});fs.writeFileSync(`${EV}/${out}.png`,Buffer.from(r.data,'base64'));console.log('shot',`${EV}/${out}.png`);}
ws.close();
