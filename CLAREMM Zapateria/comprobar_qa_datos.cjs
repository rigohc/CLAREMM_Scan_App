// Read-only compatibility check for servers started before /api/qa/status.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const db = new DatabaseSync(path.join(__dirname, 'backend', 'data', 'database.sqlite'), { readOnly: true });
try {
  const where = `(activo = 1 OR activo IS NULL)
    AND NULLIF(TRIM(COALESCE(corrida, '')), '') IS NOT NULL
    AND NULLIF(TRIM(COALESCE(catalogo, '')), '') IS NOT NULL
    AND NULLIF(TRIM(COALESCE(linea, '')), '') IS NOT NULL`;
  console.log(JSON.stringify({ total: db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get().n,
    latest: db.prepare(`SELECT id, estilo, color, corrida, precio, costo FROM products WHERE ${where} ORDER BY id DESC LIMIT 1`).get() || null }));
} finally { db.close(); }
