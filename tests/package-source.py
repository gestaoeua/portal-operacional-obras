"""Local source overlay only. No dependencies, credentials, Git objects or build output."""
import os, zipfile, pathlib, hashlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
name = sys.argv[1] if len(sys.argv) > 1 else 'rsf-local-checkpoint-20261021-0752.zip'
exclude_kapso = '--exclude-kapso' in sys.argv[2:]
if pathlib.Path(name).name != name or not name.endswith('.zip'):
    raise SystemExit('Use a plain zip filename inside delivery.')
target = root.parent / 'delivery' / name
target.parent.mkdir(exist_ok=True)
if target.exists():
    raise SystemExit('Existing package preserved; choose a new output name.')
allowed = {'.ts','.tsx','.css','.html','.md','.cjs','.mjs','.json','.gs','.jpeg','.jpg','.png','.svg','.yaml','.toml','.py'}
dirs = ['src','tests','integration','apps-script','docs','central','demo-os-cronograma','public']
files = [root/name for name in ['package.json','pnpm-lock.yaml','tsconfig.json','vite.config.ts','vitest.config.ts','index.html','README.md'] if (root/name).is_file()]
for part in dirs:
    if not (root/part).exists(): continue
    for folder, subdirs, names in os.walk(root/part):
        subdirs[:] = [d for d in subdirs if d not in {'node_modules','.git','.wrangler','dist','.cache'}]
        for name in names:
            p=pathlib.Path(folder)/name
            if exclude_kapso and ('integration/kapso/' in p.relative_to(root).as_posix() or name.startswith('kapso-')):
                continue
            if p.suffix in allowed and not name.startswith(('.env','.dev.vars')):
                files.append(p)
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(set(files)):
        archive.write(p,p.relative_to(root).as_posix())
print(str(target))
print('Files:',len(set(files)))
print('SHA256:',hashlib.sha256(target.read_bytes()).hexdigest())
