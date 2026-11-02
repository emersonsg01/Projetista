<!-- Gerado automaticamente por `npm run docs` a partir de src/core/features.js e src/core/materials.js. Não edite à mão. -->

# Catálogos

## Tipos de feature

| Tipo (JSON) | Nome na interface | Prefixo do nome automático |
|---|---|---|
| `box` | Caixa | Caixa |
| `cylinder` | Cilindro | Cilindro |
| `cone` | Cone | Cone |
| `sphere` | Esfera | Esfera |
| `torus` | Toro | Toro |
| `sketch` | Esboço | Esboço |
| `extrude` | Extrusão | Extrusão |
| `revolve` | Revolução | Revolução |
| `loft` | Loft | Loft |
| `sweep` | Varredura | Varredura |
| `pipe` | Tubo | Tubo |
| `hole` | Furo | Furo |
| `fillet` | Filete | Filete |
| `chamfer` | Chanfro | Chanfro |
| `draft` | Ângulo de saída | Saída |
| `shell` | Casca | Casca |
| `round_edges` | Arredondar todas as arestas | Filete |
| `offset_body` | Offset 3D | Offset |
| `push_pull` | Empurrar/Puxar | PushPull |
| `boolean` | Booleana | Booleana |
| `transform` | Mover/Girar | Mover |
| `mirror` | Espelhar | Espelho |
| `pattern_linear` | Padrão retangular | PadrãoRet |
| `pattern_circular` | Padrão circular | PadrãoCirc |
| `split` | Dividir corpo | Divisão |
| `mate` | Junta de montagem | Junta |
| `import_step` | Importar STEP | STEP |
| `import_mesh` | Importar malha | Importação |
| `appearance` | Aparência/Material | Aparência |
| `delete_body` | Remover corpo | Remover |
| `rename_body` | Renomear corpo | Renomear |

Detalhes de cada campo: [referencia-de-modelagem.md](referencia-de-modelagem.md).

## Materiais

| Material | Densidade (g/cm³) | Preço aprox. (R$/kg) | Classe | Cor padrão |
|---|---|---|---|---|
| PLA | 1.24 | 120 | polímero (impressão 3D) | `#4f8cff` |
| PETG | 1.27 | 130 | polímero (impressão 3D) | `#3fbfa0` |
| ABS | 1.04 | 110 | polímero (impressão 3D) | `#e0e0e0` |
| ASA | 1.07 | 150 | polímero (impressão 3D) | `#d8d8d8` |
| TPU | 1.21 | 180 | elastômero (impressão 3D) | `#333333` |
| Nylon PA12 | 1.01 | 350 | polímero | `#f2efe6` |
| Resina | 1.18 | 250 | fotopolímero (SLA) | `#9aa5b1` |
| Aço 1020 | 7.87 | 12 | metal | `#8c9196` |
| Aço Inox 304 | 8 | 35 | metal | `#b4b9be` |
| Alumínio 6061 | 2.7 | 40 | metal | `#c3c8cd` |
| Latão | 8.5 | 60 | metal | `#c9a64a` |
| Cobre | 8.96 | 70 | metal | `#c27a4a` |
| Titânio Ti6Al4V | 4.43 | 400 | metal | `#8f8f9a` |
| Madeira (Pinus) | 0.5 | 8 | madeira | `#c8a06a` |
| MDF | 0.75 | 6 | madeira | `#b08a5a` |
| Concreto | 2.4 | 0.5 | construção | `#a0a0a0` |
| Vidro | 2.5 | 15 | cerâmico | `#bfe3ef` |

Preços são referências para estimativa de custo; ajuste em `src/core/materials.js`.

## Roscas métricas ISO (assistente de furos)

| Rosca | Ø broca p/ rosca (mm) | Ø passagem ISO 273 média (mm) | Ø rebaixo ISO 4762 (mm) | Prof. rebaixo (mm) | Passo grosso (mm) |
|---|---|---|---|---|---|
| M2 | 1.6 | 2.4 | 4.4 | 2.2 | 0.4 |
| M2.5 | 2.05 | 2.9 | 5.5 | 2.7 | 0.45 |
| M3 | 2.5 | 3.4 | 6.5 | 3.4 | 0.5 |
| M4 | 3.3 | 4.5 | 8 | 4.4 | 0.7 |
| M5 | 4.2 | 5.5 | 10 | 5.4 | 0.8 |
| M6 | 5 | 6.6 | 11 | 6.4 | 1 |
| M8 | 6.8 | 9 | 15 | 8.6 | 1.25 |
| M10 | 8.5 | 11 | 18 | 10.6 | 1.5 |
| M12 | 10.2 | 13.5 | 20 | 12.6 | 1.75 |
| M16 | 14 | 17.5 | 26 | 16.6 | 2 |
| M20 | 17.5 | 22 | 33 | 20.6 | 2.5 |
| M24 | 21 | 26 | 40 | 24.8 | 3 |
