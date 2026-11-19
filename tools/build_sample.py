"""Fetch and compact the Nijkerk sample bundle (gemeente, CBS buurten, BRK parcels, BGT, 3DBAG)."""
import json, urllib.request, urllib.parse, datetime
from concurrent.futures import ThreadPoolExecutor
from shapely.geometry import shape, mapping, Polygon, MultiPolygon, box
from shapely.validation import make_valid

RD = 'http://www.opengis.net/def/crs/EPSG/0/28992'
CBS = 'https://api.pdok.nl/cbs/wijken-en-buurten-2026/ogc/v1/collections'
BRK = 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items'
BGT = 'https://api.pdok.nl/lv/bgt/ogc/v1/collections'
BAG3D = 'https://api.3dbag.nl/collections/pand/items'
GM = 'GM0267'
SAMPLE_BUURT = 'BU02670106'  # Centrum
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def get(url, params=None):
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def paged(url, params):
    out, d = [], get(url, params)
    while True:
        out += d.get('features', [])
        nxt = [l['href'] for l in d.get('links', []) if l['rel'] == 'next']
        if not nxt:
            return out
        d = get(nxt[0])


def r6(geom, tol):
    g = shape(geom).simplify(tol, preserve_topology=True)
    def ring(c): return [[round(p[0], 6), round(p[1], 6)] for p in c]
    polys = [g] if g.geom_type == 'Polygon' else list(g.geoms)
    coords = [[ring(p.exterior.coords)] + [ring(i.coords) for i in p.interiors] for p in polys]
    return {'type': 'MultiPolygon', 'coordinates': coords}


# --- boundaries -------------------------------------------------------------
gem = get(f'{CBS}/gemeenten/items', {'f': 'json', 'gm_code': GM, 'water': 'NEE', 'limit': 5})['features'][0]
wijken = get(f'{CBS}/wijken/items', {'f': 'json', 'gm_code': GM, 'limit': 100})['features']
buurten = []
for w in wijken:
    buurten += get(f'{CBS}/buurten/items', {'f': 'json', 'wk_code': w['properties']['wk_code'], 'limit': 200})['features']
print('wijken', len(wijken), 'buurten', len(buurten))

