// BGT polygons and tree locations are supplied in the editor's five-metre grid coordinates.
function landscapeGround() {
  const colors = { road: '#dcded7', green: '#bdd1a7', hedge: '#9bb98d', water: '#99c3ce' };
  const paths = LANDSCAPE_DATA.ground.map(({ kind, rings }) => {
    const d = rings.map(ring => 'M' + ring.map(point => project(...point).join(',')).join('L') + 'Z').join(' ');
    return `<path d="${d}" fill="${colors[kind]}" fill-rule="evenodd"/>`;
  });
  return `<g class="context-ground" pointer-events="none">${paths.join('')}</g>`;
}

function landscapeTree([x, y]) {
  // BGT records the position. Display height (6 m) and crown radius (2.4 m) are illustrative.
  const [groundX, groundY] = project(x, y);
  const [cx, cy] = project(x, y, view === '3d' ? 6 : 0);
  const radius = (view === '3d' ? 3.7 : 5.2) * 2.4 * zoom;
  const trunk = view === '3d' ? `<path d="M${groundX},${groundY}L${cx},${cy}" stroke="#8c8a73" stroke-width="${1.8 * zoom}"/>` : '';
  return `${trunk}<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#a9c397" stroke="#95b286" stroke-width=".5"/>`;
}

function landscapeTreeItems() {
  return LANDSCAPE_DATA.trees.map(point => ({depth: point[0] + point[1], svg: landscapeTree(point)}));
}

function landscapeTrees() {
  const ordered = landscapeTreeItems().sort((a, b) => a.depth - b.depth);
  return `<g class="context-trees" pointer-events="none">${ordered.map(item => item.svg).join('')}</g>`;
}