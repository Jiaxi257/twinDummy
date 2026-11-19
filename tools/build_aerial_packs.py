"""Aerial tiles (PDOK Actueel_ortho25) for the bundle, packed into few files.
z9-14: whole municipality; z15-17: built-up neighbourhoods. Tiles at z<=14 go in aerial/low.bin, tiles at z>=15 in the
pack of their z14 ancestor (aerial/14_<x>_<y>.bin). Pack format: uint32 header length, JSON header {key:[offset,length]}, JPEG bytes."""
import json, math, os, io, struct, urllib.request, time
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

URL = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg'
B = json.load(open('nijkerk_sample.json'))
RURAL = {'Arkemheen', 'De Veenhuis/Achterhoek', "Appel/'t Woud", 'Slichtenhorst', 'Kruishaar', 'Groot binnenwater', 'Prinsenkamp', 'Holkerveen', 'Hoevelaken-Kleinhoven', 'Industriegebied'}


def tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def bbg(g):
    cs = [c for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]) for c in p[0]]
    return [min(c[0] for c in cs), min(c[1] for c in cs), max(c[0] for c in cs), max(c[1] for c in cs)]


def tiles(box, z):
    x0, y0 = tile(box[0], box[3], z); x1, y1 = tile(box[2], box[1], z)
    return {(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


keys = {tuple(map(int, k.split('/'))) for k in json.load(open('aerial_index.json'))}  # what we already have (z9-17)
for b in B['buurten']:
    if b['name'] in RURAL: continue
    for z in (16, 17): keys |= tiles(bbg(b['geometry']), z)
print('tiles', len(keys), {z: sum(1 for k in keys if k[0] == z) for z in range(9, 18)}, flush=True)
os.makedirs('aerial_raw', exist_ok=True)


def get(k):
    z, x, y = k; path = f'aerial_raw/{z}_{x}_{y}.jpg'
    old = f'aerial/{z}/{x}/{y}.jpg'
    if os.path.exists(path): return k, path
    if os.path.exists(old): os.link(old, path); return k, path
    for t in range(5):
        try: raw = urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60).read(); break
        except Exception:
            if t == 4: return k, None
            time.sleep(2 * (t + 1))
    Image.open(io.BytesIO(raw)).convert('RGB').save(path, 'JPEG', quality=60, optimize=True, progressive=True)
    return k, path


with ThreadPoolExecutor(5) as ex:
    got = [r for r in ex.map(get, sorted(keys)) if r[1]]
packs = {}
for (z, x, y), path in got:
    name = 'low' if z <= 14 else f'14_{x >> (z - 14)}_{y >> (z - 14)}'
    packs.setdefault(name, []).append((f'{z}/{x}/{y}', path))
os.makedirs('aerial_packs', exist_ok=True)
total = 0
for name, items in packs.items():
    head, blobs, off = {}, [], 0
    for key, path in items:
        b = open(path, 'rb').read(); head[key] = [off, len(b)]; blobs.append(b); off += len(b)
    h = json.dumps(head, separators=(',', ':')).encode()
    data = struct.pack('<I', len(h)) + h + b''.join(blobs)
    open(f'aerial_packs/{name}.bin', 'wb').write(data); total += len(data)
json.dump(sorted(k for items in packs.values() for k, _ in items), open('aerial_index.json', 'w'))
print('packs', len(packs), 'bytes', total, 'max', max(os.path.getsize(f'aerial_packs/{n}.bin') for n in packs), flush=True)
