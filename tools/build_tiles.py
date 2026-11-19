"""Fetch 3DBAG + BGT + BGT trees + BRK parcels for all of Nijkerk into 1 km RD data tiles (data/<tx>_<ty>.json).
Features are assigned to the tile containing their centroid, so each appears once. Resumable: finished tiles are skipped."""
import json, os, time, sys, urllib.request, urllib.parse, datetime, threading
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape, box, Polygon
from shapely.validation import make_valid

RD = 'http://www.opengis.net/def/crs/EPSG/0/28992'
CBS = 'https://api.pdok.nl/cbs/wijken-en-buurten-2026/ogc/v1/collections'
BRK = 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items'
BGT = 'https://api.pdok.nl/lv/bgt/ogc/v1/collections'
BAG3D = 'https://api.3dbag.nl/collections/pand/items'
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
T = 1000
KINDS = ['road', 'green', 'hedge', 'water']
COLLS = ['wegdeel', 'ondersteunendwegdeel', 'waterdeel', 'ondersteunendwaterdeel', 'begroeidterreindeel', 'vegetatieobject_punt']
os.makedirs('data', exist_ok=True)
lock = threading.Lock()


def get(url, params=None, tries=6):
    if params: url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return json.load(r)
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(2 * (k + 1))


def paged(url, params):
    out, d = [], get(url, params)
    while True:
        out += d.get('features', [])
        nxt = [l['href'] for l in d.get('links', []) if l['rel'] == 'next']
        if not nxt: return out
        d = get(nxt[0])


def kind_of(c, p):
    if c == 'wegdeel': return 'road'
    if c == 'ondersteunendwegdeel': return 'green' if p.get('fysiek_voorkomen') == 'groenvoorziening' else 'road'
    if c == 'waterdeel': return 'water'
    if c == 'ondersteunendwaterdeel': return 'green'
    return 'hedge' if p.get('plus_fysiek_voorkomen') in ('heesters', 'bosplantsoen') else 'green'


