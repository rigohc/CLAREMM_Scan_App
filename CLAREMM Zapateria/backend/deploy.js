import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { Client } from 'ssh2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(__dirname, '.env') });

const REMOTE_HOST = process.env.DEPLOY_SSH_HOST || '67.222.129.56';
const REMOTE_PORT = Number(process.env.DEPLOY_SSH_PORT || 22);
const REMOTE_USER = process.env.DEPLOY_SSH_USER || 'ernesto';
const REMOTE_PASS = process.env.DEPLOY_SSH_PASSWORD;
const REMOTE_DIR = '/var/www/html/zapateria';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function main() {
  if (!REMOTE_PASS) {
    throw new Error('Falta DEPLOY_SSH_PASSWORD en backend/.env');
  }
  if (!GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY en backend/.env');
  }

  console.log('=== PREPARING CLAREMM PRODUCTION BUNDLE ===');

  const stagingDir = path.join(__dirname, 'staging');
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  // 1. Copy backend core files
  fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(stagingDir, 'server.js'));
  fs.copyFileSync(path.join(__dirname, 'database.js'), path.join(stagingDir, 'database.js'));

  // Copy services/
  fs.mkdirSync(path.join(stagingDir, 'services'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'services', 'geminiService.js'),
    path.join(stagingDir, 'services', 'geminiService.js')
  );

  // Copy or create server/index.js for PM2 compatibility
  fs.mkdirSync(path.join(stagingDir, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(stagingDir, 'server', 'index.js'),
    `// Entry bridge for PM2 (launches root server.js)\nimport '../server.js';\n`
  );

  // Create clean production package.json
  const pkgJson = {
    name: "claremm-zapateria",
    version: "1.0.0",
    type: "module",
    main: "server.js",
    scripts: {
      "start": "node server.js"
    },
    dependencies: {
      "cors": "^2.8.5",
      "dotenv": "^16.4.7",
      "exceljs": "^4.4.0",
      "express": "^4.21.2",
      "jimp": "^1.6.1",
      "multer": "^1.4.5-lts.1",
      "xlsx": "^0.18.5"
    }
  };
  fs.writeFileSync(path.join(stagingDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  // Create production .env file
  const envContent = [
    'PORT=3027',
    'NODE_ENV=production',
    `GEMINI_API_KEY=${GEMINI_API_KEY}`
  ].join('\n');
  fs.writeFileSync(path.join(stagingDir, '.env'), envContent);

  // Ensure data directory exists without overwriting remote database
  fs.mkdirSync(path.join(stagingDir, 'data'), { recursive: true });
  // NOTE: We deliberately do NOT copy local database.sqlite to avoid overwriting production data.
  // database.js runs automatic migrations on startup preserving all production records.

  // Ensure uploads directory exists
  fs.mkdirSync(path.join(stagingDir, 'uploads'), { recursive: true });
  const localUploads = path.join(__dirname, 'uploads');
  if (fs.existsSync(localUploads)) {
    copyDirRecursive(localUploads, path.join(stagingDir, 'uploads'));
  }

  // 2. Copy compiled frontend/dist into staging/dist
  const distSrc = path.join(rootDir, 'frontend', 'dist');
  if (!fs.existsSync(distSrc)) {
    throw new Error('frontend/dist does not exist! Please run npm run build in frontend first.');
  }

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(distSrc, path.join(stagingDir, 'dist'));
  console.log('✓ Staging files prepared successfully.');

  // 3. Create tar.gz archive
  const tarPath = path.join(__dirname, 'claremm-deploy.tar.gz');
  if (fs.existsSync(tarPath)) {
    fs.unlinkSync(tarPath);
  }

  console.log('Packaging tarball...');
  execSync(`tar -czf "${tarPath}" -C "${stagingDir}" .`);
  const stats = fs.statSync(tarPath);
  console.log(`✓ Tarball created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // 4. Connect to remote SSH
  console.log(`Connecting to SSH ${REMOTE_HOST}:${REMOTE_PORT}...`);
  const conn = new Client();

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve).on('error', reject).connect({
      host: REMOTE_HOST,
      port: REMOTE_PORT,
      username: REMOTE_USER,
      password: REMOTE_PASS,
      readyTimeout: 30000
    });
  });
  console.log('✓ SSH connection established.');

  // 5. Upload tarball via SFTP
  console.log('Uploading tarball via SFTP...');
  await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const readStream = fs.createReadStream(tarPath);
      const writeStream = sftp.createWriteStream('/home/ernesto/claremm-deploy.tar.gz');
      writeStream.on('close', () => {
        console.log('✓ SFTP Upload finished.');
        resolve();
      });
      writeStream.on('error', reject);
      readStream.pipe(writeStream);
    });
  });

  // Helper function to run remote command
  function execRemote(command) {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        let errOut = '';
        stream.on('close', (code) => {
          resolve({ code, out, errOut });
        }).on('data', d => {
          out += d.toString();
          process.stdout.write(d);
        }).stderr.on('data', d => {
          errOut += d.toString();
          process.stderr.write(d);
        });
      });
    });
  }

  // 6. Extract into /var/www/html/zapateria and install dependencies
  console.log('\n--- EXTRACTING AND INSTALLING ON SERVER ---');
  const extractCmd = `
    cd ${REMOTE_DIR} && \
    tar -xzf /home/ernesto/claremm-deploy.tar.gz && \
    npm install --omit=dev && \
    rm -f /home/ernesto/claremm-deploy.tar.gz
  `;
  await execRemote(extractCmd);

  // 7. Restart PM2 zapateria process
  console.log('\n--- RESTARTING PM2 PROCESS ---');
  await execRemote('pm2 restart zapateria');

  // Wait 3 seconds for server boot
  await new Promise(r => setTimeout(r, 3000));

  // 8. Test local server endpoint
  console.log('\n--- TESTING LOCAL NODE ENDPOINT (PORT 3027) ---');
  await execRemote('curl -I http://127.0.0.1:3027/');
  await execRemote('curl -s http://127.0.0.1:3027/api/products?limit=1');

  // 9. Test HTTPS domain
  console.log('\n--- TESTING PUBLIC HTTPS (https://claremm.likeplus.mx) ---');
  await execRemote('curl -k -I https://claremm.likeplus.mx/');

  conn.end();
  console.log('\n=== DEPLOYMENT COMPLETED SUCCESSFULLY ===');
}

main().catch(err => {
  console.error('\n❌ DEPLOYMENT FAILED:', err);
  process.exit(1);
});
