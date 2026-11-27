'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
const port = 8767;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claremmscan-prep-cards-'));
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let file = path.normalize(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (file.endsWith('/')) file += 'index.html';
  const full = path.join(root, file);
  if (!full.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (error, data) => {
    if (error) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForChrome(debugPort) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('Chrome no abrió el puerto de depuración.');
}

async function run() {
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
  const debugPort = 9445;
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    await waitForChrome(debugPort);
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/`)}`, { method: 'PUT' })).json();
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
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1400, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await pause(1200);
    const result = await send('Runtime.evaluate', {
      expression: `(async()=>{
        window.claremmCloud={
          listSazPrepGaps:async()=>({rows:[{ficha_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',estilo:'MI4425',color:'NEGRO',marca:'MIRLO',proveedor:'MIRLO',corrida:'22-26',linea:'DAMA',precio:0,imagen:'',qtyBySize:{'23.0':1},pares:1,sin_precio:true,sin_imagen:true}],skipKeys:[]}),
          searchRelationalInventory:async()=>[],
          hydrateRelationalImages:async results=>results,
          updateRelationalProductField:async({field,value})=>{window.__prepField={field,value};return {updated:1,field,value,precio:field==='precio'?Number(String(value).replace(',','.')):undefined}},
          loadBranchStockContext:async()=>({branches:[{id:'juarez',code:'JUAREZ',name:'CLAREMM ZAPATERIA JUAREZ',active:true}]}),
        };
        const legacy=JSON.stringify([{estilo:'FALSOLOCAL',color:'ROJO',sucursal:'CLAREMM ZAPATERIA JUAREZ',talla:'23',cantidad:'9'}]);
        localStorage.setItem('claremmscan-v1',legacy);
        await window.ClaremmStore.refreshSazPrepCatalog();
        for(let i=0;i<80&&!document.querySelector('.relationalResultCard [data-edit-field="precio"]');i++)await new Promise(resolve=>setTimeout(resolve,25));
        const card=document.querySelector('.relationalResultCard');
        const tableHidden=document.getElementById('inventoryCard').classList.contains('isPrepCards');
        const tableWrap=document.querySelector('.inventoryPanel .tablewrap');
        const tableDisplay=tableWrap?getComputedStyle(tableWrap).display:'';
        const hasEditFields=Boolean(document.querySelector('[data-edit-field="precio"]'))&&Boolean(document.querySelector('[data-edit-field="marca"]'));
        const noActualizar=!/Actualizar/.test(document.getElementById('relationalSearchPanel').textContent);
        document.querySelector('[data-edit-field="precio"]')?.click();
        for(let i=0;i<40&&!document.querySelector('[data-edit-input="precio"]');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const input=document.querySelector('[data-edit-input="precio"]');
        if(input){input.value='759';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}
        for(let i=0;i<60&&!window.__prepField;i++)await new Promise(resolve=>setTimeout(resolve,20));
        const prepTitle=document.getElementById('relationalSearchTitle')?.textContent||'';
        const prepText=document.getElementById('relationalSearchPanel')?.textContent||'';
        const branch={id:'juarez',name:'CLAREMM ZAPATERIA JUAREZ'};
        window.claremmCloud.listRelationalStock=async()=>[{sucursal:branch.name,estilo:'435501',color:'NEGRO',talla:'21.0',cantidad:17}];
        window.XLSX={utils:{book_new:()=>({}),json_to_sheet:rows=>rows,book_append_sheet:(_book,rows)=>{window.__exportInventory=rows}},writeFile:()=>{}};
        await document.getElementById('xlsx').onclick();
        window.claremmCloud.searchRelationalInventory=async(query, scope, filter)=>filter==='pending'
          ? [{product:{id:'scanner',estilo:'MI4425',color:'NEGRO'},branch,sazStockAuditPending:true},
             {product:{id:'preloaded',estilo:'MI4425',color:'ROJO'},branch,sazStockAuditPending:true,sazPreloadedWithoutStock:true}]
          : [];
        const filter=document.getElementById('inventorySazFilter');
        filter.value='pending';
        filter.dispatchEvent(new Event('change',{bubbles:true}));
        const search=document.getElementById('inventorySearch');
        search.value='MI4425';
        search.dispatchEvent(new Event('input',{bubbles:true}));
        for(let i=0;i<80&&!document.querySelector('[data-relational-product-id="preloaded"]');i++)await new Promise(resolve=>setTimeout(resolve,25));
        return {
          cardVisible:Boolean(card),
          tableHidden,
          tableDisplay,
          hasEditFields,
          noActualizar,
          noLocalLeak:!/FALSOLOCAL/.test(prepText),
          title:prepTitle,
          text:prepText,
          saved:window.__prepField,
          exportRows:window.__exportInventory,
          legacyUnchanged:localStorage.getItem('claremmscan-v1')===legacy,
          pendingLabels:[...document.querySelectorAll('#relationalSearchResults .sazStatus.isPending')].map(node=>node.textContent),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Falló la prueba de fichas.');
    const value = result.result.value;
    console.log(JSON.stringify(value, null, 2));
    if (!value.cardVisible || !value.tableHidden || value.tableDisplay !== 'none' || !value.hasEditFields || !value.noActualizar || !value.noLocalLeak || value.title !== 'Fichas por preparar' || !/MI4425/.test(value.text) || value.saved?.field !== 'precio') {
      process.exitCode = 2;
    }
    if (!value.pendingLabels.includes('Pendiente en SAZ') || !value.pendingLabels.includes('Precargado sin stock')) process.exitCode = 2;
    if (value.exportRows?.length !== 1 || value.exportRows[0].Cantidad !== 17 || !value.legacyUnchanged) process.exitCode = 2;
    socket.close();
  } finally {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([stopped, pause(2000)]);
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
