'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const appUrl = process.env.CLAREMM_TEST_URL || 'http://127.0.0.1:8765/';
const debugPort = 9448;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claremmscan-saz-reconcile-'));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForChrome() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('Chrome no abrió el puerto de depuración.');
}

async function run() {
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    await waitForChrome();
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const operation = pending.get(message.id);
      if (!operation) return;
      pending.delete(message.id);
      message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result);
    };
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: appUrl });
    await pause(1800);
    const result = await send('Runtime.evaluate', {
      expression: `(async()=>{
        if(!window.XLSX||!window.ClaremmSazReconcile)throw new Error('No cargaron las dependencias del conciliador.');
        window.claremmCloud={
          previewSazReconciliation:async parsed=>({
            validProducts:parsed.products.length,pairs:parsed.pairs,blockedRows:parsed.blockedRows,
            matchedProducts:0,scannerProducts:0,preloadedProducts:1,missingProducts:1,
            statusRowsToUpdate:0,stockRowsToRaise:1,pairsToAdd:2,
            missingSample:[{estilo:'ABC1',color:'NEGRO',pairs:2}],
          }),
          applySazReconciliation:async parsed=>({
            productsCreated:1,stockRowsRaised:1,pairsAdded:2,protectedRows:[],blockedRows:parsed.blockedRows,
          }),
        };
        const workbook=XLSX.utils.book_new();
        const sheet=XLSX.utils.aoa_to_sheet([
          ['TIENDA','ESTILO','COLOR','FORRO','23-1','TOTAL'],
          ['JUAREZ','ABC1','NEGRO','',2,2],
        ]);
        XLSX.utils.book_append_sheet(workbook,sheet,'EXISTENCIAS');
        const bytes=XLSX.write(workbook,{type:'array',bookType:'xlsx'});
        const file=new File([bytes],'existencias-prueba.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        const transfer=new DataTransfer();transfer.items.add(file);
        const input=document.getElementById('sazReconcileFile');input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&document.getElementById('sazReconcileApply').disabled;i++)await new Promise(resolve=>setTimeout(resolve,25));
        const preview={
          dialogOpen:document.getElementById('sazReconcileDialog').open,
          products:document.getElementById('sazReconcileProducts').textContent,
          pairs:document.getElementById('sazReconcilePairs').textContent,
          missing:document.getElementById('sazReconcileMissing').textContent,
          plan:document.getElementById('sazReconcilePlan').textContent,
        };
        document.getElementById('sazReconcileApply').click();
        for(let i=0;i<100&&!/Listo:/.test(document.getElementById('sazReconcileStatus').textContent);i++)await new Promise(resolve=>setTimeout(resolve,25));
        return {...preview,status:document.getElementById('sazReconcileStatus').textContent};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    const value = result.result.value;
    console.log(JSON.stringify(value, null, 2));
    if (!value.dialogOpen || value.products !== '1' || value.pairs !== '2' || value.missing !== '1'
      || !/crear 1 ficha/.test(value.plan) || !/1 producto\(s\) creados/.test(value.status)) process.exitCode = 2;
    socket.close();
  } finally {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([stopped, pause(2000)]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
