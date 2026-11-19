"""Repack downloaded aerial tiles (aerial_raw/z_x_y.jpg) into JPEG sprite sheets.
Group per zoom for z<=14 ('z13'), per z14 ancestor and zoom for z>=15 ('14_8440_5396_z17'). Each sprite is a grid of 256 px tiles
starting at (x0, y0). aerial_sprites.json: {groups: {name: [z, x0, y0, cols, rows]}, tiles: [keys]}."""
import glob, json, os, re
from PIL import Image

tiles = {}
for f in glob.glob('aerial_raw/*.jpg'):
    z, x, y = map(int, re.findall(r'(\d+)_(\d+)_(\d+)\.jpg', f)[0]); tiles[(z, x, y)] = f
groups = {}
for (z, x, y) in tiles:
    name = f'z{z}' if z <= 14 else f'14_{x >> (z - 14)}_{y >> (z - 14)}_z{z}'
    groups.setdefault(name, []).append((z, x, y))
os.makedirs('aerial_sprites', exist_ok=True)
meta, total = {}, 0
for name, ks in groups.items():
    z = ks[0][0]
    if z <= 14:
        x0, y0 = min(k[1] for k in ks), min(k[2] for k in ks); cols, rows = max(k[1] for k in ks) - x0 + 1, max(k[2] for k in ks) - y0 + 1
    else:
        n = 1 << (z - 14); px, py = ks[0][1] >> (z - 14), ks[0][2] >> (z - 14); x0, y0, cols, rows = px * n, py * n, n, n
    im = Image.new('RGB', (cols * 256, rows * 256), (200, 205, 195))
    for (_, x, y) in ks: im.paste(Image.open(tiles[(z, x, y)]), ((x - x0) * 256, (y - y0) * 256))
    path = f'aerial_sprites/{name}.jpg'; im.save(path, 'JPEG', quality=62, optimize=True, progressive=True)
    meta[name] = [z, x0, y0, cols, rows]; total += os.path.getsize(path)
json.dump({'groups': meta, 'tiles': sorted(f'{z}/{x}/{y}' for z, x, y in tiles)}, open('aerial_sprites.json', 'w'), separators=(',', ':'))
print('sprites', len(meta), 'bytes', total, 'max', max(os.path.getsize(f'aerial_sprites/{n}.jpg') for n in meta), 'largest px', max(m[3] * m[4] for m in meta.values()) * 65536)
