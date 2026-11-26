// Prepares a release in the working tree: renames CHANGELOG.md's `## Unreleased`
// to `## X.Y.Z - YYYY-MM-DD` and sets the version in package.json,
// package-lock.json and src/version.ts. The Cut release workflow commits, tags
// and pushes the result; see docs/RELEASING.md.
//
//   node scripts/cut-release.ts --bump patch|minor|major [--version X.Y.Z] [--prerelease] [--date YYYY-MM-DD]
//
// No dependencies, so it runs without npm ci. Prints version= and tag= lines.
// Tested in test/cut-release.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type Bump = 'patch' | 'minor' | 'major';

interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

// Semver without +build metadata: image tags cannot contain +
const IDENT = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(
  `^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENT}(?:\\.${IDENT})*))?$`,
);

export function parseVersion(version: string): Version | null {
  const m = SEMVER.exec(version);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

function mustParse(version: string): Version {
  const v = parseVersion(version);
  if (!v) throw new Error(`${version} is not a MAJOR.MINOR.PATCH[-PRERELEASE] version`);
  return v;
}

/** Semver precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const x = mustParse(a);
  const y = mustParse(b);
  const core = x.major - y.major || x.minor - y.minor || x.patch - y.patch;
  if (core) return core;
  // A release sorts above its pre-releases
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The version to release after `current`. An explicit `version` wins. After a
 * release candidate, `bump` is ignored: the next one is the following
 * candidate, or the release itself.
 */
export function nextVersion(
  current: string,
  {
    bump,
    version = '',
    prerelease = false,
  }: { bump: Bump; version?: string; prerelease?: boolean },
): string {
  const c = mustParse(current);
  let next: string;
  if (version) {
    next = version.replace(/^v/, '');
    mustParse(next);
  } else if (c.pre.length) {
    const base = `${c.major}.${c.minor}.${c.patch}`;
    const n = c.pre[0] === 'rc' && /^\d+$/.test(c.pre[1] ?? '') ? Number(c.pre[1]) + 1 : 1;
    next = prerelease ? `${base}-rc.${n}` : base;
  } else {
    const core =
      bump === 'major'
        ? `${c.major + 1}.0.0`
        : bump === 'minor'
          ? `${c.major}.${c.minor + 1}.0`
          : `${c.major}.${c.minor}.${c.patch + 1}`;
    next = prerelease ? `${core}-rc.1` : core;
  }
  if (compareVersions(next, current) <= 0) {
    throw new Error(`${next} is not newer than the current version, ${current}`);
  }
  return next;
}

interface Section {
  heading: string;
  body: string[];
}

function splitSections(lines: string[], level: string): { intro: string[]; sections: Section[] } {
  const intro: string[] = [];
  const sections: Section[] = [];
  for (const line of lines) {
    if (line.startsWith(level)) sections.push({ heading: line, body: [] });
    else (sections.at(-1)?.body ?? intro).push(line);
  }
  return { intro, sections };
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start++;
  while (end > start && !lines[end - 1]!.trim()) end--;
  return lines.slice(start, end);
}

// Anything besides blank lines and ### headings
const hasEntries = (body: string[]) => body.some((l) => l.trim() && !l.startsWith('#'));

// Several version sections in one, newest first: intros, then each ### group
// with its entries from every section
function mergeBodies(bodies: string[][]): string[] {
  const intros: string[][] = [];
  const groups = new Map<string, string[]>();
  for (const body of bodies) {
    const { intro, sections } = splitSections(body, '### ');
    if (hasEntries(intro)) intros.push(trimBlank(intro));
    for (const { heading, body: entries } of sections) {
      const kept = trimBlank(entries);
      if (!kept.length) continue;
      groups.set(heading, [...(groups.get(heading) ?? []), ...kept]);
    }
  }
  const out: string[] = [''];
  for (const intro of intros) out.push(...intro, '');
  for (const [heading, entries] of groups) out.push(heading, ...entries, '');
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns `## Unreleased` into the section for `version`. A release also takes
 * in its release candidates' sections, so its notes cover everything since
 * the previous release.
 */
export function cutChangelog(text: string, version: string, date: string): string {
  const { intro, sections } = splitSections(text.split('\n'), '## ');
  const sectionOf = (v: string) => new RegExp(`^## ${escape(v)}( |$)`);
  if (sections.some((s) => sectionOf(version).test(s.heading))) {
    throw new Error(`CHANGELOG.md already has a ## ${version} section`);
  }
  const isUnreleased = (s: Section) => /^## Unreleased\s*$/i.test(s.heading);
  const isCandidate = (s: Section) =>
    !parseVersion(version)!.pre.length && new RegExp(`^## ${escape(version)}-\\S`).test(s.heading);
  const taken = sections.filter((s) => isUnreleased(s) || isCandidate(s));
  if (!taken.length) throw new Error('CHANGELOG.md has no ## Unreleased section');
  if (!taken.some((s) => hasEntries(s.body))) {
    throw new Error('## Unreleased in CHANGELOG.md is empty: add the changes first');
  }
  const body = taken.length === 1 ? taken[0]!.body : mergeBodies(taken.map((s) => s.body));
  const merged = { heading: `## ${version} - ${date}`, body };
  const at = sections.indexOf(taken[0]!);
  const kept = sections.filter((s) => !taken.includes(s));
  kept.splice(at, 0, merged);
  return [...intro, ...kept.flatMap((s) => [s.heading, ...s.body])].join('\n');
}

function setJsonVersion(text: string, file: string, version: string): string {
  const data = JSON.parse(text);
  const format = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  // Rewriting the file must change nothing but the version
  if (format(data) !== text) throw new Error(`${file} is not formatted as npm writes it`);
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
  return format(data);
}

export function setPackageVersion(text: string, version: string): string {
  return setJsonVersion(text, 'package.json', version);
}

export function setLockVersion(text: string, version: string): string {
  if (!JSON.parse(text).packages?.['']) throw new Error('package-lock.json has no root package');
  return setJsonVersion(text, 'package-lock.json', version);
}

export function setVersionTs(text: string, version: string): string {
  const re = /XSEEK_VERSION = '[^']*'/g;
  if (text.match(re)?.length !== 1) throw new Error('src/version.ts has no single XSEEK_VERSION');
  return text.replace(re, `XSEEK_VERSION = '${version}'`);
}

function main() {
  const { values } = parseArgs({
    options: {
      bump: { type: 'string', default: 'patch' },
      version: { type: 'string', default: '' },
      prerelease: { type: 'boolean', default: false },
      date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    },
  });
  const bump = values.bump as Bump;
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error(`unknown bump: ${bump}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error(`bad date: ${values.date}`);

  const read = (file: string) => readFileSync(file, 'utf8');
  const pkg = read('package.json');
  const current: string = JSON.parse(pkg).version;
  const version = nextVersion(current, {
    bump,
    version: values.version,
    prerelease: values.prerelease,
  });
  const files: Record<string, string> = {
    'CHANGELOG.md': cutChangelog(read('CHANGELOG.md'), version, values.date),
    'package.json': setPackageVersion(pkg, version),
    'package-lock.json': setLockVersion(read('package-lock.json'), version),
    'src/version.ts': setVersionTs(read('src/version.ts'), version),
  };
  // Every file checked before any is written
  for (const [file, text] of Object.entries(files)) writeFileSync(file, text);
  console.log(`version=${version}\ntag=v${version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${(error as Error).message}`);
    process.exit(1);
  }
}
