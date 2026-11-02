// Referência completa das features, entregue ao Claude via ferramenta/recurso MCP.
export const REFERENCE = `# Projetista — referência de modelagem (kernel B-rep exato OpenCascade)

Unidades: mm e graus. Z para cima. Geometria EXATA em dupla precisão (planos, cilindros, cones,
toros, NURBS), tolerância 1e-7 mm. Todo valor aceita número OU expressão com parâmetros e unidades:
"L/2 + 3", "2*esp", "1in", "sin(30)*R", "max(a,b)", "if(n>4, 10, 5)".

## Conceitos
- Linha do tempo paramétrica com regeneração incremental (só recalcula a partir do que mudou).
- Corpos têm nome. Features sólidas usam operation: "new" (cria 'body') | "join" | "cut" | "intersect" (sobre 'target').
- Faces e arestas são escolhidas por INTENÇÃO (estável ao editar o modelo):
  FACE:   { normal:"+z"|[x,y,z], pick:"max"|"min"|"largest"|"smallest", near:[x,y,z], type:"plane"|"cylinder"|"cone",
            radius, within:{min:[..],max:[..]}, all:true, index:n }
  ARESTA: "all" | { type:"line"|"circle", parallel:"z", perpendicular:"z", radius, onFace:{seletor de face},
            near:[x,y,z], count, within:{min,max}, minLength, maxLength, index:[..] } | [seletor, seletor] (união)
  Use analyze kind="faces"/"edges" para ver índices, tipos, normais e raios exatos.

## Primitivas
box (width, depth, height, at=centro da base, centered?, fillet?, chamfer?) · cylinder (radius|diameter, height, at, axis, centered?)
cone (radius1, radius2, height, at, axis) · sphere (radius|diameter, at) · torus (majorRadius, minorRadius, at, axis)

## Esboço 2D com solver de restrições
{ type:"sketch", name:"S1", plane:"XY"|"XZ"|"YZ"|{origin,normal,xDir}|{face:{body,...seletor}}, offset?, shapes:[...], points, entities, constraints }
- shapes: rect {x,y,width,height}|{center,width,height} · circle {center, radius|diameter} · polygon {points} · polyline {points, closed?}
  regularPolygon {center, radius, sides, rotation} · slot {center, length, width, angle} · construction:true
- entities: line{id,a,b} · circle{id,c,r} · arc{id,c,a,b} (anti-horário de a até b) — arcos e círculos viram curvas EXATAS no B-rep
- constraints: coincident fix horizontal vertical distance distanceX distanceY length parallel perpendicular angle equal radius
  diameter pointOnLine pointOnCircle midpoint tangent concentric symmetric (analyze kind="sketch" mostra DOF)
- Laços internos viram furos (aninhamento par/ímpar). Esboço em face: origem = projeção da origem do mundo na face.

## A partir de esboço
- extrude: sketch, distance (ou "through"), direction "normal"|"reverse"|"symmetric"|"two-sides"(+distance2),
  taper (ângulo de saída em graus, exato), twist (graus), cornerRadius, thinWall, offset2D, startOffset, operation/body/target
- revolve: sketch, angle (360), axis "y"|"x" (eixo DO esboço)
- loft: sections:[esboços], ruled? (transição suave real entre perfis quaisquer, inclusive côncavos)
- sweep: profile (esboço), path:[[x,y,z],...], bendRadius? (perfil varrido com dobras de raio)
- pipe: path, radius|diameter, wall? | innerRadius?, bendRadius (padrão 2×raio) — tubulação com curvas reais

## Furos (assistente ISO)
hole: target, at | positions:[[x,y,z]...], direction ("-z" = para dentro), size "M2".."M24", fit "clearance"|"tap",
diameter?, depth (ou "through"), tipAngle (118), holeType "simple"|"counterbore"|"countersink", cbDiameter, cbDepth, csDiameter, csAngle

## Acabamento (exato, por aresta/face)
- fillet: body, edges (seletor), radius      - chamfer: body, edges, distance, distance2?
- round_edges: body, radius (todas)          - draft: body, pull:"z", angle, faces? (padrão: laterais), neutral:[x,y,z]
- shell: body, thickness, openFaces:["+z" | seletor] — aplique ANTES dos filetes quando possível
- offset_body: body, distance (±), copy?     - push_pull: body, face (seletor plano), distance (+ adiciona, − remove)

## Corpos e montagem
boolean (target, tools, operation, keepTools?) · transform (body, translate, rotate:[rx,ry,rz], rotateAxis:{axis,angle}, scale (uniforme), center, copy?)
mirror (body, normal, offset, copy?) · pattern_linear (body, direction, count, spacing, direction2?, count2?, spacing2?, skip?, copy?)
pattern_circular (body, axis, center, count, angle, copy?) · split (body, normal, offset, keep "both"|"positive"|"negative", otherBody?)
mate (body, face, to:{body,...seletor}, offset, angle, align "centroid"|"plane", shift) · import_step (file, at?, scale?, body)
import_mesh (file .stl/.obj ≤60k triângulos, vira B-rep) · appearance (body, material?, color?) · delete_body · rename_body

## Dicas para o Claude
1. Parâmetros primeiro (set_parameters); depois add_features em lote (uma operação desfazível).
2. Confira SEMPRE com render_view (sheet:true = 4 vistas). Use measure/analyze para validar números exatos.
3. Filetes: selecione arestas por intenção (ex.: {type:"line", parallel:"z"} = arestas verticais).
4. Use optimize/parameter_study para dimensionar — rodam em paralelo em todos os núcleos.
5. Para fabricação: export_model format "step" (exato) ou "3mf"/"stl" com quality "fine"; technical_drawing para o desenho.
`;
