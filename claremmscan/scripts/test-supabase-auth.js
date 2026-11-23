'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function captureSignUp(href) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: false, disabled: false, textContent: '', className: '', value: '',
      onclick: null,
    });
    return elements.get(id);
  };
  const storage = new Map();
  const location = new URL(href);
  let signUpPayload = null;
  let resendPayload = null;
  const client = {
    auth: {
      signUp: async payload => {
        signUpPayload = payload;
        return { data: { session: null }, error: null };
      },
      resend: async payload => {
        resendPayload = payload;
        return { error: null };
      },
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => {},
      onAuthStateChange: () => {},
      getSession: async () => ({ data: { session: null } }),
    },
  };
  const context = {
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    alert: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ url: 'https://project.supabase.co', publishableKey: 'public-test-key' }) }),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    document: { title: 'CLAREMM Scan v17', getElementById: element },
    window: {
      location,
      history: { replaceState: () => {} },
      supabase: { createClient: () => client },
      ClaremmStore: {
        itemSyncKey: item => `${item.estilo || ''}|${item.color || ''}|${item.talla || ''}`,
        getItems: () => [],
        replaceItemsFromCloud: () => {},
        getProductImage: async () => null,
        listProductImages: async () => [],
        putImageFromCloud: async () => {},
        deleteImageFromCloud: async () => {},
        clearImagesFromCloud: async () => {},
        refreshImageIndicators: async () => {},
      },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase-sync.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'supabase-sync.js' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const initialStatus = element('cloudStatus').textContent;
  element('cloudEmail').value = 'inventario@example.com';
  element('cloudPassword').value = '123456';
  await element('cloudRegister').onclick();
  await element('cloudResend').onclick();
  return { signUpPayload, resendPayload, initialStatus };
}

(async () => {
  const { signUpPayload, resendPayload } = await captureSignUp('https://scamapp-phi.vercel.app/index.html?from=test#ignored');
  assert.equal(signUpPayload.email, 'inventario@example.com');
  assert.equal(signUpPayload.options.emailRedirectTo, 'https://scamapp-phi.vercel.app/');
  assert.equal(resendPayload.type, 'signup');
  assert.equal(resendPayload.email, 'inventario@example.com');
  assert.equal(resendPayload.options.emailRedirectTo, 'https://scamapp-phi.vercel.app/');
  const expired = await captureSignUp('https://scamapp-phi.vercel.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.match(expired.initialStatus, /enlace de confirmación venció/i);
  console.log('Supabase signup + resend redirect: OK -> ' + resendPayload.options.emailRedirectTo);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
