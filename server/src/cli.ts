// Outils en ligne de commande du serveur.
//   node dist/cli.js ensure-admin     crée le compte de la console s'il n'existe pas (utilisé par deploy/install.sh)
//   node dist/cli.js reset-password   change le mot de passe (si tu l'as perdu) et désactive la double authentification
import { stdin, stdout } from 'node:process';
import './config.js';
import { openDb } from './db.js';
import { createAdmin, disableTotp, hasAdmin, setPassword, validatePasswordStrength } from './auth.js';
import { seedDefaults } from './seed.js';

/** Lit une ligne au clavier sans l'afficher (étoiles à la place des caractères). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    if (!stdin.isTTY) {
      // Entrée redirigée (script) : lecture simple de la première ligne.
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
      stdin.on('error', reject);
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        value += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function askNewPassword(): Promise<string> {
  for (;;) {
    const password = await askHidden('Mot de passe de la console (10 caractères min.) : ');
    const err = validatePasswordStrength(password);
    if (err) {
      console.error(err);
      if (!stdin.isTTY) process.exit(1);
      continue;
    }
    if (!stdin.isTTY) return password;
    const confirm = await askHidden('Confirme le mot de passe : ');
    if (confirm === password) return password;
    console.error('Les deux mots de passe sont différents, recommence.');
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'ensure-admin') {
    const db = openDb();
    if (hasAdmin(db)) {
      console.log('Le compte de la console existe déjà.');
      db.close();
      return;
    }
    const password = await askNewPassword();
    createAdmin(db, password);
    seedDefaults(db);
    console.log('Compte de la console créé.');
    db.close();
    return;
  }
  if (cmd === 'reset-password') {
    const password = await askNewPassword();
    const db = openDb();
    if (hasAdmin(db)) setPassword(db, password);
    else {
      createAdmin(db, password);
      seedDefaults(db);
    }
    disableTotp(db);
    db.prepare('DELETE FROM sessions').run();
    console.log('Mot de passe réinitialisé. La double authentification a été désactivée et toutes les sessions fermées.');
    db.close();
    return;
  }
  console.log('Usage : node dist/cli.js ensure-admin | reset-password');
  process.exit(1);
}

void main();
