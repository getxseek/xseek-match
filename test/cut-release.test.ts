import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareVersions,
  cutChangelog,
  nextVersion,
  setLockVersion,
  setPackageVersion,
  setVersionTs,
} from '../scripts/cut-release';

describe('nextVersion', () => {
  it('bumps patch, minor and major', () => {
    expect(nextVersion('0.2.0', { bump: 'patch' })).toBe('0.2.1');
    expect(nextVersion('0.2.3', { bump: 'minor' })).toBe('0.3.0');
    expect(nextVersion('0.2.3', { bump: 'major' })).toBe('1.0.0');
  });

  it('starts, continues and finishes release candidates', () => {
    expect(nextVersion('0.2.0', { bump: 'minor', prerelease: true })).toBe('0.3.0-rc.1');
    expect(nextVersion('0.3.0-rc.1', { bump: 'minor', prerelease: true })).toBe('0.3.0-rc.2');
    expect(nextVersion('0.3.0-rc.2', { bump: 'major' })).toBe('0.3.0');
  });

  it('takes an explicit version, with or without v', () => {
    expect(nextVersion('0.2.0', { bump: 'patch', version: 'v0.4.0' })).toBe('0.4.0');
    expect(nextVersion('0.2.0', { bump: 'patch', version: '1.0.0-rc.1' })).toBe('1.0.0-rc.1');
  });

  it('refuses versions that are invalid or not newer', () => {
    expect(() => nextVersion('0.2.0', { bump: 'patch', version: '0.2.0' })).toThrow(/not newer/);
    expect(() => nextVersion('0.2.0', { bump: 'patch', version: '0.1.9' })).toThrow(/not newer/);
    expect(() => nextVersion('0.2.0', { bump: 'patch', version: '0.3' })).toThrow(/not a/);
    expect(() => nextVersion('0.2.0', { bump: 'patch', version: '0.3.0+1' })).toThrow(/not a/);
  });
});

describe('compareVersions', () => {
  it('follows semver precedence', () => {
    const sorted = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.0.1'];
    expect([...sorted].reverse().sort(compareVersions)).toEqual(sorted);
  });
});

const changelog = (...sections: string[]) =>
  ['# Changelog', '', 'Intro.', '', ...sections, '## 0.2.0 - 2026-11-23', '', '- Old.', ''].join(
    '\n',
  );

describe('cutChangelog', () => {
  it('renames ## Unreleased and keeps its text as is', () => {
    const text = changelog('## Unreleased', '', '### Fixed', '- A fix.', '');
    expect(cutChangelog(text, '0.2.1', '2026-12-01')).toBe(
      changelog('## 0.2.1 - 2026-12-01', '', '### Fixed', '- A fix.', ''),
    );
  });

  it('refuses an empty or missing ## Unreleased', () => {
    expect(() =>
      cutChangelog(changelog('## Unreleased', '', '### Fixed', ''), '0.2.1', 'd'),
    ).toThrow(/empty/);
    expect(() => cutChangelog(changelog(), '0.2.1', 'd')).toThrow(/no ## Unreleased/);
  });

  it('refuses a version that is already in the changelog', () => {
    const text = changelog('## Unreleased', '', '- A fix.', '');
    expect(() => cutChangelog(text, '0.2.0', 'd')).toThrow(/already/);
  });

  it('merges release candidates into the release', () => {
    const text = changelog(
      '## Unreleased',
      '',
      '### Fixed',
      '- Fix after rc.2.',
      '',
      '## 0.3.0-rc.2 - 2026-12-02',
      '',
      '### Fixed',
      '- Fix in rc.2.',
      '',
      '## 0.3.0-rc.1 - 2026-12-01',
      '',
      'Adds a thing.',
      '',
      '### Added',
      '- The thing.',
      '',
      '### Fixed',
      '- Fix in rc.1.',
      '',
    );
    expect(cutChangelog(text, '0.3.0', '2026-12-03')).toBe(
      changelog(
        '## 0.3.0 - 2026-12-03',
        '',
        'Adds a thing.',
        '',
        '### Fixed',
        '- Fix after rc.2.',
        '- Fix in rc.2.',
        '- Fix in rc.1.',
        '',
        '### Added',
        '- The thing.',
        '',
      ),
    );
  });

  it('finishes a release candidate with no changes since', () => {
    const text = changelog('## 0.3.0-rc.1 - 2026-12-01', '', '- The thing.', '');
    expect(cutChangelog(text, '0.3.0', '2026-12-03')).toBe(
      changelog('## 0.3.0 - 2026-12-03', '', '- The thing.', ''),
    );
  });

  it('leaves earlier candidates alone when cutting another candidate', () => {
    const text = changelog(
      '## Unreleased',
      '',
      '- New.',
      '',
      '## 0.3.0-rc.1 - 2026-12-01',
      '',
      '- Old.',
      '',
    );
    expect(cutChangelog(text, '0.3.0-rc.2', '2026-12-02')).toBe(
      changelog(
        '## 0.3.0-rc.2 - 2026-12-02',
        '',
        '- New.',
        '',
        '## 0.3.0-rc.1 - 2026-12-01',
        '',
        '- Old.',
        '',
      ),
    );
  });
});

describe('version files', () => {
  it('changes only the version in the real files', () => {
    const pkg = readFileSync('package.json', 'utf8');
    const lock = readFileSync('package-lock.json', 'utf8');
    const current = JSON.parse(pkg).version;
    const lines = (a: string, b: string) => {
      const x = a.split('\n');
      return b.split('\n').filter((line, i) => line !== x[i]);
    };
    expect(lines(pkg, setPackageVersion(pkg, '9.9.9'))).toEqual(['  "version": "9.9.9",']);
    expect(lines(lock, setLockVersion(lock, '9.9.9'))).toEqual([
      '  "version": "9.9.9",',
      '      "version": "9.9.9",',
    ]);
    const ts = readFileSync('src/version.ts', 'utf8');
    expect(ts).toContain(`'${current}'`);
    expect(setVersionTs(ts, '9.9.9')).toBe(ts.replace(`'${current}'`, "'9.9.9'"));
  });

  it('refuses files it cannot rewrite exactly', () => {
    expect(() => setPackageVersion('{"version": "1.0.0"}\n', '1.0.1')).toThrow(/formatted/);
    expect(() => setVersionTs('export const X = 1;\n', '1.0.1')).toThrow(/XSEEK_VERSION/);
  });
});

describe('cut-release CLI', () => {
  it('writes all four files, or none when one is wrong', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cut-release-'));
    try {
      for (const file of ['package.json', 'package-lock.json']) cpSync(file, join(dir, file));
      mkdirSync(join(dir, 'src'));
      cpSync('src/version.ts', join(dir, 'src/version.ts'));
      writeFileSync(join(dir, 'CHANGELOG.md'), changelog('## Unreleased', '', '- A fix.', ''));
      const run = (...args: string[]) =>
        execFileSync(process.execPath, [join(process.cwd(), 'scripts/cut-release.ts'), ...args], {
          cwd: dir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
      const [major, minor] = version.split('.');
      const next = `${major}.${Number(minor) + 1}.0`;

      expect(run('--bump', 'minor', '--date', '2026-12-01')).toBe(
        `version=${next}\ntag=v${next}\n`,
      );
      expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toContain(`## ${next} - 2026-12-01`);
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe(next);
      expect(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).version).toBe(next);
      expect(readFileSync(join(dir, 'src/version.ts'), 'utf8')).toContain(`'${next}'`);

      // ## Unreleased is gone now: nothing may change
      expect(() => run('--bump', 'patch')).toThrow(/no ## Unreleased/);
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe(next);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
