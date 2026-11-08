import { writeFileSync } from 'node:fs';
import { ExcalidrawDiagram, COLORS } from './excalidraw-kit.mjs';

const output = new URL('../../docs/architecture/', import.meta.url);
const model = {
  title: 'Haven runtime',
  view: 'as-is',
  direction: 'left-to-right',
  boundary: {
    id: 'go-server',
    label: 'Go server',
    type: 'process',
    lifecycle: 'existing',
    owner: 'Haven',
    evidence: 'backend/main.go#L221',
  },
  nodes: [
    { id: 'browser', label: 'Web browser', detail: 'Resident and operator portals\nHTML, CSS and JavaScript', kind: 'module', lifecycle: 'existing', plane: 'client', owner: 'Portal user', evidence: 'public/portal/index.html' },
    { id: 'http', label: 'HTTP routes and sessions', detail: 'Static assets, JSON API and\nin-memory cookie sessions', kind: 'module', lifecycle: 'existing', plane: 'runtime', owner: 'Haven', boundary: 'go-server', evidence: 'backend/portal.go#L613' },
    { id: 'rules', label: 'Permissions and actions', detail: 'Role-scoped views, booking rules\nand state validation', kind: 'module', lifecycle: 'existing', plane: 'runtime', owner: 'Haven', boundary: 'go-server', evidence: 'backend/portal.go#L684' },
    { id: 'state', label: 'JSON state file', detail: 'data/state.json\nRevision-checked writes', kind: 'store', lifecycle: 'existing', plane: 'storage', owner: 'Haven', evidence: 'backend/main.go#L183' },
  ],
  flows: [
    { id: 'request', from: 'browser', to: 'http', direction: 'source-to-target', semantic: 'sync-call', transport: 'HTTP', label: 'Load UI / call API' },
    { id: 'action', from: 'http', to: 'rules', direction: 'source-to-target', semantic: 'sync-call', transport: 'Go call', label: 'Apply role and rules' },
    { id: 'persist', from: 'rules', to: 'state', direction: 'source-to-target', semantic: 'data-write', transport: 'Local filesystem', label: 'Read / save state' },
  ],
};

const width = 1250;
const height = 512;
const diagram = new ExcalidrawDiagram({ width, height });
const text = (id, x, y, width, value, fontSize, color = COLORS.ink) =>
  diagram.text({ id, x, y, width, height: fontSize * 1.4, value, fontSize, color, fontFamily: 2 });

text('title', 36, 28, 750, model.title, 34);
text('subtitle', 36, 77, 1140, 'Self-hosted · One Go process serves the web UI and JSON API', 20, COLORS.muted);
diagram.boundary({ id: model.boundary.id, title: model.boundary.label, lifecycle: 'existing', x: 460, y: 132, width: 364, height: 305 });

const placement = {
  browser: { x: 36, y: 181, width: 237, height: 108 },
  http: { x: 484, y: 180, width: 316, height: 108 },
  rules: { x: 484, y: 330, width: 316, height: 85 },
  state: { x: 1000, y: 328, width: 214, height: 89 },
};
for (const node of model.nodes) {
  diagram.node({
    id: node.id, title: node.label, subtitle: node.detail, kind: 'existing',
    fontSize: 21, subtitleSize: 15, ...placement[node.id],
  });
}

const routes = {
  request: { points: [[279, 234], [478, 234]], labelDx: -83, labelDy: -26, labelWidth: 170 },
  action: { points: [[642, 294], [642, 324]], labelDx: 15, labelDy: -11, labelWidth: 160 },
  persist: { points: [[806, 372], [994, 372]], labelDx: -74, labelDy: -26, labelWidth: 160 },
};
for (const flow of model.flows) {
  diagram.arrow({
    id: flow.id, startId: flow.from, endId: flow.to, label: flow.label,
    labelSize: 14, ...routes[flow.id],
  });
}

diagram.rect({ id: 'legend-node', x: 37, y: 466, width: 26, height: 16, strokeColor: COLORS.existing, backgroundColor: COLORS.existingFill, strokeWidth: 2 });
text('legend-node-label', 74, 463, 260, 'Implemented component', 16, COLORS.muted);
text('legend-arrow', 326, 460, 36, '→', 22);
text('legend-arrow-label', 365, 463, 370, 'Request, call or file operation', 16, COLORS.muted);

const nodeLabels = model.nodes.map(({ label }) => label);
const labelById = new Map(model.nodes.map(({ id, label }) => [id, label]));
const contract = {
  canvas: { width, height, strictBounds: true },
  requiredLabels: [model.title, model.boundary.label, ...nodeLabels, ...model.flows.map(({ label }) => label), 'Implemented component', 'Request, call or file operation'],
  styleRules: [model.boundary.label, ...nodeLabels].map(label => ({ label, strokeColor: COLORS.existing, strokeStyle: 'solid' })),
  requiredRelations: model.flows.map(({ from, to }) => ({ from: labelById.get(from), to: labelById.get(to) })),
  overlapSets: [nodeLabels, ['Web browser', model.boundary.label, 'JSON state file']],
  palette: [COLORS.ink, COLORS.muted, COLORS.existing, COLORS.existingFill, '#f3f8ff', 'transparent'],
  requireBoundArrows: true,
  checkTextBounds: true,
};

diagram.write({
  excalidrawPath: new URL('haven-runtime.excalidraw', output),
  svgPath: new URL('haven-runtime.svg', output),
});
writeFileSync(new URL('haven-runtime-contract.json', output), JSON.stringify(contract, null, 2) + '\n');
