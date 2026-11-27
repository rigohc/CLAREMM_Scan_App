'use strict';
const $=id=>document.getElementById(id),fields=['estilo','marca','sucursal','color','linea','talla','material','cantidad','precio','notas'];
const BRANCH_KEY='claremmscan-active-branch-v1',DEFAULT_BRANCH='CLAREMM ZAPATERIA JUAREZ',CARD_STATE_KEY='claremmscan-card-state-v1',SAZ_PREP_SNAPSHOT_KEY='claremmscan-saz-prep-supabase-v1',IMAGE_DB='claremmscan-images-v1',IMAGE_STORE='images',MAX_IMAGE_BYTES=100*1024,INVENTORY_PAGE_SIZE=10;
let pending=[],photos=[],stream=null,busy=false,productImageFile=null,productPreviewUrl='',capturePreviewUrl='',imageDbPromise,inventoryQuery='',inventoryScope='all',inventorySazFilter='prep',inventoryPage=1,cachedImageNames=new Set(),sazPrepCatalog={rows:[],skipKeys:[],loaded:false,at:0,loading:null,error:'',source:''};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function loadCardState(){try{const state=JSON.parse(localStorage.getItem(CARD_STATE_KEY)||'{}');return state&&typeof state==='object'&&!Array.isArray(state)?state:{}}catch{return {}}}
function saveCardState(state){try{localStorage.setItem(CARD_STATE_KEY,JSON.stringify(state))}catch{}}
function setCardCollapsed(card,collapsed,save=true){if(!card)return;card.classList.toggle('isCollapsed',collapsed);const head=card.firstElementChild?.classList.contains('cardHead')?card.firstElementChild:null,button=head?.querySelector('.cardToggle'),title=head?.querySelector('h2')?.textContent.trim()||'sección';if(button){button.textContent=collapsed?'Mostrar':'Ocultar';button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',`${collapsed?'Mostrar':'Ocultar'} ${title}`)}if(save){const state=loadCardState();state[card.id]=collapsed;saveCardState(state)}}
function setupCardToggles(){const state=loadCardState();document.querySelectorAll('#cloudCard,#scanCard,#reviewCard,#manualCard,#inventoryCard').forEach(card=>{const head=card.firstElementChild?.classList.contains('cardHead')?card.firstElementChild:null;if(!head)return;const button=document.createElement('button');button.type='button';button.className='cardToggle secondary';head.append(button);setCardCollapsed(card,state[card.id]===true,false);button.addEventListener('click',()=>setCardCollapsed(card,!card.classList.contains('isCollapsed')))})}
function imageNamePart(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'')}
function productImageName(x){return `${imageNamePart(x.estilo)}-${imageNamePart(x.color)}.png`}
function openImageDb(){if(!imageDbPromise)imageDbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(IMAGE_DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(IMAGE_STORE,{keyPath:'name'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return imageDbPromise}
async function imageRequest(mode,operation){const db=await openImageDb();return new Promise((resolve,reject)=>{const tx=db.transaction(IMAGE_STORE,mode),req=operation(tx.objectStore(IMAGE_STORE));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onerror=()=>reject(tx.error)})}
const getProductImage=name=>imageRequest('readonly',s=>s.get(name)).then(x=>x?.blob||null);
const listProductImages=()=>imageRequest('readonly',s=>s.getAll());
const listProductImageNames=()=>imageRequest('readonly',s=>s.getAllKeys());
const putProductImageLocal=(name,blob)=>imageRequest('readwrite',s=>s.put({name,blob,size:blob.size,updatedAt:Date.now()}));
const deleteProductImageLocal=name=>imageRequest('readwrite',s=>s.delete(name));
function isImageFile(file){if(!file||!Number(file.size))return false;const type=String(file.type||'').toLowerCase();return !type||type.startsWith('image/')||type==='application/octet-stream'}
async function snapshotImageFile(file){if(!file)return null;const buffer=await file.arrayBuffer();return new File([buffer],file.name||`foto-${Date.now()}.jpg`,{type:file.type||'image/jpeg'})}
function canvasToBlob(canvas,type='image/png',quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('No se pudo convertir la imagen.')),type,quality))}
function canvasPng(canvas){return canvasToBlob(canvas,'image/png')}
async function bitmapFromFile(file){try{return await createImageBitmap(file)}catch{const url=URL.createObjectURL(file);try{const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo leer la foto. Tómala de nuevo.'));img.src=url});const c=document.createElement('canvas');c.width=image.naturalWidth||image.width;c.height=image.naturalHeight||image.height;if(!c.width||!c.height)throw Error('La foto llegó vacía. Vuelve a tomarla.');c.getContext('2d').drawImage(image,0,0);return await createImageBitmap(c)}finally{URL.revokeObjectURL(url)}}}
async function compressProductImage(file){const bitmap=await bitmapFromFile(file);try{let scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height)),blob;for(let attempt=0;attempt<12;attempt++){const c=document.createElement('canvas');c.width=Math.max(72,Math.round(bitmap.width*scale));c.height=Math.max(72,Math.round(bitmap.height*scale));const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,c.width,c.height);try{blob=await canvasToBlob(c,'image/png')}catch{blob=await canvasToBlob(c,'image/jpeg',Math.max(.55,.82-attempt*.04));blob=new Blob([blob],{type:'image/png'})}if(blob.size<=MAX_IMAGE_BYTES)return blob.type==='image/png'?blob:new Blob([blob],{type:'image/png'});const factor=Math.max(.55,Math.min(.86,Math.sqrt(MAX_IMAGE_BYTES/blob.size)*.92));scale*=factor}throw Error('No fue posible reducir la imagen a 100 KB. Prueba con otra fotografía.')}finally{bitmap.close?.()}}
function openImagePreview(url,alt){if(!url)return;const dialog=$('imagePreviewDialog'),img=$('imagePreviewFull');if(!dialog||!img)return;img.src=url;img.alt=alt||'Foto del producto';if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal()}else dialog.setAttribute('open','');}
function closeImagePreview(){const dialog=$('imagePreviewDialog'),img=$('imagePreviewFull');if(img)img.removeAttribute('src');if(!dialog)return;if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open')}
async function exportableImageBlob(blob){if(blob?.type==='image/png'&&blob.size<=MAX_IMAGE_BYTES)return blob;const compressed=await compressProductImage(blob);if(compressed.size>MAX_IMAGE_BYTES)throw Error('Una imagen superó el límite de 100 KB.');return compressed}
function showProductPreview(blob,message){if(productPreviewUrl)URL.revokeObjectURL(productPreviewUrl);productPreviewUrl=blob?URL.createObjectURL(blob):'';$('productImagePreview').src=productPreviewUrl;$('productImagePreview').hidden=!blob;$('productImageInfo').textContent=message||'';$('removeProductImage').disabled=!blob}
function resetProductImage(){productImageFile=null;$('productImage').value='';$('productImageCamera').value='';showProductPreview(null,'Sin imagen seleccionada.')}
async function refreshImageIndicators(options){const names=new Set(await listProductImageNames().catch(()=>[]));const changed=names.size!==cachedImageNames.size||[...names].some(name=>!cachedImageNames.has(name));cachedImageNames=names;document.querySelectorAll('[data-image-name]').forEach(el=>{el.textContent=names.has(el.dataset.imageName)?'📷 Sí':'—'});if(options?.silent)return;if(changed&&inventorySazFilter==='prep'&&!refreshImageIndicators.reentry){refreshImageIndicators.reentry=true;try{render()}finally{refreshImageIndicators.reentry=false}}}
function activeBranch(){const branch=String($('sucursal')?.value||localStorage.getItem(BRANCH_KEY)||DEFAULT_BRANCH).trim().toUpperCase()||DEFAULT_BRANCH;return branch==='MATRIZ'?DEFAULT_BRANCH:branch}
const sazPrepSearchIndex=window.ClaremmSazPrepExcel?.createSearchIndex?.();
function showCapturedInCatalog(estilo){const input=$('inventorySearch'),scope=$('inventorySearchScope');if(!input||!estilo)return;if(scope){scope.value='style';inventoryScope='style';scope.dispatchEvent(new Event('change',{bubbles:true}))}input.value=estilo;inventoryQuery=estilo;inventoryPage=1;input.dispatchEvent(new Event('input',{bubbles:true}));render()}
async function saveCaptures(rows){
  if(!window.claremmCloud?.recordCaptures)throw Error('El inventario relacional todavía no está disponible.');
  const result=await window.claremmCloud.recordCaptures(rows);
  if(result.pending){
    $('status').textContent=`${result.pending} captura(s) guardadas en este dispositivo, pendientes de confirmación en Supabase.`;
  }else{
    $('inventorySazFilter').value='all';
    $('inventorySazFilter').dispatchEvent(new Event('change',{bubbles:true}));
    showCapturedInCatalog(rows[0].estilo);
    $('status').textContent=`Registro guardado en inventario relacional: ${rows.length} captura(s).`;
    if(sazPrepCatalog.loaded)ensureSazPrepCatalog(true).catch(()=>{});
  }
}
function numericPrice(value){
  const raw=String(value??'').trim().replace(/[^0-9,.-]/g,'');
  const normalized=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
  return Number(normalized)||0;
}
function applySazFields(record){const saz=window.ClaremmSazCatalog;if(!saz?.canonicalize)return record;return saz.canonicalize(record)}
function sazPrepValidationMessage(){if(sazPrepCatalog.loading&&!sazPrepCatalog.loaded)return'Validando faltantes con Supabase…';if(sazPrepCatalog.error&&sazPrepCatalog.loaded)return`Última lectura verificada de Supabase; no se pudo actualizar: ${sazPrepCatalog.error}`;if(sazPrepCatalog.loaded)return'';if(sazPrepCatalog.error)return`No se pudieron validar los faltantes: ${sazPrepCatalog.error}`;return'Inicia sesión para validar los faltantes con Supabase.'}
function currentSazPrepRows(){if(!window.ClaremmSazPrepExcel||!sazPrepCatalog.loaded)return[];return sazPrepCatalog.rows}
function patchSazPrepFicha(patch){const prep=window.ClaremmSazPrepExcel;if(!prep||!patch)return;sazPrepCatalog.rows=prep.applyFichaPatch(sazPrepCatalog.rows,patch);sazPrepSearchIndex?.rebuild?.(sazPrepCatalog.rows);if(sazPrepCatalog.loaded)saveSazPrepSnapshot()}
function saveSazPrepSnapshot(){try{localStorage.setItem(SAZ_PREP_SNAPSHOT_KEY,JSON.stringify({at:sazPrepCatalog.at,source:'supabase',rows:sazPrepCatalog.rows,skipKeys:sazPrepCatalog.skipKeys}))}catch{}}
async function ensureSazPrepCatalog(force=false){if(!window.claremmCloud?.listSazPrepGaps)return;if(sazPrepCatalog.loading)return sazPrepCatalog.loading;if(!force&&sazPrepCatalog.loaded&&Date.now()-sazPrepCatalog.at<60000)return;sazPrepCatalog.error='';sazPrepCatalog.loading=(async()=>{try{const result=await window.claremmCloud.listSazPrepGaps(),rows=Array.isArray(result)?result:result?.rows||[],prep=window.ClaremmSazPrepExcel;sazPrepCatalog.rows=prep?.sortPrepRows?prep.sortPrepRows(rows):rows;sazPrepSearchIndex?.rebuild?.(sazPrepCatalog.rows);sazPrepCatalog.skipKeys=Array.isArray(result)?[]:result?.skipKeys||[];sazPrepCatalog.loaded=true;sazPrepCatalog.at=Date.now();sazPrepCatalog.source='supabase';saveSazPrepSnapshot()}catch(error){sazPrepCatalog.error=error?.message||'Supabase no disponible';if(!sazPrepCatalog.loaded){sazPrepCatalog.rows=[];sazPrepSearchIndex?.rebuild?.([])}throw error}finally{sazPrepCatalog.loading=null}})();return sazPrepCatalog.loading}
function filteredSazPrepFichas(){const prep=window.ClaremmSazPrepExcel,planned=window.ClaremmInventorySearch?.plan?.(inventoryQuery),rows=currentSazPrepRows(),fichas=sazPrepSearchIndex?.lookup?.(inventoryQuery,inventoryScope,planned)??prep?.filterFichas?.(rows,inventoryQuery,inventoryScope,planned)??[];return fichas.map(ficha=>({ficha}))}
function paginationPages(current,total){if(total<=7)return Array.from({length:total},(_,i)=>i+1);const pages=new Set([1,total,current-1,current,current+1]);if(current<=3)[2,3,4].forEach(page=>pages.add(page));if(current>=total-2)[total-3,total-2,total-1].forEach(page=>pages.add(page));const sorted=[...pages].filter(page=>page>0&&page<=total).sort((a,b)=>a-b),tokens=[];for(const page of sorted){if(tokens.length&&page-tokens[tokens.length-1]>1)tokens.push('gap');tokens.push(page)}return tokens}
function renderPagination(totalPages){const pagination=$('inventoryPagination');pagination.hidden=totalPages<=1;$('pagePrev').disabled=inventoryPage<=1;$('pageNext').disabled=inventoryPage>=totalPages;$('pageNumbers').innerHTML=paginationPages(inventoryPage,totalPages).map(page=>page==='gap'?'<span class="pageGap" aria-hidden="true">…</span>':`<button type="button" class="secondary" data-page="${page}"${page===inventoryPage?' aria-current="page"':''} aria-label="Ir a la página ${page}">${page}</button>`).join('')}
function renderBranchOptions(){
  const branches=new Set([DEFAULT_BRANCH,activeBranch()]);
  for(const branch of window.claremmCloud?.captureBranches?.()||[])branches.add(branch.name);
  $('branchOptions').innerHTML=[...branches].sort().map(branch=>`<option value="${esc(branch)}"></option>`).join('');
}
function renderPrepFichaCards(pageFichas,options){if(inventorySazFilter!=='prep'){window.ClaremmFichaCards?.clearPrep?.();return}const cards=window.ClaremmFichaCards;if(!cards?.showFichas)return;const fichas=Array.isArray(pageFichas)?pageFichas:filteredSazPrepFichas().map(row=>row.ficha).filter(Boolean),validation=sazPrepValidationMessage();const query=inventoryQuery.trim();cards.showFichas(fichas,{query,keepPagination:true,title:'Fichas por preparar',info:fichas.length?'Supabase verificado. Sin mezclar fichas locales. Toca un dato para corregirlo.':'',emptyInfo:validation||(query?'Sin fichas JUÁREZ pendientes de SAZ para esa búsqueda.':'No hay fichas de JUÁREZ pendientes de SAZ sin precio o imagen.')})}
function render(){
  const prepView=inventorySazFilter==='prep', rows=prepView?filteredSazPrepFichas():[];
  const totalPages=Math.max(1,Math.ceil(rows.length/INVENTORY_PAGE_SIZE));
  inventoryPage=Math.min(Math.max(1,inventoryPage),totalPages);
  const start=(inventoryPage-1)*INVENTORY_PAGE_SIZE;
  $('inventoryCard').classList.toggle('isPrepView',prepView);
  $('count').textContent=prepView?`(${rows.length})`:'';
  $('inventoryResultInfo').textContent=prepView
    ? `${rows.length} ficha(s) de JUÁREZ pendientes de precio o imagen.`
    : inventoryQuery?'':'Busca por estilo, color o marca para consultar el inventario relacional.';
  renderPagination(totalPages);
  renderBranchOptions();
  if(prepView)renderPrepFichaCards(rows.slice(start,start+INVENTORY_PAGE_SIZE).map(row=>row.ficha));
  else window.ClaremmFichaCards?.clearPrep?.();
}
let inventoryRenderTimer=null;const queueInventoryRender=e=>{inventoryQuery=e.target.value;inventoryPage=1;clearTimeout(inventoryRenderTimer);if(inventorySazFilter==='prep'){render();if(!sazPrepCatalog.loading&&Date.now()-sazPrepCatalog.at>=60000)ensureSazPrepCatalog().then(()=>render()).catch(()=>render());return}inventoryRenderTimer=setTimeout(render,120)};$('inventorySearch').addEventListener('input',queueInventoryRender);$('inventorySearch').addEventListener('search',queueInventoryRender);
$('inventorySearchScope').addEventListener('change',e=>{inventoryScope=e.target.value;inventoryPage=1;render()});
$('inventorySazFilter').addEventListener('change',e=>{inventorySazFilter=e.target.value;inventoryPage=1;render();if(inventorySazFilter==='prep')ensureSazPrepCatalog(true).then(()=>render()).catch(()=>render())});
$('inventoryPagination').addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.id==='pagePrev')inventoryPage--;else if(button.id==='pageNext')inventoryPage++;else if(button.dataset.page)inventoryPage=Number(button.dataset.page);render();$('inventoryResultInfo').scrollIntoView({behavior:'smooth',block:'nearest'})});
function clearForm(){
  const branch=activeBranch();
  fields.forEach(k=>$(k).value='');
  $('sucursal').value=branch;
  $('cantidad').value=1;
  $('editNotice').textContent='';
  resetProductImage();
}
function valid(x){
  const size=String(x.talla||'').trim().replace(',','.');
  const quantity=Number(x.cantidad);
  return x.sucursal&&x.estilo&&x.color&&/^\d+(?:\.\d+)?$/.test(size)
    && Number(size)>0&&Number.isInteger(2*Number(size))&&Number.isSafeInteger(quantity)&&quantity>0;
}
$('save').onclick=async()=>{
  const x=applySazFields(Object.fromEntries(fields.map(k=>[k,$(k).value.trim()])));
  x.sucursal=activeBranch();
  if(!valid(x))return alert('Completa sucursal, estilo, color, talla entera o media y cantidad entera positiva.');
  $('save').disabled=true;
  try{
    if(productImageFile){
      $('productImageInfo').textContent='Comprimiendo imagen…';
      x.imageKey='capture:'+crypto.randomUUID();
      await putProductImageLocal(x.imageKey,await compressProductImage(productImageFile));
    }
    await saveCaptures([x]);
    localStorage.setItem(BRANCH_KEY,x.sucursal);
    clearForm();
    clearCapturedPhotos();
  }catch(error){
    if(x.imageKey)await deleteProductImageLocal(x.imageKey).catch(()=>{});
    alert('No se pudo guardar la captura: '+error.message);
  }finally{$('save').disabled=false}
};
async function selectProductImage(file,source){if(!file)return alert('No llegó la foto. Vuelve a tomarla.');try{const snapshot=await snapshotImageFile(file);if(!isImageFile(snapshot))return alert('Selecciona un archivo de imagen.');productImageFile=snapshot;const origin=source==='camera'?'Fotografía tomada. ':'Imagen seleccionada. ';showProductPreview(snapshot,origin+'Se comprimirá como '+(imageNamePart($('estilo').value)||'ESTILO')+'-'+(imageNamePart($('color').value)||'COLOR')+'.png (máximo 100 KB).')}catch(error){alert(error.message||'No se pudo leer la foto. Vuelve a tomarla.')}}
$('chooseProductImage').onclick=()=>$('productImage').click();$('productImage').onchange=e=>selectProductImage(e.target.files?.[0],'gallery');
$('captureProductImage').onclick=()=>$('productImageCamera').click();$('productImageCamera').onchange=e=>selectProductImage(e.target.files?.[0],'camera');
$('removeProductImage').onclick=resetProductImage;
$('reset').onclick=clearForm;
function showCapturedPreview(blob){if(capturePreviewUrl)URL.revokeObjectURL(capturePreviewUrl);capturePreviewUrl=URL.createObjectURL(blob);$('preview').src=capturePreviewUrl;$('preview').style.display='block'}
function clearCapturedPhotos(){photos=[];$('photo').value='';if(capturePreviewUrl)URL.revokeObjectURL(capturePreviewUrl);capturePreviewUrl='';$('preview').removeAttribute('src');$('preview').style.display='none';$('fileInfo').textContent='';$('debug').textContent='';$('ocrDetails').open=false}
function setPhotos(files){photos=[...files].filter(isImageFile);if(!photos.length)return alert('No llegó la foto. Vuelve a tomarla o elígela de la galería.');$('fileInfo').textContent=`${photos.length} fotografía(s) preparada(s)`;showCapturedPreview(photos[0])}
$('choose').onclick=()=>$('photo').click();$('photo').onchange=e=>setPhotos(e.target.files);
$('openCamera').onclick=async()=>{if(!navigator.mediaDevices?.getUserMedia){alert('Cámara no disponible. Abre la app con HTTPS o localhost, o usa Cargar fotografías.');return}try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});$('camera').srcObject=stream;$('camera').style.display='block';$('take').disabled=false;$('closeCamera').disabled=false;$('status').textContent='Cámara lista. Enfoca las etiquetas y pulsa Capturar foto.'}catch(e){alert('No se pudo abrir la cámara: '+e.message)}};
function closeCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$('camera').srcObject=null;$('camera').style.display='none';$('take').disabled=true;$('closeCamera').disabled=true}
$('closeCamera').onclick=closeCamera;$('take').onclick=async()=>{const v=$('camera'),c=$('captureCanvas');if(!v.videoWidth){await new Promise(resolve=>{let n=0;const tick=()=>{if(v.videoWidth||++n>40)return resolve();setTimeout(tick,50)};tick()})}if(!v.videoWidth)return alert('Espera a que cargue la cámara y vuelve a pulsar Capturar foto.');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);let blob=null;try{blob=await canvasToBlob(c,'image/jpeg',.9)}catch{try{blob=await canvasToBlob(c,'image/jpeg',.7)}catch{try{const data=c.toDataURL('image/jpeg',.8);blob=await(await fetch(data)).blob()}catch{blob=null}}}if(!blob)return alert('No se pudo guardar la foto. Vuelve a capturar.');photos.push(new File([blob],`captura-${Date.now()}.jpg`,{type:'image/jpeg'}));showCapturedPreview(blob);$('fileInfo').textContent=`${photos.length} fotografía(s) preparada(s). Puedes capturar otra.`};
// Los estilos CLAREMM son códigos de catálogo, NO palabras como FILM27.
const SIZE=/\b(?:1[5-9]|2\d|3[0-2])\s*[.,]\s*[05]\b/g;
function tokens(text,regex){return [...String(text).matchAll(regex)].map(m=>({value:m[0].toUpperCase().replace(/\s+/g,''),index:m.index}))}
const COLOR_PATTERNS=[['NEGRO',/\bNEGR[O0Q]\b/gi],['BLANCO',/\bBLANC[O0Q]\b/gi],['MARINO',/\bMARIN[O0Q]\b/gi],['CAFE',/\bCAF[EÉ]\b/gi],['CAMEL',/\bCAMEL\b/gi],['MIEL',/\bM[I1L]E[L1I]\b/gi],['GRIS',/\bGR[I1L]S\b/gi],['ROJO',/\bR[O0Q]J[O0Q]\b/gi],['ARENA',/\bARENA\b/gi],['AZUL',/\bAZU[L1I]\b/gi],['BEIGE',/\bBE[I1L]GE\b/gi],['ORO',/\b[O0Q]R[O0Q]\b/gi],['PLATA',/\bPLATA\b/gi],['VINO',/\bVINO\b/gi],['VERDE',/\bVERDE\b/gi],['ROSA',/\bROSA\b/gi],['MORADO',/\bMORADO\b/gi],['COGNAC',/\bCOGNAC\b/gi],['TAN',/\bTAN\b/gi],['NATURAL',/\bNATURAL\b/gi],['MULTICOLOR',/\bMULTICOLOR\b/gi],['MEZCLILLA',/\bMEZCLILLA\b/gi],['AMBAR',/\b[AÁ]MBAR\b/gi],['AQUA',/\bAQUA\b/gi],['CHAROL',/\bCHAROL\b/gi],['NUDE',/\bNUDE\b/gi]];
// Tesseract suele unir la primera línea de la etiqueta: LAP603NEGRO.
// Reinsertar el espacio permite reconocer ambos campos sin aceptar palabras arbitrarias como estilos.
function normalizeOCRSpacing(text){return String(text).toUpperCase().replace(/\r/g,'').replace(/([0-9OQDILSZGB])(?=(?:NEGR[O0Q]|BLANC[O0Q]|MARIN[O0Q]|CAF[EÉ]|CAMEL|M[I1L]E[L1I]|GR[I1L]S|R[O0Q]J[O0Q]|ARENA|AZU[L1I]|BE[I1L]GE|[O0Q]R[O0Q]|PLATA|VINO|VERDE|ROSA|MORADO|COGNAC|TAN|NATURAL|MULTICOLOR))/g,'$1 ').replace(/([A-Z0-9])(?=P[I1L]E[L1I])/g,'$1 ').replace(/(P[I1L]E[L1I])(?=\d)/g,'$1 ')}
function editDistance(a,b){const row=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return row[b.length]}
function findColors(text){const normalized=normalizeOCRSpacing(text),found=[];for(const [value,rx] of COLOR_PATTERNS){rx.lastIndex=0;for(const m of normalized.matchAll(rx))found.push({value,index:m.index})}return found.sort((a,b)=>a.index-b.index)}
function findColorPhrase(text){const found=findColors(text);if(!found.length)return '';const first=found[0],second=found.find(item=>item.value!==first.value&&item.index-first.index<18);return second?`${first.value} ${second.value}`:first.value}
function normalizeColorWord(raw){const word=String(raw||'').toUpperCase().replace(/[0Q]/g,'O').replace(/1/g,'I').replace(/5/g,'S').replace(/8/g,'B');if(/^(?:PIEL|SINTETICO|SINTÉTICO)$/.test(word))return '';for(const [name] of COLOR_PATTERNS)if(editDistance(word,name)<=1)return name;return ''}
function infer(text){const t=text.toUpperCase();return {linea:/OXFORD|VESTIR/.test(t)?'Zapato':/TENIS|SOCCER|DEPORTIVO/.test(t)?'Tenis':/BOTA|BOTIN/.test(t)?'Bota':/HUARACHE|SANDALIA/.test(t)?'Huarache':'',material:/\bP[I1L]E[L1I]\b/.test(t)?'PIEL':/S[I1L]NT[EÉ]T[I1L]C[O0Q]/.test(t)?'SINTETICO':'',precio:''}}
const STYLE_PREFIXES=['LAP','ANG','GIO','ROD','OLP','UN','SP','PI','PA'];
function prefixLooksLike(raw,expected){if(raw.length!==expected.length)return false;for(let i=0;i<raw.length;i++)if(raw[i]!==expected[i]&&!((expected[i]==='O'&&/[0QD]/.test(raw[i]))||(expected[i]==='I'&&/[1L]/.test(raw[i]))||(expected[i]==='L'&&/[I1]/.test(raw[i]))))return false;return true}
function normalizeCode(s){let code=s.toUpperCase().replace(/[\s-]/g,'').replace(/^0(?=[A-Z]{1,5}[0-9OQDILSZGB])/,'O');for(const prefix of STYLE_PREFIXES){const rawPrefix=code.slice(0,prefix.length),rawDigits=code.slice(prefix.length);if(rawDigits.length>=3&&rawDigits.length<=6&&/[0-9]/.test(rawDigits)&&/^[0-9OQDILSZGB]+$/.test(rawDigits)&&prefixLooksLike(rawPrefix,prefix)){const digits=rawDigits.replace(/[OQD]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/S/g,'5').replace(/G/g,'6').replace(/B/g,'8');return prefix+digits}}let m=code.match(/^([A-Z]{2,6})([0-9OQDILSZGB]{2,6})$/);if(!m)return code;return m[1]+m[2].replace(/[OQD]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/S/g,'5').replace(/G/g,'6').replace(/B/g,'8')}
function validCode(s){return /^(?:[A-Z]{2,6}\d{2,6}|UNGOLD|GOUNGOLD|\d{5,7}[A-Z]?)$/.test(s)}
function recoverCornerCode(text){const compact=String(text).toUpperCase().replace(/[^A-Z0-9]/g,''),digitClass='[0-9OQDCILSZGBEAT]';const patterns=[['LAP',new RegExp('(?:LAP|AP)('+digitClass+'{2,6})')],['ANG',new RegExp('ANG('+digitClass+'{2,6})')],['UN',new RegExp('UN('+digitClass+'{2,6})')],['SP',new RegExp('SP('+digitClass+'{2,6})')],['PI',new RegExp('P[I1]('+digitClass+'{3,6})')]];for(const [prefix,rx] of patterns){const m=compact.match(rx);if(!m||!/[0-9]/.test(m[1]))continue;const digits=m[1].replace(/[OQDC]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/A/g,'4').replace(/S/g,'5').replace(/[GE]/g,'6').replace(/T/g,'7').replace(/B/g,'8');const code=prefix+digits;if(validCode(code))return code}return ''}
function findCodes(text){const upper=normalizeOCRSpacing(text),found=[];const rx=/\b(?:LAP|LA[PFR]|UN|ANG|SP|PI|P1)[ \t]*-?[ \t]*[0-9OQDILSZGB]{3,6}(?=$|[^0-9OQDILSZGB])|\b(?:[A-Z]{2,6}|0[A-Z]{1,5})-?[0-9OQDILSZGB]{3,6}(?=$|[^0-9OQDILSZGB])|\b(?:UNGOLD|GOUNGOLD)\b|\b\d{5,7}[A-Z]?\b/gi;for(const m of upper.matchAll(rx)){if(!/\d/.test(m[0])&&!/UNGOLD|GOUNGOLD/i.test(m[0]))continue;const code=normalizeCode(m[0]),knownPrefix=STYLE_PREFIXES.find(prefix=>code.startsWith(prefix));if(knownPrefix&&code.length-knownPrefix.length<3)continue;if(validCode(code)&&!found.some(x=>x.code===code))found.push({code,index:m.index})}if(found.length)return found;let offset=0;for(const line of upper.split('\n')){const body=line.trimStart(),leading=line.length-body.length,parts=[...body.matchAll(/[A-Z0-9]+/g)];let joined='';for(let i=0;i<Math.min(parts.length,8);i++){if(i&&/[^ \t-]/.test(body.slice(parts[i-1].index+parts[i-1][0].length,parts[i].index)))break;joined+=parts[i][0];if(!/\d/.test(joined))continue;const code=normalizeCode(joined),rest=body.slice(parts[i].index+parts[i][0].length).trimStart();let hasColor=false;for(const [,pattern] of COLOR_PATTERNS){pattern.lastIndex=0;const match=pattern.exec(rest);if(match?.index===0){hasColor=true;break}}const knownLong=STYLE_PREFIXES.some(prefix=>code.startsWith(prefix)&&code.length-prefix.length>=3);if(validCode(code)&&(hasColor||/^(?:P[I1L]E[L1I]|S[I1L]NT[EÉ]T[I1L]C[O0Q])\b/.test(rest)||knownLong)){found.push({code,index:offset+leading});return found}}offset+=line.length+1}const prefixes=[['LAP',3],['ANG',3],['UN',2],['SP',2],['PI',2]];for(const m of upper.matchAll(/\b[A-Z0-9]{5,10}\b/g)){for(const [prefix,n] of prefixes){const rawDigits=m[0].slice(n);if(m[0].length<n+3||m[0].length>n+6||!/[0-9]/.test(rawDigits)||editDistance(m[0].slice(0,n),prefix)>1)continue;const digits=rawDigits.replace(/[OQDC]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/A/g,'4').replace(/S/g,'5').replace(/[GE]/g,'6').replace(/T/g,'7').replace(/B/g,'8');const code=prefix+digits;if(validCode(code)){found.push({code,index:m.index});return found}}}return found}
function colorAfterCode(group){const line=String(group).split(/\n/).find(x=>findCodes(x).length)||'',code=findCodes(line)[0]?.code||'';let compact='',end=0;for(const token of line.matchAll(/[A-Z0-9]+/gi)){compact+=token[0];if(normalizeCode(compact)===code){end=token.index+token[0].length;break}}return findColorPhrase(line.slice(end))}
function parseOCR(text){const t=normalizeOCRSpacing(text),codes=findCodes(t),results=[];for(let j=0;j<codes.length;j++){const c=codes[j],end=j+1<codes.length?codes[j+1].index:t.length;let group=t.slice(c.index,end);if(group.length<20)group=t.slice(c.index,Math.min(t.length,c.index+130));const color=findColorPhrase(group)||colorAfterCode(group),sizes=tokens(group,SIZE),info=infer(group);results.push(applySazFields({estilo:c.code,marca:'',color:window.ClaremmSazCatalog?.resolve?.('color',color)||color,linea:info.linea,talla:sizes[0]?.value.replace(',','.')||'',material:info.material,cantidad:'1',precio:'',notas:'',warning:!color||!sizes.length?'Verificar: faltan color o talla':'Verificar asociación de datos',selected:!!(color&&sizes.length)}))}if(!results.length&&t.trim())results.push(applySazFields({estilo:'',marca:'',color:window.ClaremmSazCatalog?.resolve?.('color',findColorPhrase(t)||'')||findColorPhrase(t)||'',linea:infer(t).linea,talla:tokens(t,SIZE)[0]?.value.replace(',','.')||'',material:infer(t).material,cantidad:'1',precio:'',notas:'',warning:'No se identificó estilo; completar manualmente',selected:false}));return results}
// Segunda lectura focalizada: en etiquetas CLAREMM el estilo aparece en la esquina superior izquierda.
// Se evita asignar automáticamente una palabra espuria del OCR general.
function otsuBinarize(canvas){const ctx=canvas.getContext('2d',{willReadFrequently:true}),image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data,hist=new Uint32Array(256);for(let i=0;i<data.length;i+=4)hist[Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114)]++;const total=canvas.width*canvas.height;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,best=0,threshold=128;for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=i*hist[i];const meanB=sumB/wB,meanF=(sum-sumB)/wF,variance=wB*wF*(meanB-meanF)*(meanB-meanF);if(variance>best){best=variance;threshold=i}}for(let i=0;i<data.length;i+=4){const gray=Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114),value=gray<threshold?0:255;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255}ctx.putImageData(image,0,0)}
function makeOcrCanvas(bitmap,region={x:0,y:0,w:1,h:1},angle=0,binary=false){const sx=Math.round(bitmap.width*region.x),sy=Math.round(bitmap.height*region.y),sw=Math.max(1,Math.round(bitmap.width*region.w)),sh=Math.max(1,Math.round(bitmap.height*region.h)),rad=angle*Math.PI/180,maxSide=Math.max(sw,sh),scale=Math.min(3.4,2200/maxSide),w=Math.round(sw*scale),h=Math.round(sh*scale),cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad)),c=document.createElement('canvas');c.width=Math.ceil(w*cos+h*sin);c.height=Math.ceil(w*sin+h*cos);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.translate(c.width/2,c.height/2);ctx.rotate(rad);ctx.filter='grayscale(1) contrast(1.65)';ctx.drawImage(bitmap,sx,sy,sw,sh,-w/2,-h/2,w,h);ctx.setTransform(1,0,0,1,0,0);if(binary)otsuBinarize(c);return c}
async function focusedRead(file,worker){const bitmap=await createImageBitmap(file);try{const center={x:.07,y:.16,w:.86,h:.78},lower={x:0,y:.27,w:1,h:.73},left={x:0,y:.3,w:.74,h:.7},right={x:.26,y:.3,w:.74,h:.7},whole={x:0,y:0,w:1,h:1},attempts=[['Centro grises',center,0,false,0],['Centro binaria',center,0,true,.2],['Zona inferior',lower,0,false,1],['Inferior izquierda',left,0,true,1],['Inferior derecha',right,0,true,1],['Imagen completa',whole,0,true,0],['Centro -12°',center,-12,true,4],['Centro +12°',center,12,true,4]],logs=[],candidates=[];await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789., ÁÉÍÓÚÑ',preserve_interword_spaces:'1',user_defined_dpi:'300'});for(const [label,region,angle,binary,priority] of attempts){const result=await worker.recognize(makeOcrCanvas(bitmap,region,angle,binary)),text=result.data.text||'',rows=parseOCR(text),confidence=Number(result.data.confidence)||0;logs.push(`--- ${label} (${confidence.toFixed(0)}%) ---\n${text}`);for(const row of rows){const score=Number(!!row.estilo)*10+Number(!!row.color)*3+Number(!!row.talla)*3+Number(!!row.material)+priority+confidence/100;candidates.push({row,text,score})}}candidates.sort((a,b)=>b.score-a.score);const best=candidates.find(x=>x.row.estilo)||candidates[0];if(best?.row.estilo){for(const other of candidates)if(other.row.estilo===best.row.estilo)for(const key of ['color','linea','talla','material'])if(!best.row[key]&&other.row[key])best.row[key]=other.row[key]}return {row:best?.row||null,text:best?.text||'',log:logs.join('\n')}}finally{bitmap.close?.()}}
function improveSingleLabel(base,focused){const focusedRow=focused?.row;let candidate=base.length===1?base[0]:null;if(!candidate&&focusedRow){candidate={...focusedRow};base=[candidate]}if(!candidate)return base;if(focusedRow?.estilo){for(const key of ['estilo','color','linea','talla','material'])candidate[key]=focusedRow[key]||''}Object.assign(candidate,applySazFields(candidate));candidate.warning=candidate.estilo?'OCR por región; confirma los datos':'No se identificó estilo; completar manualmente';candidate.selected=!!(candidate.estilo&&candidate.color&&candidate.talla);return base}
function renderPending(){$('reviewCard').hidden=!pending.length;if(pending.length)setCardCollapsed($('reviewCard'),false);pending.forEach(item=>{if(!item.sucursal)item.sucursal=activeBranch()});$('pendingCount').textContent=`(${pending.length})`;$('pendingRows').innerHTML=pending.map((x,i)=>`<tr><td><input type="checkbox" data-i="${i}" data-k="selected" ${x.selected?'checked':''}></td>${['estilo','marca','sucursal','color','linea','talla','cantidad','material','precio'].map(k=>`<td><input aria-label="${k}" data-i="${i}" data-k="${k}" value="${esc(x[k])}" ${k==='linea'?'list="lineOptions"':k==='color'?'list="sazColorOptions"':k==='marca'?'list="sazMarcaOptions"':k==='material'?'list="sazAcabadoOptions"':''}></td>`).join('')}<td class="warn">${esc(x.warning)}</td></tr>`).join('')}
$('pendingRows').addEventListener('change',e=>{const el=e.target;if(el.dataset.i===undefined)return;const row=pending[Number(el.dataset.i)];if(el.type==='checkbox'){row[el.dataset.k]=el.checked;return}row[el.dataset.k]=el.value;if(['color','marca','linea','material'].includes(el.dataset.k))Object.assign(row,applySazFields(row));if(el.dataset.k==='color')el.value=row.color;if(el.dataset.k==='marca')el.value=row.marca;if(el.dataset.k==='material')el.value=row.material});
$('pendingRows').addEventListener('input',e=>{const el=e.target;if(el.dataset.i===undefined)return;pending[Number(el.dataset.i)][el.dataset.k]=el.value});
$('discardPending').onclick=()=>{pending=[];renderPending()};
$('importPending').onclick=async()=>{
  const selected=pending.filter(row=>row.selected);
  if(!selected.length)return alert('Selecciona al menos una fila.');
  if(selected.some(row=>!valid(row)))return alert('Corrige las filas con talla o cantidad inválidas.');
  $('importPending').disabled=true;
  try{
    await saveCaptures(selected.map(({selected,warning,...row})=>row));
    pending=pending.filter(row=>!row.selected);
    renderPending();
    clearCapturedPhotos();
  }catch(error){alert('No se pudieron guardar las capturas: '+error.message)}
  finally{$('importPending').disabled=false}
};
function visionImageData(file){return createImageBitmap(file).then(bitmap=>{try{const maxSide=1800,scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);let quality=.86,data=canvas.toDataURL('image/jpeg',quality);while(data.length>3000000&&quality>.48){quality-=.1;data=canvas.toDataURL('image/jpeg',quality)}if(data.length>3500000)throw Error('La fotografía es demasiado grande para analizarla.');return data}finally{bitmap.close?.()}})}
function parseVisiblePrice(value){const raw=String(value??'').trim();if(!raw)return '';const match=raw.replace(/\$/g,'').match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2}|\d{2,5})/);if(!match)return '';const token=match[1].replace(',', '.');if(/^(?:1[5-9]|2\d|3[0-2])(?:\.0|\.5)?$/.test(token))return '';const amount=numericPrice(match[1]);return amount>=50?String(amount):''}
function visionRow(label){const style=normalizeCode(String(label?.style||'').replace(/[^A-Za-z0-9 -]/g,'')),brand=String(label?.brand||'').toUpperCase().trim().replace(/[^A-Z0-9ÁÉÍÓÚÑ .&'/-]/g,'').slice(0,50),rawColor=String(label?.color||'').toUpperCase().trim().replace(/[\/\-]+/g,' ').replace(/\s+/g,' '),sizeMatch=String(label?.size||'').replace(',','.').match(/^(?:1[5-9]|2\d|3[0-2])\.[05]$/),confidence=Math.max(0,Math.min(1,Number(label?.confidence)||0)),material=/S[IÍ]NTETICO/i.test(label?.material||'')?'SINTETICO':/PIEL/i.test(label?.material||'')?'PIEL':'',line=String(label?.line||'').trim(),precio=parseVisiblePrice(label?.price);const color=window.ClaremmSazCatalog?.resolve?.('color',findColorPhrase(rawColor)||rawColor.replace(/[^A-ZÁÉÍÓÚÑ ]/g,'').slice(0,40).trim())||findColorPhrase(rawColor)||rawColor.replace(/[^A-ZÁÉÍÓÚÑ ]/g,'').slice(0,40).trim();const row=applySazFields({estilo:validCode(style)?style:'',marca:brand,color,linea:line,talla:sizeMatch?.[0]||'',material,cantidad:'1',precio,notas:'',warning:`Visión ${Math.round(confidence*100)}%; confirma los datos`,selected:false});row.selected=!!(row.estilo&&row.color&&row.talla&&confidence>=.6);if(!row.estilo)row.warning='Visión no distinguió el estilo; revisar manualmente';return row}
async function readWithVision(file){const image=await visionImageData(file),response=await fetch('./api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})}),body=await response.json().catch(()=>({}));if(!response.ok){const error=Error(body.message||`Error de visión (${response.status})`);error.code=body.error||'vision_error';error.provider=body.provider||'';throw error}const rows=(body.labels||[]).map(visionRow);if(!rows.some(row=>row.precio)&&body.rawText){const fallback=parseVisiblePrice(body.rawText);if(fallback)for(const row of rows)if(!row.precio)row.precio=fallback}return {rows,rawText:body.rawText||'',provider:body.provider||'vision'}}
$('scan').onclick=async()=>{if(busy)return;if(!photos.length)return alert('Toma o carga al menos una fotografía.');busy=true;$('scan').disabled=true;pending=[];$('debug').textContent='';$('ocrDetails').open=false;let worker,currentPhoto=0,lastGeminiAt=0;const getWorker=async()=>{if(worker)return worker;if(!window.Tesseract)throw Error('No se cargó el OCR local de respaldo. Comprueba internet.');$('status').textContent=`Preparando OCR local para foto ${currentPhoto+1}...`;worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text')$('status').textContent=`OCR local ${currentPhoto+1}/${photos.length}: ${Math.round(m.progress*100)}%`}});return worker};try{for(let i=0;i<photos.length;i++){currentPhoto=i;if(lastGeminiAt){const wait=Math.max(0,6500-(Date.now()-lastGeminiAt));if(wait){$('status').textContent=`Esperando cuota gratuita de Gemini para foto ${i+1}/${photos.length}...`;await new Promise(resolve=>setTimeout(resolve,wait))}}$('status').textContent=`Analizando con visión foto ${i+1}/${photos.length}...`;try{const vision=await readWithVision(photos[i]);if(vision.provider==='gemini')lastGeminiAt=Date.now();$('debug').textContent+=`\n--- ${vision.provider.toUpperCase()} foto ${i+1}: ${photos[i].name} ---\n${vision.rawText}\n${JSON.stringify(vision.rows.map(({warning,selected,...x})=>x),null,2)}\n`;if(vision.rows.some(x=>x.estilo)){pending.push(...vision.rows);continue}$('debug').textContent+='Visión no encontró un estilo; se intentará OCR local.\n'}catch(err){$('debug').textContent+=`\n--- ${String(err.provider||'visión').toUpperCase()} foto ${i+1} no disponible (${err.code||'error'}) ---\n${err.message}\nSe usará OCR local de respaldo.\n`}const localWorker=await getWorker();$('status').textContent=`Procesando foto ${i+1}/${photos.length} con OCR local...`;await localWorker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT,tessedit_char_whitelist:'',preserve_interword_spaces:'1'});const r=await localWorker.recognize(photos[i]);$('debug').textContent+=`\n--- OCR local foto ${i+1}: ${photos[i].name} ---\n${r.data.text}\n`;let parsed=parseOCR(r.data.text);
// Solo se usa la lectura focalizada si hay una única etiqueta candidata;
// en fotos con varias cajas, recortar la parte superior podría mezclar productos.
if(parsed.length<=1){try{const focused=await focusedRead(photos[i],localWorker);$('debug').textContent+=`\n--- OCR por regiones ---\n${focused.log}\n`;parsed=improveSingleLabel(parsed,focused)}catch(err){$('debug').textContent+=`\nOCR por regiones no disponible: ${err.message}\n`}}
pending.push(...parsed)}renderPending();if(pending.some(x=>!x.estilo||!x.color))$('ocrDetails').open=true;$('status').textContent=`Detectadas ${pending.length} posible(s) etiqueta(s). Revisa antes de guardar.`;if(pending.length)$('reviewCard').scrollIntoView({behavior:'smooth'})}catch(e){$('status').textContent='Error OCR: '+e.message;$('ocrDetails').open=true}finally{await worker?.terminate();busy=false;$('scan').disabled=false}};
const inventoryHeaders=['Sucursal','Estilo','Marca','Color','Tipo de línea','Talla','Cantidad','Material','Precio','Notas','Estado SAZ'];
const inventoryExportRow=x=>({'Sucursal':x.sucursal,'Estilo':x.estilo,'Marca':x.marca,'Color':x.color,'Tipo de línea':x.linea,'Talla':x.talla,'Cantidad':x.cantidad,'Material':x.material,'Precio':x.precio,'Notas':x.notas,'Estado SAZ':x.estado});
function exportRelational(id,write){
  $(id).onclick=async()=>{
    $(id).disabled=true;
    try{
      const rows=await window.claremmCloud.listRelationalStock();
      if(!rows.length)throw Error('No hay existencias relacionales para exportar.');
      await write(rows);
      $('imageExportInfo').textContent='Exportación de Supabase completada.';
    }catch(error){alert('No se pudo exportar el inventario: '+error.message)}
    finally{$(id).disabled=false}
  };
}
function download(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)}
exportRelational('xlsx',rows=>{
  if(!window.XLSX)throw Error('No se cargó el lector de Excel.');
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(inventoryExportRow),{header:inventoryHeaders}),'Existencia actual');
  XLSX.writeFile(wb,'CLAREMM_Existencia_Actual.xlsx');
});
$('xlsxSazGaps').onclick=async()=>{
  if(!window.XLSX||!window.ClaremmSazPrepExcel)return alert('No se cargó el exportador de Excel.');
  const prep=window.ClaremmSazPrepExcel,button=$('xlsxSazGaps');
  button.disabled=true;
  try{
    if(!window.claremmCloud?.listSazPrepGaps)throw Error('Inicia sesión para consultar JUÁREZ.');
    await ensureSazPrepCatalog(true);
    const rows=currentSazPrepRows();
    if(!rows.length)throw Error('No hay fichas de JUÁREZ pendientes de precio o imagen.');
    const inventoryRows=prep.toInventoryRows(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(inventoryRows,{header:prep.inventoryHeaders(rows)}),prep.INVENTORY_SHEET);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(prep.toResumenRows(inventoryRows),{header:prep.RESUMEN_HEADERS}),prep.RESUMEN_SHEET);
    XLSX.writeFile(wb,'CLAREMM_Fichas_Por_Preparar_JUAREZ.xlsx');
    $('imageExportInfo').textContent=`${rows.length} ficha(s) por preparar. El Excel muestra su existencia actual en JUÁREZ.`;
    if(inventorySazFilter==='prep')render();
  }catch(error){alert(error.message)}
  finally{button.disabled=false}
};
exportRelational('csv',rows=>{
  const rowsForCsv=[inventoryHeaders,...rows.map(row=>Object.values(inventoryExportRow(row)))];
  const csv='\ufeff'+rowsForCsv.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'CLAREMM_Existencia_Actual.csv');
});
exportRelational('backup',rows=>download(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}),'CLAREMM_Existencia_Actual.json'));
$('importInventory').onclick=()=>$('branchStockOpen').click();
$('exportImages').onclick=async()=>{if(!window.JSZip)return alert('No se cargó el exportador ZIP. Comprueba internet.');const button=$('exportImages'),originalLabel=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');try{$('imageExportInfo').textContent='Reuniendo imágenes del catálogo relacional…';const source=window.claremmCloud?.listAllProductImages?await window.claremmCloud.listAllProductImages():{images:await listProductImages(),cloudComplete:false},images=(source.images||[]).filter(image=>!image.name.startsWith('capture:'));if(!images.length)throw Error('No hay imágenes de producto guardadas.');const unique=new Map(images.map(image=>[image.name,image]));const exportImages=[...unique.values()],zip=new JSZip;for(let i=0;i<exportImages.length;i++){button.textContent=`Procesando ${i+1}/${exportImages.length}`;$('imageExportInfo').textContent=`Verificando imagen ${i+1} de ${exportImages.length}…`;const blob=await exportableImageBlob(exportImages[i].blob);zip.file(exportImages[i].name,blob)}button.textContent='Creando ZIP…';const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),date=new Date().toISOString().slice(0,10);download(blob,`CLAREMM_Imagenes_${date}.zip`);$('imageExportInfo').textContent=`Exportadas ${exportImages.length} imagen(es) sin duplicados, cada una con máximo 100 KB.${source.cloudComplete?' Se incluyó el catálogo relacional.':' Inicia sesión para incluir también las imágenes relacionales.'}`}catch(e){$('imageExportInfo').textContent='No se pudo completar la exportación.';alert('No se pudieron exportar las imágenes: '+e.message)}finally{button.disabled=false;button.removeAttribute('aria-busy');button.textContent=originalLabel}};
let deferredInstallPrompt=null;const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent),isMobile=isIOS||/Android/i.test(navigator.userAgent)||navigator.userAgentData?.mobile===true;
function showInstallUi(message=''){if(standalone)return;$('installApp').hidden=false;$('installHelp').hidden=!message;$('installHelp').textContent=message}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;showInstallUi('Lista para instalarse en este dispositivo.')});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;$('installApp').hidden=true;$('installHelp').hidden=true});
$('installApp').onclick=async()=>{if(deferredInstallPrompt){await deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return}if(isIOS)return alert('En iPhone o iPad: abre esta página en Safari, toca Compartir y elige “Agregar a pantalla de inicio”. Activa “Abrir como app” si aparece.');if(!window.isSecureContext)return alert('La instalación requiere abrir la app mediante HTTPS. Usa la dirección publicada en Vercel.');alert('Abre el menú de tu navegador y selecciona “Instalar aplicación” o “Agregar a pantalla principal”.')};
if(!standalone&&isIOS)showInstallUi('iPhone/iPad: usa Compartir → Agregar a pantalla de inicio.');else if(!standalone&&isMobile)setTimeout(()=>{if(!deferredInstallPrompt)showInstallUi('Si no aparece el aviso, usa el menú del navegador → Instalar aplicación.')},1500);
window.ClaremmStore={
  clearSazPrepCatalog(){
    sazPrepCatalog={rows:[],skipKeys:[],loaded:false,at:0,loading:null,error:'',source:''};
    sazPrepSearchIndex?.rebuild?.([]);
    localStorage.removeItem(SAZ_PREP_SNAPSHOT_KEY);
    if(inventorySazFilter==='prep')render();
  },
  getProductImage,listProductImages,putImageFromCloud:putProductImageLocal,deleteImageFromCloud:deleteProductImageLocal,
  async clearImagesFromCloud(){
    const names=await listProductImageNames();
    await Promise.all(names.filter(name=>!name.startsWith('capture:')).map(deleteProductImageLocal));
  },
  refreshImageIndicators,isImageFile,snapshotImageFile,compressProductImage,openImagePreview,closeImagePreview,
  readWithVision,parseVisiblePrice,
  patchSazPrepFicha(patch,options){patchSazPrepFicha(patch);if(!options?.silent&&inventorySazFilter==='prep')render()},
  refreshSazPrepCatalog:()=>{renderBranchOptions();return ensureSazPrepCatalog(true).finally(render)},
  renderPrepFichaCards,
};
$('sucursal').value=activeBranch();localStorage.setItem(BRANCH_KEY,activeBranch());$('inventorySazFilter').value=inventorySazFilter;setupCardToggles();render();resetProductImage();ensureSazPrepCatalog().then(()=>{if(inventorySazFilter==='prep')render()}).catch(()=>{if(inventorySazFilter==='prep')render()});$('imagePreviewClose')?.addEventListener('click',closeImagePreview);$('imagePreviewDialog')?.addEventListener('click',e=>{if(e.target===$('imagePreviewDialog')||e.target===$('imagePreviewFull'))closeImagePreview()});$('preview')?.addEventListener('click',()=>{const src=$('preview').getAttribute('src');if(src)openImagePreview(src,'Fotografía capturada')});$('productImagePreview')?.addEventListener('click',()=>{const img=$('productImagePreview');if(!img.hidden&&img.getAttribute('src'))openImagePreview(img.src,'Foto del producto')});
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=49-busqueda-supabase',{updateViaCache:'none'}).catch(()=>{});