centrum_rd = get(f'{CBS}/buurten/items', {'f': 'json', 'wk_code': 'WK026701', 'limit': 200, 'crs': RD})['features']
centrum_rd = shape([f for f in centrum_rd if f['properties']['bu_code'] == SAMPLE_BUURT][0]['geometry'])
minx, miny, maxx, maxy = centrum_rd.bounds
E = [int(minx // 10 * 10 - 100), int(miny // 10 * 10 - 100), int(maxx // 10 * 10 + 110), int(maxy // 10 * 10 + 110)]
OX, OY = E[0], E[1]
print('extent', E, (E[2] - E[0]), 'x', (E[3] - E[1]))
bbox = ','.join(map(str, E))

# --- parcels (CRS84 for the map) -------------------------------------------
parcels_raw = paged(BRK, {'f': 'json', 'limit': 1000, 'bbox': bbox, 'bbox-crs': RD})
parcels = []
for f in parcels_raw:
    p = f['properties']
    label = f"{p.get('akr_kadastrale_gemeente_code_waarde','')} {p.get('sectie','')} {p.get('perceelnummer','')}".strip()
    parcels.append({'id': p.get('identificatie_lokaal_id'), 'label': label, 'area': p.get('kadastrale_grootte_waarde'),
                    'geometry': r6(f['geometry'], 2e-6)})
print('parcels', len(parcels))

# --- BGT (RD) ----------------------------------------------------------------
def bgt(coll):
    return coll, paged(f'{BGT}/{coll}/items', {'f': 'json', 'limit': 1000, 'bbox': bbox, 'bbox-crs': RD, 'crs': RD, 'datetime': NOW})

COLLS = ['wegdeel', 'ondersteunendwegdeel', 'waterdeel', 'ondersteunendwaterdeel', 'begroeidterreindeel', 'vegetatieobject_punt']
with ThreadPoolExecutor(6) as ex:
    bgt_raw = dict(ex.map(bgt, COLLS))
KINDS = ['road', 'green', 'hedge', 'water']


def kind_of(coll, p):
    if coll == 'wegdeel': return 'road'
    if coll == 'ondersteunendwegdeel': return 'green' if p.get('fysiek_voorkomen') == 'groenvoorziening' else 'road'
    if coll == 'waterdeel': return 'water'
    if coll == 'ondersteunendwaterdeel': return 'green'
    if coll == 'begroeidterreindeel':
        return 'hedge' if p.get('plus_fysiek_voorkomen') in ('heesters', 'bosplantsoen') else 'green'


def dm_ring(coords):
    flat = []
    for x, y in coords[:-1]:
        flat += [round((x - OX) * 10), round((y - OY) * 10)]
    return flat


ground, trees = [], []
for coll, feats in bgt_raw.items():
    for f in feats:
        p = f['properties']
        if p.get('eind_registratie') or str(p.get('relatieve_hoogteligging', '0')) not in ('0', '1', '2') or not f['geometry']:
            continue
        if coll == 'vegetatieobject_punt':
            if p.get('plus_type') == 'boom':
                x, y = f['geometry']['coordinates'][:2]
                trees += [round((x - OX) * 10), round((y - OY) * 10)]
            continue
        g = make_valid(shape(f['geometry'])).simplify(0.15, preserve_topology=True)
        polys = [g] if g.geom_type == 'Polygon' else [q for q in getattr(g, 'geoms', []) if q.geom_type == 'Polygon']
        for q in polys:
            if q.area < 0.5: continue
            rings = [dm_ring(q.exterior.coords)] + [dm_ring(i.coords) for i in q.interiors if Polygon(i).area > 0.5]
            ground.append([KINDS.index(kind_of(coll, p)), rings])
print('ground', len(ground), 'trees', len(trees) // 2, {c: len(v) for c, v in bgt_raw.items()})

# --- 3DBAG (RD) --------------------------------------------------------------
first = get(BAG3D, {'bbox': bbox, 'limit': 50})
offsets = list(range(51, first['numberMatched'] + 1, 50))
with ThreadPoolExecutor(8) as ex:
    pages = [first] + list(ex.map(lambda o: get(BAG3D, {'bbox': bbox, 'limit': 50, 'offset': o}), offsets))


def parse_page(page):
    sc, tr = page['metadata']['transform']['scale'], page['metadata']['transform']['translate']
    out = []
    for f in page['features']:
        V = [(v[0] * sc[0] + tr[0], v[1] * sc[1] + tr[1], v[2] * sc[2] + tr[2]) for v in f['vertices']]
        objs = f['CityObjects']
        b = next(o for o in objs.values() if o['type'] == 'Building')
        a = b.get('attributes', {})
        if a.get('status') in ('Pand gesloopt', 'Niet gerealiseerd pand', 'Bouwvergunning verleend'):
            continue
        ground_z = a.get('b3_h_maaiveld') or 0
        parts = []
        for cid in b.get('children', []):
            o = objs[cid]
            geo = next((g for g in o.get('geometry', []) if str(g['lod']) == '1.3'), None) or \
                  next((g for g in o.get('geometry', []) if str(g['lod']) == '1.2'), None)
            if not geo: continue
            surf = geo['semantics']['surfaces']; vals = geo['semantics']['values'][0]
            for i, s in enumerate(geo['boundaries'][0]):
                if vals[i] is None or surf[vals[i]]['type'] != 'RoofSurface': continue
                outer = [V[k] for k in s[0]]
                h = round(sum(p[2] for p in outer) / len(outer) - ground_z, 1)
                if h < 1: continue
                rings = [[(p[0], p[1]) for p in outer]] + [[(V[k][0], V[k][1]) for k in r] for r in s[1:]]
                parts.append([h] + [sum(([round((x - OX) * 10), round((y - OY) * 10)] for x, y in r), []) for r in rings])
        if not parts:
            lod0 = next((g for g in b.get('geometry', []) if str(g['lod']) == '0'), None)
            h = (a.get('b3_h_dak_70p') or 0) - ground_z
            if lod0 and h > 1:
                parts = [[round(h, 1)] + [sum(([round((V[k][0] - OX) * 10), round((V[k][1] - OY) * 10)] for k in r), []) for r in lod0['boundaries'][0]]]
        if parts:
            out.append([f['id'].replace('NL.IMBAG.Pand.', ''), round((a.get('b3_h_dak_70p') or 0) - ground_z, 1), a.get('oorspronkelijkbouwjaar'), parts])
    return out


buildings, seen = [], set()
for pg in pages:
    for b in parse_page(pg):
        if b[0] not in seen:
            seen.add(b[0]); buildings.append(b)
print('buildings', len(buildings), 'of matched', first['numberMatched'])

bundle = {
    'version': 1, 'fetched': NOW[:10], 'crs': 'EPSG:28992', 'extent': E, 'origin': [OX, OY], 'unit': 'dm',
    'sampleBuurt': SAMPLE_BUURT,
    'sources': {'buurten': 'CBS Wijken en Buurten 2026 (PDOK)', 'parcels': 'BRK Kadastrale kaart (PDOK)',
                'ground': 'BGT (PDOK)', 'buildings': '3DBAG LoD1.3 (TU Delft / 3DGI, CC BY 4.0)'},
    'gemeente': {'code': GM, 'name': 'Nijkerk', 'geometry': r6(gem['geometry'], 2e-5)},
    'buurten': [{'code': f['properties']['bu_code'], 'name': f['properties']['bu_naam'], 'wijk': f['properties']['wk_naam'],
                 'water': f['properties'].get('water'), 'geometry': r6(f['geometry'], 8e-6)} for f in buurten],
    'parcels': parcels,
    'model': {'kinds': KINDS, 'buildings': buildings, 'ground': ground, 'trees': trees},
}
s = json.dumps(bundle, separators=(',', ':'))
open('nijkerk_sample.json', 'w').write(s)
print('bundle bytes', len(s), {k: len(json.dumps(v, separators=(',', ':'))) for k, v in bundle.items() if isinstance(v, (list, dict))},
      {k: len(json.dumps(v, separators=(',', ':'))) for k, v in bundle['model'].items()})
