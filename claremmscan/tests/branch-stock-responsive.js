'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceUrl = process.argv[2] || 'http://127.0.0.1:8765/';
const outputDir = process.argv[3] || path.join(os.tmpdir(), 'claremmscan-branch-stock');
const widths = [320, 375, 414, 768];
const port = 9444;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claremmscan-branch-chrome-'));
fs.mkdirSync(outputDir, { recursive: true });

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForChrome() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch {}
    await pause(100);
  }
  throw new Error('Chrome no abrió el puerto de depuración.');
}

async function run() {
  await waitForChrome();
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(sourceUrl)}`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data), operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    message.error ? operation.reject(new Error(message.error.message)) : operation.resolve(message.result);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const messageId = ++id; pending.set(messageId, { resolve, reject }); socket.send(JSON.stringify({ id: messageId, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');

  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1300, deviceScaleFactor: 1, mobile: width < 768 });
    await send('Page.navigate', { url: sourceUrl });
    await pause(1300);
    const result = await send('Runtime.evaluate', {
      expression: `(async()=>{
        const product={id:'product-1',estilo:'ROD410',color:'NEGRO',marca:'RODRI SAN',linea:'ZAPATO',corrida:'26-27',acabado:'PIEL',precio:770,sizes:['26.0','26.5','27.0']};
        window.claremmCloud={
          loadBranchStockContext:async()=>({branches:[{id:'base',code:'JUAREZ',name:'CLAREMM ZAPATERIA JUAREZ',active:true},{id:'branch-2',code:'CENTRO',name:'CLAREMM CENTRO',active:true}],products:[product]}),
          searchBranchCatalog:async query=>query.toUpperCase().includes('ROD410')?[product]:[],
          searchRelationalInventory:async query=>{const q=String(query||'').toUpperCase();const captured=(window.__capturedCards||[]).filter(card=>q.includes(String(card.product.estilo).toUpperCase())||String(card.product.estilo).toUpperCase().includes(q));const base=q.includes('COM011')?[{product:{...product,id:'rel-product-1',estilo:'COM011',color:'NEGRO',linea:'ZAPATO',corrida:'18-21',precio:950,imagen:''},branch:{id:'base',name:'CLAREMM ZAPATERIA JUAREZ'},sizes:[{size:'18.0',quantity:1},{size:'19.0',quantity:2},{size:'21.0',quantity:2}],totalQuantity:5,sazRegistered:true,imageUrl:''},{product:{...product,id:'rel-product-2',estilo:'COM011',color:'CAMEL',linea:'ZAPATO',corrida:'18-21',precio:0,imagen:''},branch:{id:'base',name:'CLAREMM ZAPATERIA JUAREZ'},sizes:[],totalQuantity:0,sazRegistered:false,imageUrl:''},{product:{...product,id:'rel-product-3',estilo:'COM011',color:'ROJO',linea:'ZAPATO',corrida:'22-26',precio:1000,imagen:''},branch:{id:'base',name:'CLAREMM ZAPATERIA JUAREZ'},sizes:[{size:'22.0',quantity:1}],totalQuantity:1,sazRegistered:false,imageUrl:''}]:[];return captured.concat(base)},
          hydrateRelationalImages:async results=>results,
          updateRelationalProductField:async({field,value})=>{if(field!=='precio')return {updated:1,field,value};const precio=Number(String(value).replace(',','.'));window.__relationalPriceUpdated=precio===999.5;return {updated:2,precio}},
          uploadRelationalProductImage:async({productId,blob})=>{window.__recentImageUploaded=productId==='recent-no-photo';window.__relationalImageUploaded=productId==='rel-product-1'&&blob.size===3;return {path:productId==='recent-no-photo'?'org/products/PI6037-NEGRO-AMBAR.png':'org/products/COM011-NEGRO.png',fileName:productId==='recent-no-photo'?'PI6037-NEGRO-AMBAR.png':'COM011-NEGRO.png',imageUrl:'data:image/png;base64,iVBORw0KGgo=',size:blob.size}},
          updateRelationalStylePrice:async(estilo,precio,corrida)=>{const value=Number(String(precio).replace(',','.'));const run=String(corrida||'18-21');window.__relationalPriceUpdated=estilo==='COM011'&&run==='18-21'&&(value===999.5||value===659);window.__stylePriceConfirmed=estilo==='COM011'&&run==='18-21'&&value===659;return {updated:2,precio:value,corrida:run}},
          duplicateRelationalProduct:async({color,precio,corrida,size,quantity,blob})=>{window.__duplicatedProduct=String(color).toUpperCase()==='ORO'&&/^(?:22-26|22\.00-26\.00)$/.test(String(corrida))&&Number(precio)===880&&String(size)==='23.0'&&Number(quantity)===1&&blob&&blob.size===3;return {product:{id:'rel-dup-1',estilo:'COM011',color:'ORO',marca:'RODRI SAN',linea:'ZAPATO',corrida:corrida,precio:Number(precio),imagen:'org/products/COM011-ORO.png'},branch:{id:'base',name:'CLAREMM ZAPATERIA JUAREZ'},sizes:[{size,quantity:Number(quantity)||1}],totalQuantity:Number(quantity)||1,sazRegistered:false,fileName:'COM011-ORO.png',imageUrl:'data:image/png;base64,iVBORw0KGgo=',imageMessage:'Imagen COM011-ORO.png · 0.0 KB',notice:'Ficha duplicada en corrida 22-26.'}},
          recordCaptures:async ([item])=>{window.__syncedCapture=item;const card={product:{id:'cap-'+item.color,estilo:item.estilo,color:item.color,marca:item.marca||'',linea:item.linea||'ZAPATO',corrida:'',precio:Number(item.precio)||0,imagen:''},branch:{id:'base',name:'CLAREMM ZAPATERIA JUAREZ'},sizes:item.talla?[{size:item.talla,quantity:Number(item.cantidad)||1}]:[],totalQuantity:Number(item.cantidad)||0,sazRegistered:false,imageUrl:'',notice:'Captura lista'};window.__capturedCards=(window.__capturedCards||[]).filter(entry=>entry.product.color!==item.color||entry.product.estilo!==item.estilo).concat(card);return {pending:0}},
          validateBranchStockRows:async rows=>({known:rows.filter(row=>row.estilo==='ROD410'),unknown:rows.filter(row=>row.estilo!=='ROD410').map(row=>({...row,reason:'No existe',canCreate:true}))}),
          applyBranchStock:async({rows})=>{for(const row of rows.filter(item=>item.estilo==='ROD410')){const current=(window.__recentStock||[]).find(item=>item.estilo===row.estilo&&item.color===row.color);if(current){if(!current.sizes.includes(row.talla))current.sizes.push(row.talla)}else window.__recentStock=[{estilo:row.estilo,color:row.color,sizes:[String(row.talla||'')] }].concat(window.__recentStock||[])}return{branch:{name:'CLAREMM CENTRO'},appliedRows:rows.filter(row=>row.estilo==='ROD410').length,appliedPairs:rows.filter(row=>row.estilo==='ROD410').reduce((sum,row)=>sum+Number(row.cantidad),0),createdProducts:0,unknown:rows.filter(row=>row.estilo!=='ROD410')}},
          listRecentBranchStock:async()=>window.__recentStock||[{id:'recent-with-photo',estilo:'PI5504',color:'BLANCO AZUL',sizes:['24.0','26.0'],precio:899,imagen:'x'},{id:'recent-no-photo',estilo:'PI6037',color:'NEGRO AMBAR',sizes:['24.0']}]
        };
        const testPriceStyle='PRECIO'+innerWidth+'-'+Date.now();const saveLocal=async(color,price)=>{document.getElementById('estilo').value=testPriceStyle;document.getElementById('color').value=color;document.getElementById('talla').value=color==='ROJO'?'25.0':'25.5';document.getElementById('cantidad').value='1';document.getElementById('precio').value=String(price);document.getElementById('save').click();for(let i=0;i<100&&!/Registro guardado/.test(document.getElementById('status').textContent);i++)await new Promise(resolve=>setTimeout(resolve,20));document.getElementById('status').textContent=''};
        await saveLocal('ROJO',100);await saveLocal('AZUL',200);const relationalCapturesKept=window.__capturedCards.filter(card=>card.product.estilo===testPriceStyle).length===2;
        for(let i=0;i<150&&!new RegExp(testPriceStyle).test(document.getElementById('relationalSearchPanel')?.textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const capturedVisible=Boolean(window.__syncedCapture)&&window.__syncedCapture.color==='AZUL'&&new RegExp(testPriceStyle).test(document.getElementById('relationalSearchPanel')?.textContent||'');
        document.getElementById('branchStockOpen').click();
        for(let i=0;i<100&&document.getElementById('branchStockWorkspace').hidden;i++)await new Promise(resolve=>setTimeout(resolve,20));
        const branch=document.getElementById('branchStockBranch');branch.value='branch-2';branch.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&!/PI5504 · BLANCO AZUL/.test(document.getElementById('branchStockRecentList')?.textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const recentItems=[...document.querySelectorAll('#branchStockRecentList .branchStockRecentItem')];
        const recentVisible=/PI5504 · BLANCO AZUL/.test(document.getElementById('branchStockRecentList')?.textContent||'')&&/24\\.0, 26\\.0/.test(document.getElementById('branchStockRecentList')?.textContent||'')&&/PI6037/.test(recentItems[0]?.textContent||'')&&recentItems[0]?.classList.contains('noImage')&&Boolean(recentItems[0]?.querySelector('[data-recent-image="camera"]'))&&Boolean(recentItems[0]?.querySelector('[data-recent-image="gallery"]'))&&!/NUEVO/.test(document.getElementById('branchStockRecentList')?.textContent||'');
        window.ClaremmStore.compressProductImage=async()=>new Blob(['png'],{type:'image/png'});
        recentItems[0].querySelector('[data-recent-image="gallery"]')?.click();
        const recentGallery=document.getElementById('branchRecentImageGallery'),recentTransfer=new DataTransfer();
        recentTransfer.items.add(new File(['foto'],'caja.jpg',{type:'image/jpeg'}));
        recentGallery.files=recentTransfer.files;recentGallery.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&document.querySelector('[data-recent-id="recent-no-photo"]')?.classList.contains('noImage');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const recentPhotoSaved=Boolean(window.__recentImageUploaded)&&!document.querySelector('[data-recent-id="recent-no-photo"]')?.classList.contains('noImage');
        const style=document.getElementById('branchStockStyle'),color=document.getElementById('branchStockColor');style.value='ROD410';color.value='NEGRO';style.dispatchEvent(new Event('input',{bubbles:true}));
        for(let i=0;i<100&&!document.querySelector('.catalogResult');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const searchResult=Boolean(document.querySelector('.catalogResult'));
        document.querySelector('.catalogResult')?.click();document.getElementById('branchStockSize').value='26.5';document.getElementById('branchStockQuantity').value='2';document.getElementById('branchStockSaveOne').click();
        await new Promise(resolve=>setTimeout(resolve,80));
        const manualSaved=/Guardado/.test(document.getElementById('branchStockStatus').textContent);
        for(let i=0;i<100&&!/ROD410 · NEGRO/.test(document.getElementById('branchStockRecentList')?.textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const recentAfterItems=[...document.querySelectorAll('#branchStockRecentList .branchStockRecentItem')];
        const recentAfterSave=/ROD410 · NEGRO/.test(document.getElementById('branchStockRecentList')?.textContent||'')&&/26\\.5/.test(document.getElementById('branchStockRecentList')?.textContent||'')&&/ROD410/.test(recentAfterItems[0]?.textContent||'')&&recentAfterItems[0]?.classList.contains('noImage');
        const input=document.getElementById('branchStockFile'),transfer=new DataTransfer();
        transfer.items.add(new File([JSON.stringify([{Estilo:'ROD410',Color:'NEGRO',Talla:'26.5',Cantidad:2},{Estilo:'NUEVO1',Color:'CAMEL',Talla:'25.0',Cantidad:1}])],'existencias.json',{type:'application/json'}));
        input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&document.getElementById('branchStockRows').textContent==='0';i++)await new Promise(resolve=>setTimeout(resolve,20));
        const originalSearch=window.claremmCloud.searchRelationalInventory;
        window.claremmCloud.searchRelationalInventory=async (...args)=>(await originalSearch(...args)).map(result=>result.product.id==='rel-product-1'?{...result,corridas:[{linea:'NIÑAS',talla_inicial:12,talla_final:17.5},{linea:'NIÑAS',talla_inicial:18,talla_final:21.5},{linea:'NIÑAS',talla_inicial:21.5,talla_final:27}]}:result);
        const inventorySearch=document.getElementById('inventorySearch');inventorySearch.value='COM011';inventorySearch.dispatchEvent(new Event('input',{bubbles:true}));
        for(let i=0;i<150&&!/COM011 · NEGRO/.test(document.getElementById('relationalSearchPanel')?.textContent||'');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const runLabels=[...document.querySelectorAll('[data-relational-product-id="rel-product-1"] [aria-label="Corridas del estilo"] span')].map(node=>node.textContent);
        if(runLabels.join('|')!=='NIÑAS 12.0–17.5|NIÑAS 18.0–21.5|NIÑAS 21.5–27.0')throw new Error('Las tres corridas del estilo deben aparecer en una sola tarjeta');
        window.ClaremmStore.compressProductImage=async()=>new Blob(['png'],{type:'image/png'});window.ClaremmStore.putImageFromCloud=async name=>{window.__putImageName=name};window.ClaremmStore.applyStylePriceFromCloud=()=>3;
        document.querySelector('[data-relational-price]')?.click();
        for(let i=0;i<50&&!document.querySelector('[data-edit-input="precio"]');i++)await new Promise(resolve=>setTimeout(resolve,20));
        const priceInput=document.querySelector('[data-edit-input="precio"]');if(priceInput){priceInput.value='999.50';priceInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}
        for(let i=0;i<100&&!/\$999\.50/.test(document.getElementById('relationalSearchPanel').textContent);i++)await new Promise(resolve=>setTimeout(resolve,20));
        document.querySelector('[data-relational-image="gallery"]')?.click();const imageInput=document.getElementById('relationalProductImageGallery'),imageTransfer=new DataTransfer();imageTransfer.items.add(new File(['foto'],'producto.jpg',{type:'image/jpeg'}));imageInput.files=imageTransfer.files;imageInput.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<100&&!/Imagen compartida/.test(document.getElementById('relationalSearchPanel').textContent);i++)await new Promise(resolve=>setTimeout(resolve,20));
        const relationalImageSaved=Boolean(window.__relationalImageUploaded)&&/Imagen compartida/.test(document.getElementById('relationalSearchPanel').textContent);
        const relationalPriceSaved=/\\$999\\.50/.test(document.getElementById('relationalSearchPanel').textContent)&&/Precio actualizado/.test(document.getElementById('relationalSearchPanel').textContent);
        window.ClaremmStore.readWithVision=async()=>({rows:[{estilo:'COM011',precio:'659',talla:'18.0'}],rawText:'$659',provider:'test'});
        const cameraFile=document.getElementById('inventorySearchCameraFile'),camTransfer=new DataTransfer();
        camTransfer.items.add(new File(['foto'],'etiqueta.jpg',{type:'image/jpeg'}));
        cameraFile.files=camTransfer.files;cameraFile.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<150&&(document.getElementById('stylePriceReview').hidden||document.getElementById('stylePriceConfirm').disabled||!/→/.test(document.getElementById('relationalSearchPanel').textContent));i++)await new Promise(resolve=>setTimeout(resolve,20));
        const cameraButtons=Boolean(document.getElementById('inventorySearchCamera'))&&Boolean(document.getElementById('inventorySearchGallery'));
        const cameraSearch=document.getElementById('inventorySearch').value==='COM011'&&document.getElementById('inventorySearchScope').value==='style';
        const cameraPreloaded=!document.getElementById('stylePriceReview').hidden&&!document.getElementById('stylePriceConfirm').disabled&&document.getElementById('stylePriceProposal').value==='659'&&/→/.test(document.getElementById('relationalSearchPanel').textContent);
        document.getElementById('stylePriceConfirm').click();
        for(let i=0;i<150&&!(window.__stylePriceConfirmed&&document.getElementById('stylePriceReview').hidden&&/Precio confirmado/.test(document.getElementById('relationalSearchPanel').textContent));i++)await new Promise(resolve=>setTimeout(resolve,20));
        const cameraConfirmed=Boolean(window.__stylePriceConfirmed)&&document.getElementById('stylePriceReview').hidden&&/Precio confirmado/.test(document.getElementById('relationalSearchPanel').textContent);
        const cameraCorridaScoped=/COM011 · ROJO/.test(document.getElementById('relationalSearchPanel').textContent)&&/\\$1,000\\.00/.test(document.getElementById('relationalSearchPanel').textContent);
        document.querySelector('[data-relational-duplicate]')?.click();
        for(let i=0;i<50&&document.getElementById('productDuplicate').hidden;i++)await new Promise(resolve=>setTimeout(resolve,20));
        const dupFile=document.getElementById('productDuplicateCameraFile'),dupTransfer=new DataTransfer();
        dupTransfer.items.add(new File(['foto'],'color.jpg',{type:'image/jpeg'}));
        dupFile.files=dupTransfer.files;dupFile.dispatchEvent(new Event('change',{bubbles:true}));
        document.getElementById('productDuplicateColor').value='ORO';
        document.getElementById('productDuplicateCorrida').value='22-26';
        document.getElementById('productDuplicatePrecio').value='880';
        document.getElementById('productDuplicateTalla').value='23.0';
        document.getElementById('productDuplicateCantidad').value='1';
        ['productDuplicateColor','productDuplicateCorrida','productDuplicatePrecio','productDuplicateTalla','productDuplicateCantidad'].forEach(id=>document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true})));
        const duplicateMock=document.createElement('script');
        duplicateMock.textContent='window.claremmCloud.duplicateRelationalProduct=async function(args){window.__duplicatedProduct=String(args.color).toUpperCase()==="ORO"&&/^(?:22-26|22\\.00-26\\.00)$/.test(String(args.corrida))&&Number(args.precio)===880&&String(args.size)==="23.0"&&Number(args.quantity)===1&&!!args.blob&&args.blob.size===3;return {product:{id:"rel-dup-1",estilo:"COM011",color:"ORO",marca:"RODRI SAN",linea:"ZAPATO",corrida:args.corrida,precio:Number(args.precio),imagen:"org/products/COM011-ORO.png"},branch:{id:"base",name:"CLAREMM ZAPATERIA JUAREZ"},sizes:[{size:args.size,quantity:Number(args.quantity)||1}],totalQuantity:Number(args.quantity)||1,sazRegistered:false,fileName:"COM011-ORO.png",imageUrl:"data:image/png;base64,iVBORw0KGgo=",imageMessage:"Imagen COM011-ORO.png · 0.0 KB",notice:"Ficha duplicada en corrida 22-26."};};';
        document.head.appendChild(duplicateMock);
        document.getElementById('productDuplicateSave').click();
        for(let i=0;i<100&&!(window.__duplicatedProduct&&/COM011 · ORO/.test(document.getElementById('relationalSearchPanel').textContent)&&/COM011-ORO\\.png/.test(document.getElementById('relationalSearchPanel').textContent)&&document.getElementById('productDuplicate').hidden);i++)await new Promise(resolve=>setTimeout(resolve,20));
        const duplicatedProduct=Boolean(window.__duplicatedProduct)&&/COM011 · ORO/.test(document.getElementById('relationalSearchPanel').textContent)&&/COM011-ORO\\.png/.test(document.getElementById('relationalSearchPanel').textContent)&&window.__putImageName==='COM011-ORO.png'&&document.getElementById('productDuplicate').hidden;
        const dialog=document.getElementById('branchStockDialog'),rect=dialog.getBoundingClientRect();
        return {width:innerWidth,dialogOpen:dialog.open,workspaceVisible:!document.getElementById('branchStockWorkspace').hidden,baseIncluded:[...branch.options].some(option=>option.value==='base'&&/CLAREMM ZAPATERIA JUAREZ \\(JUAREZ\\)/.test(option.textContent)),searchResult,searchText:document.getElementById('branchCatalogResults').textContent,manualSaved,recentVisible,recentPhotoSaved,recentAfterSave,statusText:document.getElementById('branchStockStatus').textContent,rows:document.getElementById('branchStockRows').textContent,known:document.getElementById('branchStockKnown').textContent,unknown:document.getElementById('branchStockUnknownCount').textContent,downloadUnknownEnabled:!document.getElementById('branchStockDownloadUnknown').disabled,relationalResult:Boolean(document.querySelector('.relationalResultCard')),relationalText:document.getElementById('relationalSearchPanel').textContent,relationalImageSaved,relationalPriceSaved,cameraButtons,cameraSearch,cameraPreloaded,cameraConfirmed,cameraCorridaScoped,duplicatedProduct,capturedVisible,relationalCapturesKept,rootOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,dialogOverflow:dialog.scrollWidth>dialog.clientWidth,dialogWithinViewport:rect.left>=0&&rect.right<=innerWidth+0.5};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Falló la prueba en el navegador.');
    const value = result.result.value;
    console.log(JSON.stringify(value));
    if (!value.dialogOpen || !value.workspaceVisible || !value.baseIncluded || !value.searchResult || !value.manualSaved || !value.recentVisible || !value.recentPhotoSaved || !value.recentAfterSave || value.rows !== '2' || value.known !== '1' || value.unknown !== '1' || !value.downloadUnknownEnabled || !value.relationalResult || !value.relationalImageSaved || !value.relationalPriceSaved || !value.cameraButtons || !value.cameraSearch || !value.cameraPreloaded || !value.cameraConfirmed || !value.cameraCorridaScoped || !value.duplicatedProduct || !value.capturedVisible || !value.relationalCapturesKept || value.rootOverflow || value.dialogOverflow || !value.dialogWithinViewport) process.exitCode = 2;
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(outputDir, `branch-stock-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  socket.close();
}

(async () => {
  try { await run(); }
  finally {
    const stopped = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([stopped, pause(2000)]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
