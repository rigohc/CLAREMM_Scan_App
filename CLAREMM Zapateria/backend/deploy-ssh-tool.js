import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

export function runRemoteCommand(cmd) {
  const password = process.env.DEPLOY_SSH_PASSWORD;
  if (!password) {
    return Promise.reject(new Error('Falta DEPLOY_SSH_PASSWORD en backend/.env'));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        stream.on('close', (code, signal) => {
          conn.end();
          resolve({ code, stdout, stderr });
        }).on('data', (d) => {
          stdout += d.toString();
        }).stderr.on('data', (d) => {
          stderr += d.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect({
      host: process.env.DEPLOY_SSH_HOST || '67.222.129.56',
      port: Number(process.env.DEPLOY_SSH_PORT || 22),
      username: process.env.DEPLOY_SSH_USER || 'ernesto',
      password,
      readyTimeout: 30000
    });
  });
}

// If run directly
if (process.argv[2]) {
  const command = process.argv.slice(2).join(' ');
  runRemoteCommand(command)
    .then(({ code, stdout, stderr }) => {
      console.log('--- STDOUT ---');
      console.log(stdout);
      if (stderr) {
        console.error('--- STDERR ---');
        console.error(stderr);
      }
      process.exit(code || 0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
