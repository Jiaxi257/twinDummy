"""Download PDOK aerial tiles (Actueel_ortho25, Web Mercator) for the bundle and re-encode them smaller."""
import json, math, os, io, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import sys; sys.path.insert(0, '.')
URL = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg'
B = json.load(open('nijkerk_sample.json'))

def tile(lon, lat, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)

def coords(g):
    for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
        for c in p[0]: yield c

def rd2wgs(x, y):  # same polynomial as src/geo.js
    dx, dy = (x - 155000) * 1e-5, (y - 463000) * 1e-5
    K = [[0,1,3235.65389],[2,0,-32.58297],[0,2,-0.2475],[2,1,-0.84978],[0,3,-0.0665],[2,2,-0.01709],[1,0,-0.00738],[4,0,0.0053],[2,3,-3.9e-4],[4,1,3.3e-4],[1,1,-1.2e-4]]
    L = [[1,0,5260.52916],[1,1,105.94684],[1,2,2.45656],[3,0,-0.81885],[1,3,0.05594],[3,1,-0.05607],[0,1,0.01199],[3,2,-0.00256],[1,4,0.00128],[0,2,2.2e-4],[2,0,-2.2e-4],[5,0,2.6e-4]]
    p = sum(c * dx ** a * dy ** b for a, b, c in K); l = sum(c * dx ** a * dy ** b for a, b, c in L)
    return 5.38720621 + l / 3600, 52.15517440 + p / 3600

gc = list(coords(B['gemeente']['geometry']))
gbox = [min(c[0] for c in gc), min(c[1] for c in gc), max(c[0] for c in gc), max(c[1] for c in gc)]
e = B['extent']; m = 300
sw, ne = rd2wgs(e[0] - m, e[1] - m), rd2wgs(e[2] + m, e[3] + m)
sbox = [sw[0], sw[1], ne[0], ne[1]]
jobs = []
for z in range(9, 18):
    box = gbox if z <= 13 else sbox
    x0, y0 = tile(box[0], box[3], z); x1, y1 = tile(box[2], box[1], z)
    jobs += [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
def bbg(g):
    cs = list(coords(g)); return [min(c[0] for c in cs), min(c[1] for c in cs), max(c[0] for c in cs), max(c[1] for c in cs)]
def tiles(box, z):
    x0, y0 = tile(box[0], box[3], z); x1, y1 = tile(box[2], box[1], z)
    return [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
RURAL = {'Arkemheen', 'De Veenhuis/Achterhoek', "Appel/'t Woud", 'Slichtenhorst', 'Kruishaar', 'Groot binnenwater', 'Prinsenkamp', 'Holkerveen', 'Hoevelaken-Kleinhoven', 'Industriegebied'}
jobs += tiles(gbox, 14)
for b in B['buurten']:
    if b['name'] not in RURAL: jobs += tiles(bbg(b['geometry']), 15)
jobs = sorted(set(jobs))
print('tiles', len(jobs), {z: sum(1 for j in jobs if j[0] == z) for z in range(9, 18)})

def get(j):
    z, x, y = j; path = f'aerial/{z}/{x}/{y}.jpg'
    if os.path.exists(path): return path, os.path.getsize(path)
    raw = urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60).read()
    im = Image.open(io.BytesIO(raw)).convert('RGB'); os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'JPEG', quality=62, optimize=True, progressive=True)
    return path, os.path.getsize(path)

with ThreadPoolExecutor(8) as ex:
    res = list(ex.map(get, jobs))
print('bytes', sum(s for _, s in res))
json.dump(sorted(f'{z}/{x}/{y}' for z, x, y in jobs), open('aerial_index.json', 'w'))
