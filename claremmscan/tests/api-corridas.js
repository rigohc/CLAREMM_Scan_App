'use strict';

const assert = require('node:assert/strict');
const api = require('../api/v1.js');

const organizationId = 'a9017238-d45c-4e36-b4f0-17dc332aeb4c';
const corridaId = '11111111-1111-4111-8111-111111111111';
const org = { organization: { id: organizationId, name: 'CLAREMM' }, branches: [] };
const session = { userId: '22222222-2222-4222-8222-222222222222' };

function fakeDb() {
  const corridas = [];
  const fuentes = [];
  const relaciones = [];
  const events = [];
  return {
    corridas,
    fuentes,
    relaciones,
    events,
    async allRows(resource) { return this.rest(resource); },
    async rest(resource, options = {}) {
      const [table, query = ''] = resource.split('?');
      const method = options.method || 'GET';
      if (table === 'corridas') {
        if (method === 'POST') {
          const same = corridas.find(row => row.linea === options.body.linea
            && Number(row.talla_inicial) === Number(options.body.talla_inicial)
            && Number(row.talla_final) === Number(options.body.talla_final)
            && Number(row.incremento) === Number(options.body.incremento));
          if (same) Object.assign(same, options.body);
          else corridas.push({ id: corridaId, ...options.body, created_at: '2026-11-27', updated_at: '2026-11-27' });
          return [same || corridas.at(-1)];
        }
        const id = query.match(/(?:^|&)id=eq\.([^&]+)/)?.[1];
        const ids = query.match(/(?:^|&)id=in\.\(([^)]*)\)/)?.[1]?.split(',') || [];
        const line = decodeURIComponent(query.match(/(?:^|&)linea=eq\.([^&]+)/)?.[1] || '');
        return corridas.filter(row => (!id || row.id === id) && (!ids.length || ids.includes(row.id)) && (!line || row.linea === line));
      }
      if (table === 'corrida_fuentes') {
        if (method === 'POST') { fuentes.push(options.body); return []; }
        const ids = query.match(/corrida_id=in\.\(([^)]*)\)/)?.[1]?.split(',') || [];
        return fuentes.filter(row => !ids.length || ids.includes(row.corrida_id));
      }
      if (table === 'estilo_corridas') {
        if (method === 'POST') { relaciones.push(options.body); return []; }
        const style = decodeURIComponent(query.match(/estilo_key=eq\.([^&]+)/)?.[1] || '');
        return relaciones.filter(row => !style || row.estilo_key === style);
      }
      if (table === 'corrida_events') { events.push(options.body); return []; }
      return [];
    },
  };
}

(async () => {
  const db = fakeDb();
  const invalid = await api.handleCreateCorrida(db, session, org, {
    linea: 'NIÑAS', inicial: 15, final: 17.8, incremento: 0.5, motivo: 'captura SAZ',
  }).then(() => null).catch(error => error);
  assert.equal(invalid?.status, 400);
  assert.equal(invalid?.public?.error?.code, 'corrida_invalid');

  const created = await api.handleCreateCorrida(db, session, org, {
    linea: 'niñas', inicial: 15, final: 17.5, incremento: 0.5,
    saz_id: 9, motivo: 'captura confirmada por negocio',
  });
  assert.equal(created.evento, 'SizeRunDefined');
  assert.equal(created.corrida.linea, 'NIÑAS');
  assert.equal(db.fuentes[0].external_id, '9');
  assert.equal(db.events[0].event_type, 'SizeRunDefined');

  const assigned = await api.handleAssignCorrida(db, session, org, 'COS901', {
    corrida_id: corridaId, orden: 1, motivo: 'corrida baja de COS901',
  });
  assert.equal(assigned.evento, 'StyleSizeRunAssigned');
  assert.equal(db.relaciones[0].estilo_key, 'COS901');
  assert.equal(db.events[1].event_type, 'StyleSizeRunAssigned');

  const listed = await api.handleCorridas(db, org, { estilo: 'cos-901' });
  assert.equal(listed.estilo, 'COS901');
  assert.equal(listed.corridas.length, 1);
  assert.equal(listed.corridas[0].fuentes[0].external_id, '9');

  console.log('api-corridas: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
