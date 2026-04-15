import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_DIR = path.resolve(process.cwd(), 'docs');
const TARGET_EXTENSIONS = new Set(['.md', '.mdx']);
const FONT_TAG_REGEX = /<\/?font\b[^>]*>/gi;

async function walkDir(dirPath, files = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, files);
      continue;
    }
    if (TARGET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripFontTags(content) {
  return content.replace(FONT_TAG_REGEX, '');
}

async function processFile(filePath, dryRun) {
  const raw = await fs.readFile(filePath, 'utf8');
  const cleaned = stripFontTags(raw);
  if (cleaned === raw) {
    return false;
  }

  if (!dryRun) {
    await fs.writeFile(filePath, cleaned, 'utf8');
  }
  return true;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const targetDirArg = process.argv.find((arg) => arg.startsWith('--dir='));
  const targetDir = targetDirArg
    ? path.resolve(process.cwd(), targetDirArg.slice('--dir='.length))
    : DOCS_DIR;

  const files = await walkDir(targetDir);
  let changedCount = 0;

  for (const filePath of files) {
    const changed = await processFile(filePath, dryRun);
    if (changed) {
      changedCount += 1;
      const relativePath = path.relative(process.cwd(), filePath);
      console.log(`${dryRun ? '[dry-run] would update' : 'updated'}: ${relativePath}`);
    }
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}done. processed ${files.length} files, changed ${changedCount} files.`
  );
}

main().catch((error) => {
  console.error('remove-font-tags failed:', error);
  process.exitCode = 1;
});
