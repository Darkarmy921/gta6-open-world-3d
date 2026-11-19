// Cayo Azul — entry program.
//
// Copies this repository's own game/ and screenshots/ folders into the
// output folder and writes dossier.json there with the kit's
// buildDossier function. Node standard library only; no network;
// the same input always produces the same output bytes.
//
// Usage:  MAKEFUN_OUTPUT_DIR=/some/dir node main.ts
// With the variable unset the output folder is /output.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

if (outputDir === repoRoot) {
  throw new Error('entry program: MAKEFUN_OUTPUT_DIR must not be the repository root');
}

// The caps from the bounty gate, passed exactly as the kit's own example
// call passes them. buildDossier(dir, caps) returns the dossier
// (makefun/dossier/v1) as canonical JSON bytes; it reads dir/game/ and
// dir/screenshots/ from the output folder, so the copy happens first.
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function copyTree(name: string): void {
  const source = join(repoRoot, name);
  const target = join(outputDir, name);
  if (!existsSync(source)) {
    throw new Error(`entry program: ${name}/ is missing from the repository`);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

function checkInputs(): void {
  const index = join(repoRoot, 'game', 'index.html');
  if (!existsSync(index)) {
    throw new Error('entry program: game/index.html is missing from the repository');
  }
  const shots = readdirSync(join(repoRoot, 'screenshots')).filter((n) => !n.startsWith('.'));
  if (shots.length < 3 || shots.length > 4) {
    throw new Error(`entry program: screenshots/ holds ${shots.length} images, expected 3 or 4`);
  }
}

checkInputs();
mkdirSync(outputDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outputDir, caps);
const dossierPath = join(outputDir, 'dossier.json');
rmSync(dossierPath, { force: true });
writeFileSync(dossierPath, dossier);

console.log(`cayo-azul: wrote ${dossierPath} (${dossier.length} bytes)`);