def tile_job(tx, ty):
    path = f'data/{tx}_{ty}.json'
    if os.path.exists(path): return path, 'cached'
    x0, y0 = tx * T, ty * T
    bbox = f'{x0},{y0},{x0 + T},{y0 + T}'
    inside = lambda x, y: x0 <= x < x0 + T and y0 <= y < y0 + T
    q = lambda x, y: [round((x - x0) * 10), round((y - y0) * 10)]
    flat = lambda coords: sum((q(c[0], c[1]) for c in coords[:-1] if True), []) if coords[0] == coords[-1] else sum((q(c[0], c[1]) for c in coords), [])
    # --- BGT
    ground, trees = [], []
    for c in COLLS:
        for f in paged(f'{BGT}/{c}/items', {'f': 'json', 'limit': 1000, 'bbox': bbox, 'bbox-crs': RD, 'crs': RD, 'datetime': NOW}):
            p = f['properties']
            if p.get('eind_registratie') or str(p.get('relatieve_hoogteligging', '0')) not in ('0', '1', '2') or not f['geometry']: continue
            if c == 'vegetatieobject_punt':
                if p.get('plus_type') == 'boom':
                    x, y = f['geometry']['coordinates'][:2]
                    if inside(x, y): trees += q(x, y)
                continue
            g = make_valid(shape(f['geometry']))
            cen = g.representative_point()
            if not inside(cen.x, cen.y): continue
            g = g.simplify(0.15, preserve_topology=True)
            for poly in ([g] if g.geom_type == 'Polygon' else [h for h in getattr(g, 'geoms', []) if h.geom_type == 'Polygon']):
                if poly.area < 0.5: continue
                rings = [flat(list(poly.exterior.coords))] + [flat(list(i.coords)) for i in poly.interiors if Polygon(i).area > 0.5]
                ground.append([KINDS.index(kind_of(c, p)), rings])
    # --- 3DBAG
    first = get(BAG3D, {'bbox': bbox, 'limit': 50})
    offs = list(range(51, first['numberMatched'] + 1, 50))
    with ThreadPoolExecutor(4) as ex:
        pages = [first] + list(ex.map(lambda o: get(BAG3D, {'bbox': bbox, 'limit': 50, 'offset': o}), offs))
    buildings, seen = [], set()
    for page in pages:
        if not page.get('features') or 'metadata' not in page: continue
        sc, tr = page['metadata']['transform']['scale'], page['metadata']['transform']['translate']
        for f in page['features']:
            if f['id'] in seen: continue
            V = [(v[0] * sc[0] + tr[0], v[1] * sc[1] + tr[1], v[2] * sc[2] + tr[2]) for v in f['vertices']]
            objs = f['CityObjects']; b = next((o for o in objs.values() if o['type'] == 'Building'), None)
            if not b: continue
            a = b.get('attributes', {})
            if a.get('status') in ('Pand gesloopt', 'Niet gerealiseerd pand', 'Bouwvergunning verleend'): continue
            z0 = a.get('b3_h_maaiveld') or 0; parts = []
            for cid in b.get('children', []):
                o = objs[cid]; gs = o.get('geometry', [])
                geo = next((g for g in gs if str(g['lod']) == '1.3'), None) or next((g for g in gs if str(g['lod']) == '1.2'), None)
                if not geo: continue
                surf = geo['semantics']['surfaces']; vals = geo['semantics']['values'][0]
                for i, s in enumerate(geo['boundaries'][0]):
                    if vals[i] is None or surf[vals[i]]['type'] != 'RoofSurface': continue
                    outer = [V[k] for k in s[0]]; h = round(sum(p[2] for p in outer) / len(outer) - z0, 1)
                    if h < 1: continue
                    parts.append([h] + [sum((q(V[k][0], V[k][1]) for k in r), []) for r in s])
            h70 = round((a.get('b3_h_dak_70p') or 0) - z0, 1)
            if not parts:
                l0 = next((g for g in b.get('geometry', []) if str(g['lod']) == '0'), None)
                if l0 and h70 > 1: parts = [[h70] + [sum((q(V[k][0], V[k][1]) for k in r), []) for r in l0['boundaries'][0]]]
            if not parts: continue
            ring = parts[0][1]; cx = x0 + sum(ring[0::2]) / (len(ring) / 2) / 10; cy = y0 + sum(ring[1::2]) / (len(ring) / 2) / 10
            if not inside(cx, cy): continue
            seen.add(f['id']); buildings.append([f['id'].replace('NL.IMBAG.Pand.', ''), h70, a.get('oorspronkelijkbouwjaar'), parts])
    # --- BRK parcels (RD)
    parcels = []
    for f in paged(BRK, {'f': 'json', 'limit': 1000, 'bbox': bbox, 'bbox-crs': RD, 'crs': RD}):
        p = f['properties']; g = make_valid(shape(f['geometry'])); cen = g.representative_point()
        if not inside(cen.x, cen.y): continue
        g = g.simplify(0.1, preserve_topology=True)
        polys = [g] if g.geom_type == 'Polygon' else [h for h in getattr(g, 'geoms', []) if h.geom_type == 'Polygon']
        label = ' '.join(str(v) for v in (p.get('akr_kadastrale_gemeente_code_waarde'), p.get('sectie'), p.get('perceelnummer')) if v is not None)
        parcels.append([p.get('identificatie_lokaal_id'), label, p.get('kadastrale_grootte_waarde'), [[flat(list(h.exterior.coords))] for h in polys]])
    out = {'tile': [tx, ty], 'origin': [x0, y0], 'buildings': buildings, 'ground': ground, 'trees': trees, 'parcels': parcels}
    s = json.dumps(out, separators=(',', ':'))
    with open(path + '.tmp', 'w') as fh: fh.write(s)
    os.replace(path + '.tmp', path)
    return path, f'{len(buildings)}b {len(ground)}g {len(trees)//2}t {len(parcels)}p {len(s)//1024}KB'


if __name__ == '__main__':
    gem = get(f'{CBS}/gemeenten/items', {'f': 'json', 'gm_code': 'GM0267', 'water': 'NEE', 'limit': 5, 'crs': RD})['features'][0]
    area = make_valid(shape(gem['geometry'])).buffer(300)
    b = area.bounds
    tiles = [(tx, ty) for tx in range(int(b[0] // T), int(b[2] // T) + 1) for ty in range(int(b[1] // T), int(b[3] // T) + 1)
             if area.intersects(box(tx * T, ty * T, tx * T + T, ty * T + T))]
    print('tiles', len(tiles), flush=True)
    json.dump({'size': T, 'fetched': NOW[:10], 'tiles': tiles}, open('data_index.json', 'w'))
    done = 0
    with ThreadPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 5) as ex:
        def safe(t):
            try: return tile_job(*t)
            except Exception as e: return f'data/{t[0]}_{t[1]}.json', f'ERROR {e}'
        for path, msg in ex.map(safe, tiles):
            done += 1; print(f'{done}/{len(tiles)} {path} {msg}', flush=True)
    print('DONE', flush=True)
