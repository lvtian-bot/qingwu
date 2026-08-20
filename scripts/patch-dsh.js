import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetFile = join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js');

if (existsSync(targetFile)) {
  let content = readFileSync(targetFile, 'utf8');
  let modified = false;

  if (content.includes('import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync }')) {
    content = content.replace(
      'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync }',
      'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync }'
    );
    modified = true;
  }

  if (content.includes('		unlinkSync(link);')) {
    content = content.replace('		unlinkSync(link);', '		try { unlinkSync(link); } catch { rmdirSync(link); }');
    modified = true;
  }

  if (modified) {
    writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-dsh] Applied Windows junction fix to @deepseek-ai/dsh-app-boot');
  }
}
