import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(scriptDir, '..')
const iconDir = path.join(projectDir, 'public', 'icons')
const outputDir = path.join(projectDir, 'public', 'diagrams')

const palette = {
  navy: '#051C2C',
  blue: '#0B5FFF',
  cyan: '#00A6A6',
  coral: '#FF5A5F',
  amber: '#F6B73C',
  green: '#2E8B57',
  ink: '#17324D',
  muted: '#5D7388',
  line: '#B8C6D1',
  cloud: '#F3F7FA',
  white: '#FFFFFF',
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const icons = new Map()

function iconUri(file) {
  if (!icons.has(file)) {
    const svg = fs.readFileSync(path.join(iconDir, file), 'utf8')
    icons.set(file, `data:image/svg+xml,${encodeURIComponent(svg)}`)
  }
  return icons.get(file)
}

function geometry(x, y, width, height, relative = false) {
  return `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}"${relative ? ' relative="1"' : ''} as="geometry" />`
}

function rect(id, label, x, y, width, height, options = {}) {
  const {
    fill = palette.white,
    stroke = palette.line,
    font = palette.ink,
    size = 17,
    bold = false,
    rounded = 16,
    align = 'center',
    valign = 'middle',
    dashed = false,
  } = options
  const style = [
    `rounded=${rounded ? 1 : 0}`,
    `arcSize=${rounded}`,
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    'strokeWidth=1.5',
    `fontColor=${font}`,
    `fontSize=${size}`,
    `fontStyle=${bold ? 1 : 0}`,
    `align=${align}`,
    `verticalAlign=${valign}`,
    'spacing=10',
    `dashed=${dashed ? 1 : 0}`,
  ].join(';')
  return `<mxCell id="${id}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="1">${geometry(x, y, width, height)}</mxCell>`
}

function text(id, label, x, y, width, height, options = {}) {
  const {
    font = palette.ink,
    size = 17,
    bold = false,
    align = 'center',
    valign = 'middle',
  } = options
  const style = [
    'text',
    'html=1',
    'strokeColor=none',
    'fillColor=none',
    `fontColor=${font}`,
    `fontSize=${size}`,
    `fontStyle=${bold ? 1 : 0}`,
    `align=${align}`,
    `verticalAlign=${valign}`,
    'whiteSpace=wrap',
    'overflow=hidden',
  ].join(';')
  return `<mxCell id="${id}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="1">${geometry(x, y, width, height)}</mxCell>`
}

function image(id, file, x, y, width = 54, height = 54) {
  const style = [
    'shape=image',
    'verticalLabelPosition=bottom',
    'verticalAlign=top',
    'imageAspect=0',
    'aspect=fixed',
    `image=${iconUri(file)}`,
  ].join(';')
  return `<mxCell id="${id}" value="" style="${style}" vertex="1" parent="1">${geometry(x, y, width, height)}</mxCell>`
}

function service(id, file, title, detail, x, y, width = 175, height = 104, options = {}) {
  const fill = options.fill ?? palette.white
  const stroke = options.stroke ?? palette.line
  return [
    rect(`${id}-box`, '', x, y, width, height, { fill, stroke, rounded: 14, dashed: options.dashed ?? false }),
    image(`${id}-icon`, file, x + 14, y + 17, 48, 48),
    text(`${id}-title`, title, x + 70, y + 10, width - 82, 44, { size: 16, bold: true, align: 'left' }),
    text(`${id}-detail`, detail, x + 70, y + 52, width - 82, height - 60, { size: 12, font: palette.muted, align: 'left', valign: 'top' }),
  ].join('')
}

function edge(id, source, target, label = '', options = {}) {
  const color = options.color ?? palette.blue
  const dashed = options.dashed ?? false
  const width = options.width ?? 2
  const style = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    'endArrow=block',
    'endFill=1',
    `strokeColor=${color}`,
    `strokeWidth=${width}`,
    `dashed=${dashed ? 1 : 0}`,
    `fontColor=${palette.muted}`,
    'fontSize=12',
    'labelBackgroundColor=#FFFFFF',
  ]
  if (options.exitX !== undefined) style.push(`exitX=${options.exitX}`, `exitY=${options.exitY ?? 1}`, 'exitDx=0', 'exitDy=0')
  if (options.entryX !== undefined) style.push(`entryX=${options.entryX}`, `entryY=${options.entryY ?? 0}`, 'entryDx=0', 'entryDy=0')
  const serializedStyle = style.join(';')
  const points = options.points?.length
    ? `<Array as="points">${options.points.map((point) => `<mxPoint x="${point.x}" y="${point.y}" />`).join('')}</Array>`
    : ''
  return `<mxCell id="${id}" value="${escapeXml(label)}" style="${serializedStyle}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`
}

