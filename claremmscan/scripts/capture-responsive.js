'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceUrl = process.argv[2] || 'http://127.0.0.1:8765/';
const outputDir = process.argv[3] || path.join(os.tmpdir(), 'claremmscan-responsive');
const state = process.argv[4] || 'empty';
const unifiedPath = process.argv[5] || '/Users/laclavees12345/Downloads/CLAREMM_Respaldo_unificado.json';
const unifiedJson = fs.existsSync(unifiedPath) ? fs.readFileSync(unifiedPath, 'utf8') : '';
const demoImageUrl = new URL('tests/prueba/WhatsApp Image 2026-11-15 at 11.53.05.jpeg', sourceUrl).href;
const inventorySeed = Array.from({ length: 25 }, (_, index) => ({
  estilo: `EST${String(index + 1).padStart(3, '0')}`,
  marca: index === 24 ? 'MARCA-UNICA' : 'CLAREMM', color: index % 2 ? 'NEGRO' : 'CAMEL', linea: 'Zapato', talla: String(20 + (index % 10) / 2),
  cantidad: '1', material: 'PIEL', precio: String(500 + index), notas: index === 24 ? 'BUSQUEDA-GENERAL' : '',
}));
const widths = [320, 375, 414, 768, 1440];
const height = 2200;
const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claremmscan-chrome-'));
fs.mkdirSync(outputDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForChrome() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await pause(100);
  }
  throw new Error('Chrome no abrió el puerto de depuración.');
}

async function openTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(sourceUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`No se pudo abrir la página (${response.status}).`);
  return response.json();
}

