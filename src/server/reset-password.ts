import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { Auth } from './services/auth-service.js';

if (existsSync('.env')) process.loadEnvFile('.env');
process.umask(0o077);

async function readPasswordFromStdinOrPrompt(): Promise<string> {
  if (process.argv.includes('--password-stdin')) {
    let text = '';
    for await (const chunk of process.stdin) {
      text += chunk;
      if (Buffer.byteLength(text) > 2048) {
        throw new Error('Password input too long');
      }
    }
    return text.replace(/\r?\n$/, '');
  }

  if (!process.stdin.isTTY) {
    throw new Error('Use an interactive terminal, or explicitly pass --password-stdin.');
  }

  const silentOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const rl = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  const promptHidden = (promptText: string) =>
    new Promise<string>((resolvePrompt, rejectPrompt) => {
      process.stdout.write(promptText);
      rl.once('SIGINT', () => rejectPrompt(new Error('Cancelled')));
      rl.question('', (answer) => {
        process.stdout.write('\n');
        resolvePrompt(answer);
      });
    });

  try {
    const first = await promptHidden('New owner password (hidden): ');
    const second = await promptHidden('Confirm password (hidden): ');
    if (first !== second) throw new Error('Passwords do not match');
    return first;
  } finally {
    rl.close();
  }
}

const auth = new Auth(process.env, resolve(process.env.DATA_DIR || '.local'));
try {
  if (!auth.owner()) {
    throw new Error('No owner exists. Complete first-run setup instead.');
  }
  const password = await readPasswordFromStdinOrPrompt();
  if ([...password].length < 8 || Buffer.byteLength(password) > 1024) {
    throw new Error('Password must be at least 8 characters and at most 1024 bytes.');
  }
  await auth.resetPassword(password);
  console.log('Owner password updated. All sessions have been signed out.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Password reset failed');
  process.exitCode = 1;
} finally {
  auth.close();
}
