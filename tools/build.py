"""Assemble index.html: original <head> styles + inline assets, then the source files in src/."""
import json, re

L = open('original.html', encoding='utf-8').read().split('\n')
src = lambda p: open(p, encoding='utf-8').read()


def must(s, old, new):
    assert s.count(old) == 1, (old[:80], s.count(old))
    return s.replace(old, new)


head = '\n'.join(L[:53])  # doctype, meta, original CSS (lines 1-53)

# inline assets: world outline + positron style + the Nijkerk sample bundle (the old OSM sample and city list are gone)
a = L[53]
i = a.index('window.__assets=') + len('window.__assets=')
assets, end = json.JSONDecoder().raw_decode(a[i:])
assets.pop('sample', None); assets.pop('cities', None)
assets['nijkerk'] = {k: v for k, v in json.load(open('nijkerk_sample.json')).items() if k not in ('model', 'parcels')}
assets['nijkerkTiles'] = json.load(open('data_index.json'))
assets['aerialSprites'] = json.load(open('aerial_sprites.json'))
assets_line = a[:i] + json.dumps(assets, separators=(',', ':'), ensure_ascii=False).replace('</', '<\\/') + a[i + end:]

CSS = src('src/extra.css')
body = src('src/body.html')
body = must(body, "Synthetic site · Untextured block geometry · Illustrative model", "Nijkerk · 3DBAG LoD1.3 + BGT · 100 × 100 m design window")

editor = src('src/editor.js')
editor = must(editor, "worldMap:'World map'", "worldMap:'Site map'")
editor = must(editor, "prototype:'Hoevelaken · Grid approximation · Default materials'", "prototype:'Nijkerk · 3DBAG LoD1.3 + BGT context · 100 × 100 m design window'")
editor = must(editor, "function applyMask(d){const[lon0", "function applyMask(d){if(d.rd){NSContext.mask(d,model);G.syncGround(model);return}const[lon0")

# The old Hoevelaken SITE_DATA / LANDSCAPE_DATA are replaced by empty containers that NSContext fills per site.
site_data = "const SITE_DATA={context:[],buildings:[],trees:[],parcels:[],origin:[0,0],crs:'EPSG:28992'};"
landscape_data = "const LANDSCAPE_DATA={source:'none',crs:'EPSG:28992',bbox:[0,0,0,0],ground:[],trees:[]};"

S = lambda code: '<script>' + code + '\n</script>'
out = (head + '\n</style><style>' + CSS + assets_line + '\n' + body
       + S(site_data) + S(src('src/gridmodel.js')) + S(landscape_data) + S(src('src/landscape.js'))
       + S(src('src/geo.js') + '\n' + src('src/data.js') + '\n' + src('src/context.js'))
       + S(src('src/scene.js')) + S(editor) + S(src('src/direct.js')) + S(src('src/maplibre.js')) + S(src('src/picker.js'))
       + '</body></html>\n')
open('index.html', 'w', encoding='utf-8').write(out)
# dist/: what gets published (page + data tiles + aerial packs)
import shutil, os, glob
os.makedirs('dist/data', exist_ok=True); os.makedirs('dist/aerial', exist_ok=True)
shutil.copy('index.html', 'dist/index.html')
for f in glob.glob('data/*.json'): shutil.copy(f, 'dist/data/')
shutil.rmtree('dist/aerial', ignore_errors=True); os.makedirs('dist/aerial')
for f in glob.glob('aerial_sprites/*.jpg'): shutil.copy(f, 'dist/aerial/')
cjk = re.findall(r'[　-鿿＀-￯]', out)
print('index.html', len(out.encode()), 'bytes · CJK characters:', len(cjk))