async function capture(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let messageId = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send('Page.navigate', { url: sourceUrl });
    await pause(1200);
    if (state === 'inventory') {
      await send('Runtime.evaluate', { expression: `(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();for(const key of await caches.keys())await caches.delete(key)})()`, awaitPromise: true });
      await send('Runtime.evaluate', { expression: `localStorage.setItem('claremmscan-v1',${JSON.stringify(JSON.stringify(inventorySeed))})` });
      await send('Page.navigate', { url: sourceUrl });
      await pause(1600);
    }
    await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
    if (state === 'loaded') {
      await send('Runtime.evaluate', {
        expression: `(async()=>{
          const preview=document.getElementById('preview');
          preview.src=${JSON.stringify(demoImageUrl)};
          preview.style.display='block';
          try{await preview.decode()}catch{}
          document.getElementById('fileInfo').textContent='1 fotografía(s) preparada(s)';
          document.getElementById('status').textContent='Detectada 1 posible etiqueta. Revisa antes de guardar.';
          document.getElementById('reviewCard').hidden=false;
          document.getElementById('pendingCount').textContent='(1)';
          document.getElementById('pendingRows').innerHTML='<tr><td><input type="checkbox" checked></td><td><input value="GIO130"></td><td><input value="GIOBABY KIDS"></td><td><input value="CLAREMM ZAPATERIA JUAREZ"></td><td><input value="CAMEL"></td><td><input value="Tenis"></td><td><input value="19.0"></td><td><input value="1"></td><td><input value="SINTETICO"></td><td><input value=""></td><td>OCR por región; confirma los datos</td></tr>';
        })()`,
        awaitPromise: true,
      });
    }
    const metrics = await send('Runtime.evaluate', {
      expression: `(()=>{
        const rect=id=>{const r=document.querySelector(id)?.getBoundingClientRect();return r&&{top:r.top,right:r.right,bottom:r.bottom,left:r.left}};
        const overlap=(a,b)=>Boolean(a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);
        const scan=rect('.scanPanel'),stage=rect('.captureStage'),review=rect('#reviewCard'),manual=rect('.manualPanel'),inventory=rect('.inventoryPanel');
        const stageWithinScan=Boolean(stage&&scan&&stage.left>=scan.left-.5&&stage.right<=scan.right+.5);
        return {innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,title:document.title,documentHeight:document.documentElement.scrollHeight,stageWithinScan,stageInventoryOverlap:overlap(stage,inventory),scanReviewOverlap:overlap(scan,review),scanManualOverlap:overlap(scan,manual),inventoryRows:document.querySelectorAll('#rows tr').length,paginationHidden:document.getElementById('inventoryPagination').hidden,currentPage:document.querySelector('[aria-current="page"]')?.textContent||'',exportImagesVisible:document.getElementById('exportImages').getBoundingClientRect().height>0,resultInfo:document.getElementById('inventoryResultInfo').textContent,visibleCardToggles:[...document.querySelectorAll('.cardToggle')].filter(button=>button.getBoundingClientRect().height>0).length};
      })()`,
      returnByValue: true,
    });
    const toggleCheck = await send('Runtime.evaluate', {
      expression: `(()=>{
        const mobile=matchMedia('(max-width: 59.999rem)').matches,card=document.getElementById('scanCard'),button=card.querySelector('.cardToggle'),stage=card.querySelector('.captureStage');
        const initialLabel=button.textContent;
        if(mobile)button.click();
        const collapsed=card.classList.contains('isCollapsed'),contentHidden=getComputedStyle(stage).display==='none',collapsedLabel=button.textContent,stateSaved=JSON.parse(localStorage.getItem('claremmscan-card-state-v1')||'{}').scanCard===true;
        if(mobile)button.click();
        return {mobileCardMode:mobile,initialToggleLabel:initialLabel,cardCollapsed:collapsed,collapsedContentHidden:contentHidden,collapsedToggleLabel:collapsedLabel,cardStateSaved:stateSaved,cardExpandedAgain:!card.classList.contains('isCollapsed')&&getComputedStyle(stage).display!=='none'};
      })()`,
      returnByValue: true,
    });
    Object.assign(metrics.result.value, toggleCheck.result.value);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(outputDir, `claremmscan-${state}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    const value = metrics.result.value;
    if (state === 'inventory') {
      await send('Runtime.evaluate', { expression: `window.scrollTo({top:document.querySelector('.inventoryPanel').offsetTop-16,behavior:'instant'})` });
      await pause(120);
      const inventoryScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, `claremmscan-${state}-${width}-inventory.png`), Buffer.from(inventoryScreenshot.data, 'base64'));
      const controls = await send('Runtime.evaluate', {
        expression: `(()=>{
          document.querySelector('[data-page="2"]').click();
          const page2First=document.querySelector('#rows tr td')?.textContent||'';
          const page2Rows=document.querySelectorAll('#rows tr').length;
          const search=document.getElementById('inventorySearch'),scope=document.getElementById('inventorySearchScope');
          search.value='EST025';search.dispatchEvent(new Event('input',{bubbles:true}));
          const styleMatchRows=document.querySelectorAll('#rows tr').length,styleMatchFirst=document.querySelector('#rows tr td')?.textContent||'';
          scope.value='style';scope.dispatchEvent(new Event('change',{bubbles:true}));search.value='MARCA-UNICA';search.dispatchEvent(new Event('input',{bubbles:true}));
          const styleOnlyEmpty=document.querySelector('.emptyRow')?.textContent||'';
          scope.value='all';scope.dispatchEvent(new Event('change',{bubbles:true}));
          const generalMatchRows=document.querySelectorAll('#rows tr').length,generalMatchFirst=document.querySelector('#rows tr td')?.textContent||'';
          return {page2First,page2Rows,styleMatchRows,styleMatchFirst,styleOnlyEmpty,generalMatchRows,generalMatchFirst};
        })()`,
        returnByValue: true,
      });
      Object.assign(value, controls.result.value);
      if (width === 320) {
        const exportCheck = await send('Runtime.evaluate', {
          expression: `(async()=>{
            const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
            const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);let seed=123456789;
            for(let i=0;i<image.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255}
            ctx.putImageData(image,0,0);const source=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            await window.ClaremmStore.putImageFromCloud('EST025-CAMEL.png',source);
            HTMLAnchorElement.prototype.click=function(){};
            window.JSZip=class{constructor(){this.files=[];window.__testZip=this}file(name,blob){this.files.push({name,size:blob.size})}async generateAsync(){return new Blob(['zip'])}};
            document.getElementById('exportImages').click();
            for(let i=0;i<100&&!document.getElementById('exportImages').hasAttribute('aria-busy');i++)await new Promise(resolve=>setTimeout(resolve,20));
            for(let i=0;i<200&&document.getElementById('exportImages').hasAttribute('aria-busy');i++)await new Promise(resolve=>setTimeout(resolve,50));
            return {sourceImageBytes:source.size,exportedImageName:window.__testZip?.files[0]?.name||'',exportedImageBytes:window.__testZip?.files[0]?.size||0,exportCompleted:!document.getElementById('exportImages').hasAttribute('aria-busy')};
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        Object.assign(value, exportCheck.result.value);
        const saveCheck = await send('Runtime.evaluate', {
          expression: `(async()=>{
            const photo=document.getElementById('photo'),transfer=new DataTransfer();
            transfer.items.add(new File([new Uint8Array([255,216,255,217])],'etiqueta-prueba.jpg',{type:'image/jpeg'}));
            photo.files=transfer.files;photo.dispatchEvent(new Event('change',{bubbles:true}));
            const previewWasVisible=getComputedStyle(document.getElementById('preview')).display!=='none';
            Object.entries({estilo:'NUEVO999',marca:'MARCA PRUEBA',color:'NEGRO',linea:'Zapato',talla:'27.0',material:'PIEL',cantidad:'1',precio:'900',notas:'PRUEBA-LIMPIEZA'}).forEach(([id,val])=>document.getElementById(id).value=val);
            document.getElementById('save').click();
            for(let i=0;i<100&&document.getElementById('save').disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));
            await new Promise(resolve=>setTimeout(resolve,80));
            const saved=window.ClaremmStore.getItems().find(item=>item.estilo==='NUEVO999');
            const preview=document.getElementById('preview');
            return {previewWasVisible,captureCleared:getComputedStyle(preview).display==='none'&&!preview.getAttribute('src')&&!photo.value&&!document.getElementById('fileInfo').textContent,brandSaved:saved?.marca||'',brandFormCleared:!document.getElementById('marca').value};
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        Object.assign(value, saveCheck.result.value);
        const productCameraPriceCheck = await send('Runtime.evaluate', {
          expression: `(async()=>{
            const next=window.ClaremmStore.getItems();
            next.push({estilo:'000030',marca:'PRUEBA',color:'BLANCO',linea:'Zapato',talla:'22.0',cantidad:'1',material:'PIEL',precio:'777',notas:''},{estilo:'000030',marca:'PRUEBA',color:'BLANCO',linea:'Zapato',talla:'23.0',cantidad:'1',material:'PIEL',precio:'200',notas:''});
            window.ClaremmStore.replaceItemsFromCloud(next);
            const search=document.getElementById('inventorySearch');search.value='000030';search.dispatchEvent(new Event('input',{bubbles:true}));
            const manualCard=document.getElementById('manualCard'),manualToggle=manualCard.querySelector('.cardToggle');if(!manualCard.classList.contains('isCollapsed'))manualToggle.click();
            document.querySelector('#rows button[data-action="edit"]').click();await new Promise(resolve=>setTimeout(resolve,50));
            const manualAutoExpanded=!manualCard.classList.contains('isCollapsed');
            document.getElementById('precio').value='777';
            const response=await fetch(${JSON.stringify(demoImageUrl)}),blob=await response.blob(),cameraInput=document.getElementById('productImageCamera'),transfer=new DataTransfer();
            transfer.items.add(new File([blob],'producto-camara.jpg',{type:blob.type||'image/jpeg'}));cameraInput.files=transfer.files;cameraInput.dispatchEvent(new Event('change',{bubbles:true}));
            const cameraImagePreviewed=!document.getElementById('productImagePreview').hidden&&document.getElementById('productImageInfo').textContent.startsWith('Fotografía tomada.');
            document.getElementById('save').click();for(let i=0;i<300&&document.getElementById('save').disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));await new Promise(resolve=>setTimeout(resolve,100));
            const variants=window.ClaremmStore.getItems().filter(item=>item.estilo==='000030'&&item.color==='BLANCO'),savedImage=await window.ClaremmStore.getProductImage('000030-BLANCO.png');
            return {manualAutoExpanded,cameraCaptureAttribute:cameraInput.getAttribute('capture'),cameraImagePreviewed,similarPriceCount:variants.filter(item=>item.precio==='777').length,similarPriceValues:variants.map(item=>item.precio),savedCameraImageBytes:savedImage?.size||0,pricePropagationStatus:document.getElementById('status').textContent};
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        Object.assign(value, productCameraPriceCheck.result.value);
        if (unifiedJson) {
          const importCheck = await send('Runtime.evaluate', {
            expression: `(async()=>{
              HTMLAnchorElement.prototype.click=function(){};
              const upload=async(file,mode='replace')=>{
                const input=document.getElementById('importFile'),transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
                for(let i=0;i<150&&!document.getElementById('importDialog').open;i++)await new Promise(resolve=>setTimeout(resolve,20));
                const preview={records:document.getElementById('importRecords').textContent,pairs:document.getElementById('importPairs').textContent,value:document.getElementById('importValue').textContent,invalid:document.getElementById('importInvalid').textContent};
                document.querySelector('input[name="importMode"][value="'+mode+'"]').click();document.getElementById('importConfirm').click();await new Promise(resolve=>setTimeout(resolve,100));return preview;
              };
              const jsonPreview=await upload(new File([${JSON.stringify(unifiedJson)}],'CLAREMM_Respaldo_unificado.json',{type:'application/json'}));
              const afterJson=window.ClaremmStore.getItems(),jsonPairs=afterJson.reduce((sum,item)=>sum+Number(item.cantidad||0),0),jsonValue=afterJson.reduce((sum,item)=>sum+(Number(item.precio)||0)*Number(item.cantidad||0),0);
              const csv='Estilo,Marca,Color,Tipo de línea,Talla,Cantidad,Material,Precio,Notas\\nCSV001,PRUEBA CSV,NEGRO,Zapato,27.0,1,PIEL,10,Importado CSV';
              const csvPreview=await upload(new File([csv],'productos.csv',{type:'text/csv'}),'merge');
              const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet([{Estilo:'XLS001',Marca:'PRUEBA XLSX',Color:'CAMEL','Tipo de línea':'Zapato',Talla:'26.5',Cantidad:'1',Material:'SINTETICO',Precio:'20',Notas:'Importado Excel'}]);XLSX.utils.book_append_sheet(wb,ws,'Inventario');
              const xlsxPreview=await upload(new File([XLSX.write(wb,{bookType:'xlsx',type:'array'})],'productos.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'merge');
              const finalItems=window.ClaremmStore.getItems();
              return {jsonPreview,jsonRecords:afterJson.length,jsonPairs,jsonValue,jsonImportDialogClosed:!document.getElementById('importDialog').open,csvPreview,csvImported:finalItems.some(item=>item.estilo==='CSV001'&&item.marca==='PRUEBA CSV'),xlsxPreview,xlsxImported:finalItems.some(item=>item.estilo==='XLS001'&&item.marca==='PRUEBA XLSX'),finalImportRecords:finalItems.length};
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          Object.assign(value, importCheck.result.value);
        }
      }
    }
    if (state === 'loaded') {
      await send('Runtime.evaluate', { expression: `window.scrollTo({top:document.querySelector('.manualPanel').offsetTop-16,behavior:'instant'})` });
      await pause(120);
      const afterScroll = await send('Runtime.evaluate', {
        expression: `(()=>{
          const rect=id=>{const r=document.querySelector(id)?.getBoundingClientRect();return r&&{top:r.top,right:r.right,bottom:r.bottom,left:r.left}};
          const overlap=(a,b)=>Boolean(a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);
          const scan=rect('.scanPanel'),review=rect('#reviewCard'),manual=rect('.manualPanel');
          return {scanReviewOverlapAfterScroll:overlap(scan,review),scanManualOverlapAfterScroll:overlap(scan,manual)};
        })()`,
        returnByValue: true,
      });
      Object.assign(value, afterScroll.result.value);
      const scrolledScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(outputDir, `claremmscan-${state}-${width}-scrolled.png`), Buffer.from(scrolledScreenshot.data, 'base64'));
    }
    console.log(JSON.stringify({ width, state, ...value, overflow: value.scrollWidth > value.clientWidth }));
  }
  socket.close();
}

(async () => {
  try {
    await waitForChrome();
    await capture(await openTarget());
  } finally {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([stopped, pause(1500)]);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
