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

  const oldEnsure = 'function ensureSymlink(link, target) {';
  const safeEnsure = 'function ensureSymlink(link, target) {\n\tlet stat;\n\ttry { stat = lstatSync(link); } catch { stat = void 0; }\n\tif (stat !== void 0) {\n\t\tif (!stat.isSymbolicLink()) return;\n\t\ttry { if (readlinkSync(link) === target) return; } catch {}\n\t\ttry { unlinkSync(link); } catch { try { rmdirSync(link); } catch {} }\n\t}\n\ttry { symlinkSync(target, link, "junction"); } catch (error) {}\n}\n';

  if (content.includes(oldEnsure) && !content.includes('// safe ensureSymlink')) {
    const endIdx = content.indexOf('function healProfilesModuleFallback');
    const startIdx = content.indexOf(oldEnsure);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + '// safe ensureSymlink\n' + safeEnsure + content.slice(endIdx);
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-dsh] Applied Windows junction fix to @deepseek-ai/dsh-app-boot');
  }
}
