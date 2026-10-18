// Outils en ligne de commande du serveur.
//   node dist/cli.js ensure-admin            crée le compte administrateur s'il n'existe pas (utilisé par deploy/install.sh)
//   node dist/cli.js reset-password [login]  nouveau mot de passe (perdu) ; désactive aussi la double authentification
//   node dist/cli.js invite [note]           crée un lien d'invitation (nouveau compte avec son foyer)
//   node dist/cli.js users                   liste les comptes
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { config } from './config.js';
import {
  AuthError,
  createInvite,
  deleteUserSessions,
  disableTotp,
  findUserByLogin,
  hasAdmin,
  setPassword,
  validateLogin,
  validatePasswordStrength,
  type UserRow,
} from './auth.js';
import { createFirstAdmin, openMain } from './bootstrap.js';
import { closeAll } from './households.js';

// Entrée redirigée (script, tests) : toutes les lignes sont lues une fois, puis données
// une par une à chaque question.
let pipedLines: Promise<string[]> | null = null;
function nextPipedLine(): Promise<string> {
  pipedLines ??= new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => (data += chunk));
    stdin.on('end', () => resolve(data.split(/\r?\n/)));
    stdin.on('error', reject);
  });
  return pipedLines.then((lines) => lines.shift() ?? '');
}

/** Lit une ligne au clavier sans l'afficher (étoiles à la place des caractères). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    if (!stdin.isTTY) {
      nextPipedLine().then((l) => {
        stdout.write('\n');
        resolve(l);
      }, reject);
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

/** Lit une ligne visible (identifiant). */
function ask(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question);
    return nextPipedLine().then((l) => (stdout.write('\n'), l.trim()));
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askNewPassword(label = 'Mot de passe'): Promise<string> {
  for (;;) {
    const password = await askHidden(`${label} (10 caractères min.) : `);
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

async function askLogin(): Promise<string> {
  for (;;) {
    const login = await ask('Identifiant de connexion (ton e-mail, par exemple) : ');
    const err = validateLogin(login);
    if (!err) return login;
    console.error(err);
    if (!stdin.isTTY) process.exit(1);
  }
}

async function main() {
  const cmd = process.argv[2];
  const db = openMain();
  try {
    if (cmd === 'ensure-admin') {
      if (hasAdmin(db)) {
        const admin = db.prepare("SELECT login FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { login: string };
        console.log(`Le compte administrateur existe déjà (identifiant : ${admin.login}).`);
        return;
      }
      console.log('Création du compte administrateur de la console.');
      const login = await askLogin();
      const password = await askNewPassword();
      const user = createFirstAdmin(db, login, password);
      console.log(`Compte administrateur « ${user.login} » créé, avec ton foyer.`);
      return;
    }
    if (cmd === 'reset-password') {
      let login = process.argv[3];
      let user: UserRow | undefined;
      if (!login) {
        const admins = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id").all() as UserRow[];
        if (admins.length === 1) user = admins[0];
        else login = await ask('Identifiant du compte : ');
      }
      if (!user) user = findUserByLogin(db, login ?? '');
      if (!user) {
        if (!hasAdmin(db)) {
          console.log('Aucun compte administrateur : création.');
          const newLogin = await askLogin();
          const password = await askNewPassword();
          createFirstAdmin(db, newLogin, password);
          console.log('Compte administrateur créé.');
          return;
        }
        console.error(`Compte « ${login} » introuvable.`);
        process.exitCode = 1;
        return;
      }
      console.log(`Nouveau mot de passe pour « ${user.login} ».`);
      const password = await askNewPassword();
      setPassword(db, user.id, password);
      disableTotp(db, user.id);
      deleteUserSessions(db, user.id);
      db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(user.id);
      console.log('Mot de passe réinitialisé. La double authentification de ce compte a été désactivée et ses sessions fermées.');
      return;
    }
    if (cmd === 'invite') {
      const inv = createInvite(db, { kind: 'invite', createdBy: null, note: process.argv.slice(3).join(' '), days: 7 });
      console.log(`Lien d'invitation (valable 7 jours, usage unique) :\n${config.publicUrl}/invitation/${inv.token}`);
      return;
    }
    if (cmd === 'users') {
      const rows = db
        .prepare('SELECT u.login, u.role, u.disabled, h.name AS household FROM users u JOIN households h ON h.id = u.household_id ORDER BY u.id')
        .all() as { login: string; role: string; disabled: number; household: string }[];
      if (!rows.length) console.log('Aucun compte.');
      for (const r of rows) console.log(`${r.login}\t${r.role === 'admin' ? 'administrateur' : 'utilisateur'}${r.disabled ? ' (désactivé)' : ''}\t${r.household}`);
      return;
    }
    console.log('Usage : node dist/cli.js ensure-admin | reset-password [identifiant] | invite [note] | users');
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    closeAll();
  }
}

void main();