function diagramXml(name, width, height, cells) {
  const orderedCells = [...cells].sort((left, right) => {
    const leftIsEdge = left.includes(' edge="1"')
    const rightIsEdge = right.includes(' edge="1"')
    if (leftIsEdge === rightIsEdge) return 0
    return leftIsEdge ? -1 : 1
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="Electron" modified="2026-08-31T00:00:00.000Z" agent="Codex" version="27.0.9">
  <diagram id="${escapeXml(name.toLowerCase().replaceAll(' ', '-'))}" name="${escapeXml(name)}">
    <mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${width}" pageHeight="${height}" math="0" shadow="0" background="#FFFFFF" adaptiveColors="auto">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        ${orderedCells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`
}

function architecture() {
  const cells = []
  cells.push(text('title', 'Ask ONE · Cloudflare edge, existing GCP foundation, Vertex AI', 40, 20, 1120, 44, { size: 25, bold: true, align: 'left', font: palette.navy }))
  cells.push(text('subtitle', 'Start small on the platform already in use; add governed knowledge and model services, then expand through controlled interfaces', 40, 62, 1120, 28, { size: 14, align: 'left', font: palette.muted }))

  cells.push(text('request-label', 'REQUEST + ANSWER PATH', 40, 104, 250, 24, { size: 12, bold: true, align: 'left', font: palette.blue }))
  cells.push(service('web', 'WebMobile-512-color.svg', 'Next.js', 'ONE web experience', 40, 135, 175, 104, { stroke: palette.cyan }))
  cells.push(service('edge', 'Cloudflare.svg', 'Cloudflare edge', 'Authoritative DNS · CDN · WAF · DDoS', 260, 135, 185, 104, { stroke: '#F38020' }))
  cells.push(service('gke', 'GKE-512-color.svg', 'GKE', 'Node.js API + Hub', 490, 135, 175, 104, { stroke: palette.blue }))
  cells.push(service('armor', 'SecurityIdentity-512-color.svg', 'Model Armor', 'Input + output screening', 710, 135, 185, 104, { stroke: palette.coral }))
  cells.push(service('vertex', 'VertexAI-512-color.svg', 'Vertex AI', 'Gemini · Google Gen AI SDK', 940, 135, 205, 104, { stroke: palette.cyan }))

  cells.push(text('knowledge-label', 'START SMALL · GOVERNED KNOWLEDGE / RAG LANE', 40, 294, 430, 24, { size: 12, bold: true, align: 'left', font: palette.green }))
  cells.push(service('sources', 'WebMobile-512-color.svg', 'Governed ONE sources', 'CMS serving one-line.com · Hub uploads · future connectors TBD/TBC', 40, 325, 285, 120, { stroke: palette.green }))
  cells.push(service('ingest', 'IntegrationServices-512-color.svg', 'Governed ingestion', 'Quarantine · validate · approve · chunk · embed', 375, 325, 235, 120, { stroke: palette.amber }))
  cells.push(service('stores', 'CloudSQL-512-color.svg', 'Knowledge stores', 'Cloud Storage versions · Cloud SQL/pgvector · Golden DB', 660, 325, 250, 120, { stroke: palette.green }))
  cells.push(service('events', 'Databases-512-color.svg', 'Events + cache', 'Pub/Sub · version-aware exact cache', 960, 325, 190, 120, { stroke: palette.amber }))

  cells.push(text('api-label', 'NEXT RELEASE · AUTHORIZED LIVE API LANE', 40, 505, 410, 24, { size: 12, bold: true, align: 'left', font: palette.coral }))
  cells.push(service('ecom', 'IntegrationServices-512-color.svg', 'ONE eCommerce APIs', 'Booking · schedules · shipments', 40, 540, 245, 112, { stroke: palette.coral, fill: '#FFF8F7' }))
  cells.push(service('policy', 'SecurityIdentity-512-color.svg', 'GKE tool boundary', 'Identity · purpose · allowed fields · audit', 335, 540, 255, 112, { stroke: palette.coral, fill: '#FFF8F7' }))
  cells.push(rect('future-note', 'MORE SOURCES\nRemain TBD/TBC until owner, classification, interface, controls and cost are approved', 640, 540, 230, 112, { fill: palette.white, stroke: palette.line, font: palette.muted, size: 14, bold: true, dashed: true }))
  cells.push(service('observe', 'Observability-512-color.svg', 'End-to-end observability', 'Query ID · quality · safety · latency · cost', 920, 540, 230, 112, { stroke: palette.blue }))

  cells.push(edge('e1', 'web-box', 'edge-box', 'HTTPS'))
  cells.push(edge('e2', 'edge-box', 'gke-box'))
  cells.push(edge('e3', 'gke-box', 'armor-box'))
  cells.push(edge('e4', 'armor-box', 'vertex-box'))
  cells.push(edge('e5', 'vertex-box', 'armor-box', '', { color: palette.cyan }))
  cells.push(edge('e6', 'sources-box', 'ingest-box', '', { color: palette.green }))
  cells.push(edge('e7', 'ingest-box', 'stores-box', '', { color: palette.green }))
  cells.push(edge('e8', 'stores-box', 'events-box', '', { color: palette.amber }))
  cells.push(edge('e9', 'stores-box', 'gke-box', 'retrieve', { color: palette.green, entryX: 0.75, entryY: 1 }))
  cells.push(edge('e10', 'policy-box', 'ecom-box', '', { color: palette.coral, dashed: true }))
  cells.push(edge('e11', 'events-box', 'observe-box', '', { color: palette.blue }))

  return diagramXml('Architecture', 1200, 700, cells)
}

function securityChain() {
  const cells = []
  cells.push(text('title', 'Defense in depth · fail closed, log the reason', 40, 20, 1120, 44, { size: 25, bold: true, align: 'left', font: palette.navy }))
  cells.push(text('subtitle', 'A failed check returns a safe refusal or standard search—not a partially trusted answer', 40, 62, 1120, 28, { size: 14, align: 'left', font: palette.muted }))

  const items = [
    ['s1', 'Cloudflare.svg', '1 · Cloudflare', 'DNS/CDN · WAF · DDoS · rate limit', '#F38020'],
    ['s2', 'GKE-512-color.svg', '2 · Validate', 'schema · length · locale', palette.blue],
    ['s3', 'SecurityIdentity-512-color.svg', '3 · Screen input', 'injection · PII · URLs', palette.coral],
    ['s4', 'CloudSQL-512-color.svg', '4 · Retrieve', 'allowlisted public corpus', palette.green],
    ['s5', 'VertexAI-512-color.svg', '5 · Generate', 'Gemini uses context only', palette.cyan],
    ['s6', 'ManagementTools-512-color.svg', '6 · Cite', 'support + source validity', palette.amber],
    ['s7', 'SecurityCommandCenter-512-color.svg', '7 · Screen output', 'leakage · harmful content', palette.coral],
    ['s8', 'Observability-512-color.svg', '8 · Audit', 'policy · source · model · cost', palette.blue],
  ]

  items.forEach((item, index) => {
    const col = index % 4
    const row = Math.floor(index / 4)
    const x = row === 0 ? 45 + col * 285 : 45 + (3 - col) * 285
    const y = 150 + row * 230
    cells.push(service(item[0], item[1], item[2], item[3], x, y, 240, 120, { stroke: item[4] }))
    if (index < items.length - 1 && index !== 3) {
      cells.push(edge(`e${index}`, `${item[0]}-box`, `${items[index + 1][0]}-box`, '', { color: item[4] }))
    }
  })
  cells.push(edge('turn', 's4-box', 's5-box', '', { color: palette.green }))
  cells.push(rect('fallback', 'SAFE FALLBACK\nrefuse · standard search · kill switch', 390, 620, 420, 82, { fill: '#FFF3F1', stroke: palette.coral, font: palette.coral, size: 18, bold: true }))
  cells.push(edge('fail1', 's3-box', 'fallback', 'block', { color: palette.coral, dashed: true }))
  cells.push(edge('fail2', 's6-box', 'fallback', 'unsupported', { color: palette.coral, dashed: true }))
  cells.push(edge('fail3', 's7-box', 'fallback', 'block', { color: palette.coral, dashed: true }))

  return diagramXml('Security chain', 1200, 760, cells)
}

function knowledgeQuality() {
  const cells = []
  cells.push(text('title', 'Start small · improve continuously through governed releases', 40, 20, 1120, 44, { size: 25, bold: true, align: 'left', font: palette.navy }))
  cells.push(text('subtitle', 'Every source and change passes correctness, integrity, security and evaluation gates before publication', 40, 62, 1120, 28, { size: 14, align: 'left', font: palette.muted }))

  cells.push(service('sources', 'WebMobile-512-color.svg', '1 · Register source', 'CMS sync · Hub upload · future TBD/TBC', 35, 135, 175, 112, { stroke: palette.blue }))
  cells.push(service('landing', 'Cloud_Storage-512-color.svg', '2 · Quarantine', 'Version · checksum · lineage', 225, 135, 175, 112, { stroke: palette.green }))
  cells.push(service('validate', 'SecurityCommandCenter-512-color.svg', '3 · Validate', 'Malware · DLP · schema · access', 415, 135, 175, 112, { stroke: palette.coral }))
  cells.push(service('ingest', 'IntegrationServices-512-color.svg', '4 · Process RAG', 'Normalize · chunk · embed · index', 605, 135, 175, 112, { stroke: palette.amber }))
  cells.push(service('review', 'ManagementTools-512-color.svg', '5 · Human review', 'Content · metadata · retrieval sample', 795, 135, 175, 112, { stroke: palette.blue }))
  cells.push(service('corpus', 'CloudSQL-512-color.svg', '6 · Publish version', 'Approved corpus · rollback ready', 985, 135, 175, 112, { stroke: palette.green }))

  cells.push(rect('golden', 'GOLDEN DATASET / DB\n100–200 governed cases\nfacts · sources · answer/refuse', 40, 385, 245, 120, { fill: '#FFF9E8', stroke: palette.amber, size: 16, bold: true }))
  cells.push(service('answer', 'VertexAI-512-color.svg', 'Ask ONE answer', 'Retrieved context + citations', 330, 385, 205, 120, { stroke: palette.cyan }))
  cells.push(service('evaluate', 'BigQuery-512-color.svg', 'Evaluation', 'Ragas · Vertex Eval · checks · human review', 580, 385, 215, 120, { stroke: palette.blue }))
  cells.push(rect('gate', 'RELEASE GATE\npass · remediate · stop', 845, 385, 185, 120, { fill: '#F0FBF6', stroke: palette.green, font: palette.green, size: 17, bold: true }))
  cells.push(service('hub', 'ManagementTools-512-color.svg', 'Knowledge & Quality Hub', 'Failures → owner → fix → approve → republish', 370, 610, 330, 112, { stroke: palette.blue, fill: '#F5F9FF' }))
  cells.push(rect('api-note', 'NEXT RELEASE\neCommerce APIs stay in the live tool lane\n—not the RAG corpus by default', 875, 610, 285, 112, { fill: '#FFF8F7', stroke: palette.coral, font: palette.coral, size: 15, bold: true, dashed: true }))

  cells.push(edge('e1', 'sources-box', 'landing-box'))
  cells.push(edge('e2', 'landing-box', 'validate-box', '', { color: palette.coral }))
  cells.push(edge('e3', 'validate-box', 'ingest-box', '', { color: palette.green }))
  cells.push(edge('e4', 'ingest-box', 'review-box', '', { color: palette.amber }))
  cells.push(edge('e5', 'review-box', 'corpus-box', '', { color: palette.green }))
  cells.push(edge('qa1', 'answer-box', 'evaluate-box', '', { color: palette.blue }))
  cells.push(edge('qa2', 'golden', 'evaluate-box', 'expected result', {
    color: palette.amber,
    exitX: 1,
    exitY: 0.85,
    entryX: 0,
    entryY: 0.85,
    points: [{ x: 310, y: 555 }, { x: 560, y: 555 }],
  }))
  cells.push(edge('qa3', 'evaluate-box', 'gate', 'score', { color: palette.blue }))
  cells.push(edge('qa4', 'gate', 'corpus-box', 'release', { color: palette.green }))
  cells.push(edge('qa5', 'evaluate-box', 'hub-box', 'failures', { color: palette.coral }))
  cells.push(edge('qa6', 'hub-box', 'sources-box', 'fix source / metadata', { color: palette.coral, dashed: true }))
  cells.push(edge('qa7', 'hub-box', 'golden', 'new case', { color: palette.amber, dashed: true }))

  return diagramXml('Knowledge quality loop', 1200, 760, cells)
}

function hubModel() {
  const cells = []
  cells.push(text('title', 'The Hub gives ONE control over knowledge and improvement', 40, 20, 1120, 44, { size: 25, bold: true, align: 'left', font: palette.navy }))
  cells.push(text('subtitle', 'One Hub: begin with source and release control; add intelligence only after value is proven', 40, 62, 1120, 28, { size: 14, align: 'left', font: palette.muted }))

  cells.push(service('hub', 'ManagementTools-512-color.svg', 'Knowledge & Quality Hub', 'One accountable operating view · RBAC · audit · human approval', 390, 120, 420, 120, { stroke: palette.blue, fill: '#F5F9FF' }))

  cells.push(text('now-label', 'MINIMUM HUB · START NOW', 40, 292, 520, 26, { size: 13, bold: true, align: 'left', font: palette.green }))
  cells.push(service('sources', 'Cloud_Storage-512-color.svg', 'Source control', 'registry · owners · CMS sync · Hub uploads', 40, 330, 345, 115, { stroke: palette.green }))
  cells.push(service('release', 'ManagementTools-512-color.svg', 'Governed releases', 'review · approve · publish · rollback', 425, 330, 345, 115, { stroke: palette.blue }))
  cells.push(service('evidence', 'SecurityCommandCenter-512-color.svg', 'Evidence + audit', 'Golden Dataset/DB · RBAC · history', 810, 330, 345, 115, { stroke: palette.coral }))

  cells.push(text('future-label', 'FUTURE · CONTENT INTELLIGENCE', 40, 505, 520, 26, { size: 13, bold: true, align: 'left', font: palette.amber }))
  cells.push(service('gaps', 'BigQuery-512-color.svg', 'Content gaps', 'unanswered intents · missing coverage', 40, 543, 345, 115, { stroke: palette.amber, fill: '#FFFCF3', dashed: true }))
  cells.push(service('health', 'Observability-512-color.svg', 'Content health', 'stale or conflicting sources · trends', 425, 543, 345, 115, { stroke: palette.amber, fill: '#FFFCF3', dashed: true }))
  cells.push(service('suggest', 'VertexAI-512-color.svg', 'Improvement suggestions', 'FAQ drafts · prioritization · human approval', 810, 543, 345, 115, { stroke: palette.amber, fill: '#FFFCF3', dashed: true }))

  cells.push(edge('e-now', 'hub-box', 'release-box', 'control', { color: palette.blue }))
  cells.push(edge('e-future', 'hub-box', 'health-box', 'expand after proof', { color: palette.amber, dashed: true }))

  cells.push(text('roles', 'CONTENT  ·  PRODUCT  ·  QA  ·  SECURITY  ·  OPERATIONS  ·  FINANCE', 155, 708, 890, 30, { size: 15, bold: true, font: palette.navy }))

  return diagramXml('Hub operating model', 1200, 800, cells)
}

fs.mkdirSync(outputDir, { recursive: true })

const diagrams = [
  ['ask-one-gcp-architecture.drawio', architecture()],
  ['ask-one-security-chain.drawio', securityChain()],
  ['ask-one-knowledge-quality-loop.drawio', knowledgeQuality()],
  ['ask-one-hub-operating-model.drawio', hubModel()],
]

for (const [file, xml] of diagrams) {
  fs.writeFileSync(path.join(outputDir, file), xml)
}

console.log(`Generated ${diagrams.length} draw.io source files in ${outputDir}`)
