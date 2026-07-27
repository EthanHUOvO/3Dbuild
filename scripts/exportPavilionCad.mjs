import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const OUTPUT_DIR = resolve(process.cwd(), "public/cad");
const MM = 1000;
const SIDES = 8;
const ROTATION = Math.PI / 8;
const COLUMN_RADIUS = 4.75 * MM;
const EAVE_RADIUS = 6.65 * MM;
const EAVE_PURLIN_Y = 8.5 * MM;
const EAVE_Y = 7.62 * MM;
const APEX_Y = 10.65 * MM;

const LAYERS = {
  "A-TITLE": { color: 7, svg: "#172421", weight: 1.5 },
  "A-ANNO": { color: 7, svg: "#40514d", weight: 0.8 },
  "A-DIMS": { color: 3, svg: "#159b8d", weight: 0.75 },
  "A-CENTER": { color: 4, svg: "#60a9a0", weight: 0.65 },
  "A-HIDDEN": { color: 8, svg: "#91a09c", weight: 0.55, dash: "6 5" },
  "A-RAILING": { color: 30, svg: "#96734c", weight: 0.85 },
  "S-FOUNDATION": { color: 8, svg: "#6e7774", weight: 1.15 },
  "S-COLUMN-BASE": { color: 9, svg: "#7f8d88", weight: 1.0 },
  "S-COLUMN": { color: 1, svg: "#9b3e34", weight: 1.35 },
  "S-BEAM": { color: 30, svg: "#a76642", weight: 1.25 },
  "S-DOUGONG": { color: 3, svg: "#258e80", weight: 1.15 },
  "S-PURLIN": { color: 32, svg: "#76543d", weight: 1.05 },
  "S-RAFTER": { color: 33, svg: "#a57550", weight: 0.95 },
  "S-ROOF": { color: 5, svg: "#315f5b", weight: 1.5 },
  "S-RIDGE": { color: 2, svg: "#bb8a37", weight: 1.2 },
};

function n(value) {
  return Number(value.toFixed(4));
}

function octagon(radius, y = 0, rotation = ROTATION) {
  return Array.from({ length: SIDES }, (_, index) => {
    const angle = (Math.PI * 2 * index) / SIDES + rotation;
    return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
  });
}

class CadDrawing {
  constructor(name, extents) {
    this.name = name;
    this.extents = extents;
    this.entities = [];
  }

  line(x1, y1, x2, y2, layer, options = {}) {
    this.entities.push({ kind: "LINE", x1, y1, x2, y2, layer, ...options });
  }

  circle(x, y, radius, layer) {
    this.entities.push({ kind: "CIRCLE", x, y, radius, layer });
  }

  text(x, y, height, value, layer = "A-ANNO", align = "LEFT", rotation = 0) {
    this.entities.push({ kind: "TEXT", x, y, height, value, layer, align, rotation });
  }

  polygon(points, layer, close = true, options = {}) {
    for (let index = 0; index < points.length - 1; index += 1) {
      this.line(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y, layer, options);
    }
    if (close && points.length > 2) {
      this.line(points.at(-1).x, points.at(-1).y, points[0].x, points[0].y, layer, options);
    }
  }

  rectangle(x1, y1, x2, y2, layer, options = {}) {
    this.polygon(
      [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ],
      layer,
      true,
      options,
    );
  }

  cloneTranslated(dx, dy) {
    return this.entities.map((entity) => {
      if (entity.kind === "LINE") {
        return {
          ...entity,
          x1: entity.x1 + dx,
          x2: entity.x2 + dx,
          y1: entity.y1 + dy,
          y2: entity.y2 + dy,
        };
      }
      return { ...entity, x: entity.x + dx, y: entity.y + dy };
    });
  }

  toDxf() {
    const header = [
      "0", "SECTION", "2", "HEADER",
      "9", "$ACADVER", "1", "AC1009",
      "9", "$DWGCODEPAGE", "3", "ANSI_1252",
      "9", "$INSUNITS", "70", "4",
      "9", "$EXTMIN", "10", String(n(this.extents.minX)), "20", String(n(this.extents.minY)), "30", "0",
      "9", "$EXTMAX", "10", String(n(this.extents.maxX)), "20", String(n(this.extents.maxY)), "30", "0",
      "0", "ENDSEC",
      "0", "SECTION", "2", "TABLES",
      "0", "TABLE", "2", "LTYPE", "70", "2",
      "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0.0",
      "0", "LTYPE", "2", "DASHED", "70", "0", "3", "Dashed __ __", "72", "65", "73", "2", "40", "12.0", "49", "8.0", "74", "0", "49", "-4.0", "74", "0",
      "0", "ENDTAB",
      "0", "TABLE", "2", "LAYER", "70", String(Object.keys(LAYERS).length),
    ];
    Object.entries(LAYERS).forEach(([layer, style]) => {
      header.push(
        "0", "LAYER", "2", layer, "70", "0", "62", String(style.color), "6", style.dash ? "DASHED" : "CONTINUOUS",
      );
    });
    header.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");

    const body = [];
    this.entities.forEach((entity) => {
      if (entity.kind === "LINE") {
        body.push(
          "0", "LINE", "8", entity.layer,
          "10", String(n(entity.x1)), "20", String(n(entity.y1)), "30", "0",
          "11", String(n(entity.x2)), "21", String(n(entity.y2)), "31", "0",
        );
      } else if (entity.kind === "CIRCLE") {
        body.push(
          "0", "CIRCLE", "8", entity.layer,
          "10", String(n(entity.x)), "20", String(n(entity.y)), "30", "0",
          "40", String(n(entity.radius)),
        );
      } else if (entity.kind === "TEXT") {
        body.push(
          "0", "TEXT", "8", entity.layer,
          "10", String(n(entity.x)), "20", String(n(entity.y)), "30", "0",
          "40", String(n(entity.height)), "1", entity.value,
          "50", String(n(entity.rotation)),
        );
        if (entity.align === "CENTER") {
          body.push("72", "1", "11", String(n(entity.x)), "21", String(n(entity.y)), "31", "0");
        } else if (entity.align === "RIGHT") {
          body.push("72", "2", "11", String(n(entity.x)), "21", String(n(entity.y)), "31", "0");
        }
      }
    });
    return [...header, ...body, "0", "ENDSEC", "0", "EOF", ""].join("\r\n");
  }
}

function doubleSegment(drawing, a, b, width, layer) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  drawing.line(a.x + nx, a.y + ny, b.x + nx, b.y + ny, layer);
  drawing.line(a.x - nx, a.y - ny, b.x - nx, b.y - ny, layer);
  drawing.line(a.x + nx, a.y + ny, a.x - nx, a.y - ny, layer);
  drawing.line(b.x + nx, b.y + ny, b.x - nx, b.y - ny, layer);
}

function arrow(drawing, x, y, direction, layer = "A-DIMS", size = 130) {
  const angle = Math.atan2(direction.y, direction.x);
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  drawing.line(x, y, x + Math.cos(left) * size, y + Math.sin(left) * size, layer);
  drawing.line(x, y, x + Math.cos(right) * size, y + Math.sin(right) * size, layer);
}

function horizontalDimension(drawing, x1, x2, yObject, yDimension, label) {
  drawing.line(x1, yObject, x1, yDimension + 150, "A-DIMS");
  drawing.line(x2, yObject, x2, yDimension + 150, "A-DIMS");
  drawing.line(x1, yDimension, x2, yDimension, "A-DIMS");
  arrow(drawing, x1, yDimension, { x: 1, y: 0 });
  arrow(drawing, x2, yDimension, { x: -1, y: 0 });
  drawing.text((x1 + x2) / 2, yDimension + 180, 220, label, "A-DIMS", "CENTER");
}

function verticalDimension(drawing, xObject, xDimension, y1, y2, label) {
  drawing.line(xObject, y1, xDimension - 150, y1, "A-DIMS");
  drawing.line(xObject, y2, xDimension - 150, y2, "A-DIMS");
  drawing.line(xDimension, y1, xDimension, y2, "A-DIMS");
  arrow(drawing, xDimension, y1, { x: 0, y: 1 });
  arrow(drawing, xDimension, y2, { x: 0, y: -1 });
  drawing.text(xDimension - 210, (y1 + y2) / 2, 220, label, "A-DIMS", "CENTER", 90);
}

function sectionTitle(drawing, title, subtitle, x, y) {
  drawing.text(x, y, 360, title, "A-TITLE");
  drawing.text(x, y - 420, 200, subtitle, "A-ANNO");
  drawing.line(x, y - 600, x + 5200, y - 600, "A-TITLE");
}

function addGeneralNotes(drawing, x, y) {
  const notes = [
    "UNITS: MILLIMETRES | MODEL SPACE 1:1",
    "RECOMMENDED PLOT: A3 @ 1:50",
    "PROCEDURAL CONCEPT MODEL - NOT FOR CONSTRUCTION",
    "VERIFY LOCAL CODES, MATERIAL GRADES AND CONNECTION DESIGN",
  ];
  notes.forEach((note, index) => drawing.text(x, y - index * 270, 170, note, "A-ANNO"));
}

function buildPlan() {
  const drawing = new CadDrawing("PAVILION PLAN", {
    minX: -9000,
    minY: -9800,
    maxX: 9000,
    maxY: 9000,
  });

  const foundationRadii = [6400, 5950, 5620];
  foundationRadii.forEach((radius) => {
    drawing.polygon(octagon(radius).map(({ x, z }) => ({ x, y: z })), "S-FOUNDATION");
  });

  const columns = octagon(COLUMN_RADIUS);
  columns.forEach(({ x, z }) => {
    drawing.circle(x, z, 560, "S-COLUMN-BASE");
    drawing.circle(x, z, 300, "S-COLUMN");
    drawing.line(x - 80, z, x + 80, z, "A-CENTER");
    drawing.line(x, z - 80, x, z + 80, "A-CENTER");
  });

  for (let index = 0; index < SIDES; index += 1) {
    const next = (index + 1) % SIDES;
    const a = { x: columns[index].x, y: columns[index].z };
    const b = { x: columns[next].x, y: columns[next].z };
    doubleSegment(drawing, a, b, 480, "S-BEAM");
    const insetA = { x: a.x * 0.94, y: a.y * 0.94 };
    const insetB = { x: b.x * 0.94, y: b.y * 0.94 };
    doubleSegment(drawing, insetA, insetB, 150, "A-RAILING");
  }

  for (let index = 0; index < 4; index += 1) {
    const opposite = index + 4;
    doubleSegment(
      drawing,
      { x: columns[index].x, y: columns[index].z },
      { x: columns[opposite].x, y: columns[opposite].z },
      340,
      "S-BEAM",
    );
  }

  const roofVertices = octagon(EAVE_RADIUS + 200);
  drawing.polygon(roofVertices.map(({ x, z }) => ({ x, y: z })), "S-ROOF");
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI * 2 * index) / 16 + ROTATION;
    const radius = index % 2 === 0 ? EAVE_RADIUS + 240 : EAVE_RADIUS;
    drawing.line(0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius, "S-RAFTER");
  }
  octagon(EAVE_RADIUS + 260).forEach(({ x, z }) => drawing.line(0, 0, x, z, "S-RIDGE"));

  for (let axis = 0; axis < 4; axis += 1) {
    const angle = (Math.PI * axis) / 4;
    drawing.line(
      Math.cos(angle) * -8200,
      Math.sin(angle) * -8200,
      Math.cos(angle) * 8200,
      Math.sin(angle) * 8200,
      "A-CENTER",
    );
  }
  drawing.circle(0, 0, 120, "A-CENTER");
  drawing.text(140, 140, 180, "CENTER", "A-CENTER");

  const roofHalfWidth = (EAVE_RADIUS + 200) * Math.cos(ROTATION);
  const foundationHalfWidth = 6400 * Math.cos(ROTATION);
  horizontalDimension(
    drawing,
    -roofHalfWidth,
    roofHalfWidth,
    roofHalfWidth,
    7900,
    `${Math.round(roofHalfWidth * 2)} ROOF OVERALL`,
  );
  horizontalDimension(
    drawing,
    -foundationHalfWidth,
    foundationHalfWidth,
    -foundationHalfWidth,
    -7900,
    `${Math.round(foundationHalfWidth * 2)} FOUNDATION`,
  );
  drawing.line(0, 0, COLUMN_RADIUS * Math.cos(ROTATION), COLUMN_RADIUS * Math.sin(ROTATION), "A-DIMS");
  arrow(
    drawing,
    COLUMN_RADIUS * Math.cos(ROTATION),
    COLUMN_RADIUS * Math.sin(ROTATION),
    { x: -Math.cos(ROTATION), y: -Math.sin(ROTATION) },
  );
  drawing.text(1950, 1060, 220, "R4750 COLUMN GRID", "A-DIMS");
  drawing.text(-8200, 6900, 190, "A", "A-CENTER");
  drawing.text(8030, -7050, 190, "A", "A-CENTER");

  sectionTitle(drawing, "A-101  OCTAGONAL PAVILION PLAN", "COLUMN / BEAM / RAFTER SET-OUT", -8400, -8600);
  addGeneralNotes(drawing, 1600, -8550);
  return drawing;
}

function addFoundationElevation(drawing, xOffset = 0, yOffset = 0) {
  drawing.rectangle(xOffset - 6580, yOffset - 250, xOffset + 6580, yOffset + 350, "S-FOUNDATION");
  drawing.rectangle(xOffset - 5950, yOffset + 330, xOffset + 5950, yOffset + 710, "S-FOUNDATION");
  drawing.rectangle(xOffset - 5620, yOffset + 700, xOffset + 5620, yOffset + 980, "S-FOUNDATION");
}

function addColumnElevation(drawing, x, yOffset = 0, hidden = false) {
  const layer = hidden ? "A-HIDDEN" : "S-COLUMN";
  drawing.line(x - 380, yOffset + 1360, x - 300, yOffset + 7080, layer);
  drawing.line(x + 380, yOffset + 1360, x + 300, yOffset + 7080, layer);
  drawing.line(x - 380, yOffset + 1360, x + 380, yOffset + 1360, layer);
  drawing.line(x - 300, yOffset + 7080, x + 300, yOffset + 7080, layer);
  drawing.rectangle(x - 670, yOffset + 990, x + 670, yOffset + 1330, "S-COLUMN-BASE");
  drawing.rectangle(x - 540, yOffset + 1330, x + 540, yOffset + 1470, "S-COLUMN-BASE");
}

function addDougongElevation(drawing, x, yOffset = 0) {
  drawing.rectangle(x - 360, yOffset + 7335, x + 360, yOffset + 7685, "S-DOUGONG");
  drawing.rectangle(x - 740, yOffset + 7690, x + 740, yOffset + 7910, "S-DOUGONG");
  drawing.rectangle(x - 520, yOffset + 7980, x + 520, yOffset + 8200, "S-DOUGONG");
  drawing.rectangle(x - 560, yOffset + 8250, x + 560, yOffset + 8430, "S-DOUGONG");
}

function buildElevation() {
  const drawing = new CadDrawing("FRONT ELEVATION", {
    minX: -9000,
    minY: -1800,
    maxX: 9300,
    maxY: 13200,
  });
  addFoundationElevation(drawing);

  const columnXs = [-4388.9, -1817.8, 1817.8, 4388.9];
  columnXs.forEach((x) => addColumnElevation(drawing, x));
  columnXs.forEach((x) => addDougongElevation(drawing, x));

  drawing.rectangle(-4630, 6970, 4630, 7390, "S-BEAM");
  drawing.rectangle(-4750, 8380, 4750, 8620, "S-PURLIN");
  drawing.line(-6850, 7730, -4750, 8500, "S-ROOF");
  drawing.line(-4750, 8500, 0, 10650, "S-ROOF");
  drawing.line(0, 10650, 4750, 8500, "S-ROOF");
  drawing.line(4750, 8500, 6850, 7730, "S-ROOF");
  drawing.line(-6850, 7620, -4750, 8440, "S-RAFTER");
  drawing.line(-4750, 8440, 0, 10470, "S-RAFTER");
  drawing.line(0, 10470, 4750, 8440, "S-RAFTER");
  drawing.line(4750, 8440, 6850, 7620, "S-RAFTER");
  drawing.line(-6850, 7730, -6850, 7500, "S-RIDGE");
  drawing.line(6850, 7730, 6850, 7500, "S-RIDGE");

  drawing.rectangle(-620, 10650, 620, 11030, "S-RIDGE");
  drawing.rectangle(-260, 11030, 260, 12080, "S-RIDGE");
  drawing.circle(0, 12410, 420, "S-RIDGE");

  [-4388.9, -1817.8, 1817.8, 4388.9].forEach((x) => {
    drawing.line(x - 780, 1820, x + 780, 1820, "A-RAILING");
    drawing.line(x - 720, 2640, x + 720, 2640, "A-RAILING");
  });

  drawing.line(0, -600, 0, 13000, "A-CENTER");
  horizontalDimension(drawing, -6850, 6850, 7500, 12800, "13700 ROOF OVERALL");
  horizontalDimension(drawing, -4388.9, 4388.9, 990, -850, "8778 VISIBLE COLUMN SPAN");
  verticalDimension(drawing, 6850, 8200, 0, 10650, "10650 APEX");
  verticalDimension(drawing, 4750, 7550, 0, 8500, "8500 EAVE PURLIN");

  sectionTitle(drawing, "A-201  FRONT ELEVATION", "OPEN PAVILION / OCTAGONAL PYRAMIDAL ROOF", -8400, 11800);
  addGeneralNotes(drawing, -8400, 10750);
  return drawing;
}

function buildSection() {
  const drawing = new CadDrawing("SECTION A-A", {
    minX: -9000,
    minY: -1800,
    maxX: 9500,
    maxY: 13200,
  });
  addFoundationElevation(drawing);
  addColumnElevation(drawing, -4750);
  addColumnElevation(drawing, 4750);
  addDougongElevation(drawing, -4750);
  addDougongElevation(drawing, 4750);

  drawing.rectangle(-4930, 6970, 4930, 7390, "S-BEAM");
  drawing.rectangle(-4930, 7400, 4930, 7720, "S-BEAM");
  drawing.rectangle(-4750, 8380, 4750, 8620, "S-PURLIN");

  drawing.rectangle(-360, 7685, 360, 10235, "S-COLUMN");
  drawing.rectangle(-410, 7685, 410, 7985, "S-DOUGONG");
  drawing.rectangle(-360, 10235, 360, 10515, "S-DOUGONG");

  const profile = [
    { x: -6890, y: 7620 },
    { x: -4750, y: 8500 },
    { x: 0, y: 10650 },
    { x: 4750, y: 8500 },
    { x: 6890, y: 7620 },
  ];
  drawing.polygon(profile, "S-RAFTER", false);
  drawing.polygon(profile.map(({ x, y }) => ({ x, y: y + 130 })), "S-ROOF", false);
  drawing.line(-6890, 7620, -6890, 7420, "S-ROOF");
  drawing.line(6890, 7620, 6890, 7420, "S-ROOF");

  drawing.rectangle(-620, 10650, 620, 11030, "S-RIDGE");
  drawing.rectangle(-260, 11030, 260, 12080, "S-RIDGE");
  drawing.circle(0, 12410, 420, "S-RIDGE");

  drawing.line(-8200, 0, 8500, 0, "A-CENTER");
  drawing.line(0, -600, 0, 13000, "A-CENTER");
  drawing.text(-7150, 6950, 190, "ROOF RAFTER BEARS ON EAVE PURLIN", "A-ANNO");
  drawing.line(-5750, 7100, -4860, 8390, "A-ANNO");
  arrow(drawing, -4860, 8390, { x: -0.55, y: -0.83 }, "A-ANNO", 120);
  drawing.text(700, 9250, 190, "CENTRAL KINGPOST", "A-ANNO");
  drawing.line(650, 9200, 360, 9200, "A-ANNO");
  drawing.text(-1600, 7480, 190, "DIAMETRAL SUPPORT BEAM", "A-ANNO");
  drawing.text(-7800, 2500, 190, "OPEN PERIMETER + RAILING", "A-ANNO");

  horizontalDimension(drawing, -4750, 4750, 990, -850, "9500 STRUCTURAL DIAMETER");
  verticalDimension(drawing, 6890, 8300, 0, 12410, "12410 FINIAL TOP");
  verticalDimension(drawing, 4750, 7600, 0, 8500, "8500 PURLIN");

  sectionTitle(drawing, "A-301  SECTION A-A", "FOUNDATION -> COLUMN -> BEAM -> PURLIN -> RAFTER", -8400, 11800);
  addGeneralNotes(drawing, -8400, 10750);
  return drawing;
}

function isoProject(x, y, z, offsetY = 0) {
  const cos30 = Math.cos(Math.PI / 6);
  return {
    x: (x - z) * cos30,
    y: y + (x + z) * 0.5 + offsetY,
  };
}

function isoPolygon(drawing, points, layer, yOffset = 0, close = true) {
  drawing.polygon(points.map(({ x, y, z }) => isoProject(x, y, z, yOffset)), layer, close);
}

function buildExploded() {
  const drawing = new CadDrawing("EXPLODED AXONOMETRIC", {
    minX: -13000,
    minY: -3500,
    maxX: 14200,
    maxY: 30000,
  });

  [6400, 5950, 5620].forEach((radius, index) => {
    isoPolygon(drawing, octagon(radius, 0), "S-FOUNDATION", index * 380);
  });

  const columns = octagon(COLUMN_RADIUS);
  columns.forEach(({ x, z }) => {
    const bottom = isoProject(x, 1360, z, 2600);
    const top = isoProject(x, 7080, z, 2600);
    drawing.line(bottom.x, bottom.y, top.x, top.y, "S-COLUMN");
    drawing.circle(bottom.x, bottom.y - 300, 180, "S-COLUMN-BASE");
  });

  const ringY = 11100;
  isoPolygon(drawing, octagon(COLUMN_RADIUS, ringY), "S-BEAM");
  for (let index = 0; index < 4; index += 1) {
    const opposite = index + 4;
    const start = isoProject(columns[index].x, ringY + 600, columns[index].z);
    const end = isoProject(columns[opposite].x, ringY + 600, columns[opposite].z);
    drawing.line(start.x, start.y, end.x, end.y, "S-BEAM");
  }

  const dgY = 14350;
  columns.forEach(({ x, z }) => {
    const center = isoProject(x, dgY, z);
    drawing.rectangle(center.x - 240, center.y - 180, center.x + 240, center.y + 180, "S-DOUGONG");
    drawing.line(center.x - 520, center.y, center.x + 520, center.y, "S-DOUGONG");
  });

  const purlinY = 17100;
  isoPolygon(drawing, octagon(COLUMN_RADIUS, purlinY), "S-PURLIN");

  const rafterOuterY = 19400;
  const rafterApexY = 22450;
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI * 2 * index) / 16 + ROTATION;
    const radius = index % 2 === 0 ? EAVE_RADIUS + 240 : EAVE_RADIUS;
    const outer = isoProject(Math.cos(angle) * radius, rafterOuterY, Math.sin(angle) * radius);
    const apex = isoProject(0, rafterApexY, 0);
    drawing.line(outer.x, outer.y, apex.x, apex.y, "S-RAFTER");
  }

  const roofBaseY = 24800;
  const roofApexY = 27850;
  const roofVertices = octagon(EAVE_RADIUS + 200, roofBaseY);
  isoPolygon(drawing, roofVertices, "S-ROOF");
  roofVertices.forEach(({ x, y, z }) => {
    const outer = isoProject(x, y, z);
    const apex = isoProject(0, roofApexY, 0);
    drawing.line(outer.x, outer.y, apex.x, apex.y, "S-RIDGE");
  });
  const top = isoProject(0, roofApexY + 1800, 0);
  drawing.line(top.x, top.y - 1750, top.x, top.y, "S-RIDGE");
  drawing.circle(top.x, top.y + 300, 260, "S-RIDGE");

  const loadPathX = 11600;
  const stages = [
    { y: 1200, label: "01 FOUNDATION", layer: "S-FOUNDATION" },
    { y: 4200, label: "02 BASES + COLUMNS", layer: "S-COLUMN" },
    { y: 10400, label: "03 RING + CROSS BEAMS", layer: "S-BEAM" },
    { y: 13700, label: "04 DOUGONG", layer: "S-DOUGONG" },
    { y: 16600, label: "05 EAVE PURLIN", layer: "S-PURLIN" },
    { y: 20500, label: "06 RADIAL RAFTERS", layer: "S-RAFTER" },
    { y: 26100, label: "07 ROOF + RIDGES", layer: "S-ROOF" },
    { y: 29200, label: "08 FINIAL", layer: "S-RIDGE" },
  ];
  stages.forEach((stage, index) => {
    drawing.circle(loadPathX, stage.y, 130, stage.layer);
    drawing.text(loadPathX + 280, stage.y - 80, 190, stage.label, "A-ANNO");
    if (index < stages.length - 1) {
      drawing.line(loadPathX, stage.y + 160, loadPathX, stages[index + 1].y - 160, "A-DIMS");
      arrow(drawing, loadPathX, stages[index + 1].y - 160, { x: 0, y: 1 }, "A-DIMS", 110);
    }
  });

  sectionTitle(
    drawing,
    "A-401  EXPLODED AXONOMETRIC",
    "91 INDEPENDENT COMPONENTS / DATA-DRIVEN SUPPORT ORDER",
    -12400,
    29300,
  );
  addGeneralNotes(drawing, -12400, 28200);
  return drawing;
}

function titleBlock(drawing, minX, minY, maxX, maxY, sheetNumber, title) {
  drawing.rectangle(minX, minY, maxX, maxY, "A-TITLE");
  const titleHeight = 1150;
  drawing.line(minX, minY + titleHeight, maxX, minY + titleHeight, "A-TITLE");
  drawing.line(maxX - 7200, minY, maxX - 7200, minY + titleHeight, "A-TITLE");
  drawing.line(maxX - 2500, minY, maxX - 2500, minY + titleHeight, "A-TITLE");
  drawing.text(minX + 350, minY + 660, 250, "MODULAR HERITAGE ASSEMBLY", "A-TITLE");
  drawing.text(minX + 350, minY + 260, 160, "ABSTRACT OCTAGONAL TIMBER PAVILION", "A-ANNO");
  drawing.text(maxX - 6900, minY + 660, 240, title, "A-TITLE");
  drawing.text(maxX - 6900, minY + 260, 160, "UNITS MM | MODEL 1:1 | PLOT 1:50", "A-ANNO");
  drawing.text(maxX - 2150, minY + 560, 360, sheetNumber, "A-TITLE");
  drawing.text(maxX - 2150, minY + 220, 150, "CONCEPT / NOT FOR CONSTRUCTION", "A-ANNO");
}

function buildDrawingSet(drawings) {
  const combined = new CadDrawing("PAVILION DRAWING SET", {
    minX: -11000,
    minY: -38000,
    maxX: 48000,
    maxY: 15000,
  });
  const placements = [
    { drawing: drawings.plan, dx: 0, dy: 4000, frame: [-9500, -6500, 9500, 14500], title: "GENERAL PLAN", sheet: "A-101" },
    { drawing: drawings.elevation, dx: 26000, dy: 0, frame: [16000, -3000, 36000, 14500], title: "FRONT ELEVATION", sheet: "A-201" },
    { drawing: drawings.section, dx: 0, dy: -22000, frame: [-9500, -25000, 9500, -7500], title: "SECTION A-A", sheet: "A-301" },
    { drawing: drawings.exploded, dx: 29000, dy: -34500, frame: [13500, -37500, 46500, -7500], title: "EXPLODED AXONOMETRIC", sheet: "A-401" },
  ];
  placements.forEach(({ drawing, dx, dy, frame, title, sheet }) => {
    combined.entities.push(...drawing.cloneTranslated(dx, dy));
    titleBlock(combined, ...frame, sheet, title);
  });
  return combined;
}

function svgEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function drawingToSvgGroup(drawing, box, titleZh, titleEn) {
  const { minX, minY, maxX, maxY } = drawing.extents;
  const drawingWidth = maxX - minX;
  const drawingHeight = maxY - minY;
  const header = 42;
  const padding = 24;
  const scale = Math.min(
    (box.width - padding * 2) / drawingWidth,
    (box.height - header - padding * 2) / drawingHeight,
  );
  const ox = box.x + padding + (box.width - padding * 2 - drawingWidth * scale) / 2;
  const oy = box.y + header + padding + (box.height - header - padding * 2 - drawingHeight * scale) / 2;
  const transformPoint = (x, y) => ({
    x: ox + (x - minX) * scale,
    y: oy + (maxY - y) * scale,
  });
  const items = [];
  drawing.entities.forEach((entity) => {
    const style = LAYERS[entity.layer] ?? LAYERS["A-ANNO"];
    if (entity.kind === "LINE") {
      const a = transformPoint(entity.x1, entity.y1);
      const b = transformPoint(entity.x2, entity.y2);
      items.push(
        `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${style.svg}" stroke-width="${style.weight}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} />`,
      );
    } else if (entity.kind === "CIRCLE") {
      const center = transformPoint(entity.x, entity.y);
      items.push(
        `<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(entity.radius * scale)}" fill="none" stroke="${style.svg}" stroke-width="${style.weight}" />`,
      );
    } else if (entity.kind === "TEXT") {
      if (entity.height < 185 && entity.layer === "A-ANNO") return;
      const point = transformPoint(entity.x, entity.y);
      const anchor = entity.align === "CENTER" ? "middle" : entity.align === "RIGHT" ? "end" : "start";
      items.push(
        `<text x="${n(point.x)}" y="${n(point.y)}" fill="${style.svg}" font-size="${Math.max(5.5, entity.height * scale * 0.88)}" text-anchor="${anchor}" font-family="Arial, sans-serif" transform="rotate(${-entity.rotation} ${n(point.x)} ${n(point.y)})">${svgEscape(entity.value)}</text>`,
      );
    }
  });
  return `
    <g>
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="#fbfaf6" stroke="#cad2ce" />
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${header}" rx="8" fill="#102522" />
      <text x="${box.x + 16}" y="${box.y + 18}" fill="#69d9ca" font-size="10" font-family="Arial, sans-serif" letter-spacing="1.3">${titleEn}</text>
      <text x="${box.x + 16}" y="${box.y + 34}" fill="#eef5f2" font-size="13" font-family="Microsoft YaHei, sans-serif">${titleZh}</text>
      ${items.join("\n")}
    </g>
  `;
}

function buildSvgPreview(drawings) {
  const boxes = [
    { drawing: drawings.plan, box: { x: 34, y: 102, width: 850, height: 495 }, zh: "八角凉亭平面图", en: "A-101 · GENERAL PLAN" },
    { drawing: drawings.elevation, box: { x: 916, y: 102, width: 850, height: 495 }, zh: "正立面图", en: "A-201 · FRONT ELEVATION" },
    { drawing: drawings.section, box: { x: 34, y: 625, width: 850, height: 495 }, zh: "中心剖面 A-A", en: "A-301 · SECTION A-A" },
    { drawing: drawings.exploded, box: { x: 916, y: 625, width: 850, height: 495 }, zh: "爆炸轴测装配图", en: "A-401 · EXPLODED AXONOMETRIC" },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1180" viewBox="0 0 1800 1180">
  <rect width="1800" height="1180" fill="#e8ece8" />
  <rect x="0" y="0" width="1800" height="76" fill="#07110f" />
  <text x="34" y="31" fill="#65d9c9" font-size="11" font-family="Arial, sans-serif" letter-spacing="2">MODULAR HERITAGE ASSEMBLY · CAD DRAWING SET</text>
  <text x="34" y="57" fill="#f0f4f1" font-size="22" font-family="Microsoft YaHei, sans-serif">八角木构凉亭 CAD 图纸总览</text>
  <text x="1766" y="34" fill="#9eb4ae" font-size="10" text-anchor="end" font-family="Arial, sans-serif">DXF · MM · MODEL SPACE 1:1</text>
  <text x="1766" y="55" fill="#c89945" font-size="10" text-anchor="end" font-family="Microsoft YaHei, sans-serif">程序化概念模型 · 非施工图</text>
  ${boxes.map(({ drawing, box, zh, en }) => drawingToSvgGroup(drawing, box, zh, en)).join("\n")}
  <text x="34" y="1158" fill="#52645f" font-size="10" font-family="Microsoft YaHei, sans-serif">柱网半径 4750 · 屋檐半径 6650 · 檐檩标高 8500 · 屋顶顶点 10650 · 建议 A3 / 1:50 出图</text>
</svg>`;
}

function buildSchedule() {
  const rows = [["componentId", "componentType", "layer", "assemblyStep", "quantityGroup", "nameEn"]];
  const pushSeries = (count, makeId, type, layer, step, group, makeName) => {
    for (let index = 1; index <= count; index += 1) {
      rows.push([makeId(index), type, String(layer), String(step), group, makeName(index)]);
    }
  };
  rows.push(
    ["PAV-FND-01", "FOUNDATION", "0", "1", "FOUNDATION", "Lower octagonal terrace"],
    ["PAV-FND-02", "FOUNDATION", "0", "1", "FOUNDATION", "Recessed stone course"],
    ["PAV-FND-03", "FOUNDATION", "0", "1", "FOUNDATION", "Upper octagonal platform"],
  );
  pushSeries(8, (i) => `PAV-BASE-${String(i).padStart(2, "0")}`, "COLUMN_BASE", 1, 2, "COLUMN_BASE", (i) => `Column base ${i}`);
  pushSeries(8, (i) => `PAV-COL-${String(i).padStart(2, "0")}`, "COLUMN", 2, 3, "COLUMN", (i) => `Perimeter timber column ${i}`);
  pushSeries(8, (i) => `PAV-RING-${String(i).padStart(2, "0")}`, "BEAM", 3, 4, "RING_BEAM", (i) => `Octagonal ring beam ${i}`);
  pushSeries(4, (i) => `PAV-CROSS-${String(i).padStart(2, "0")}`, "BEAM", 3, 4, "CROSS_BEAM", (i) => `Diametral support beam ${i}`);
  pushSeries(8, (i) => `PAV-DG-${String(i).padStart(2, "0")}`, "DOUGONG", 4, 5, "DOUGONG", (i) => `Column-head bracket set ${i}`);
  pushSeries(8, (i) => `PAV-PURLIN-${String(i).padStart(2, "0")}`, "PURLIN", 5, 6, "EAVE_PURLIN", (i) => `Octagonal eave purlin ${i}`);
  rows.push(["PAV-KINGPOST-01", "COLUMN", "5", "6", "KINGPOST", "Central kingpost"]);
  pushSeries(16, (i) => `PAV-RAFTER-${String(i).padStart(2, "0")}`, "RAFTER", 6, 7, "RAFTER", (i) => `Radial rafter ${i}`);
  pushSeries(8, (i) => `PAV-ROOF-${String(i).padStart(2, "0")}`, "ROOF_PANEL", 7, 8, "ROOF_PANEL", (i) => `Pyramidal roof sector ${i}`);
  pushSeries(8, (i) => `PAV-RIDGE-${String(i).padStart(2, "0")}`, "RIDGE", 8, 9, "HIP_RIDGE", (i) => `Hip ridge ${i}`);
  pushSeries(8, (i) => `PAV-RAIL-${String(i).padStart(2, "0")}`, "ENCLOSURE", 2, 3, "RAILING", (i) => `Perimeter railing bay ${i}`);
  rows.push(
    ["PAV-FINIAL-01", "RIDGE", "9", "10", "FINIAL", "Finial base"],
    ["PAV-FINIAL-02", "RIDGE", "9", "10", "FINIAL", "Finial stem"],
    ["PAV-FINIAL-03", "RIDGE", "9", "10", "FINIAL", "Finial pearl"],
  );
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function writeZipPackage(fileNames, destination) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosTimestamp(new Date());

  for (const fileName of fileNames) {
    const source = await readFile(resolve(OUTPUT_DIR, fileName));
    const compressed = deflateRawSync(source, { level: 9 });
    const name = Buffer.from(fileName.replaceAll("\\", "/"), "utf8");
    const checksum = crc32(source);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(fileNames.length, 8);
  end.writeUInt16LE(fileNames.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeFile(destination, Buffer.concat([...localParts, centralDirectory, end]));
}

const drawings = {
  plan: buildPlan(),
  elevation: buildElevation(),
  section: buildSection(),
  exploded: buildExploded(),
};
const drawingSet = buildDrawingSet(drawings);

await mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all([
  writeFile(resolve(OUTPUT_DIR, "pavilion_plan_A101.dxf"), drawings.plan.toDxf(), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_front_elevation_A201.dxf"), drawings.elevation.toDxf(), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_section_AA_A301.dxf"), drawings.section.toDxf(), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_exploded_A401.dxf"), drawings.exploded.toDxf(), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_drawing_set.dxf"), drawingSet.toDxf(), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_drawing_set.svg"), buildSvgPreview(drawings), "utf8"),
  writeFile(resolve(OUTPUT_DIR, "pavilion_component_schedule.csv"), buildSchedule(), "utf8"),
  writeFile(
    resolve(OUTPUT_DIR, "README.txt"),
    [
      "OCTAGONAL PAVILION CAD DRAWING PACKAGE",
      "",
      "FORMAT",
      "- ASCII DXF, AutoCAD R12-compatible entity set",
      "- Drawing units: millimetres",
      "- Model space scale: 1:1",
      "- Recommended A3 plot scale: 1:50",
      "",
      "DRAWINGS",
      "- pavilion_plan_A101.dxf",
      "- pavilion_front_elevation_A201.dxf",
      "- pavilion_section_AA_A301.dxf",
      "- pavilion_exploded_A401.dxf",
      "- pavilion_drawing_set.dxf (all four drawings in one model space)",
      "- pavilion_drawing_set.svg (browser preview)",
      "- pavilion_component_schedule.csv (91 semantic components)",
      "",
      "SOURCE PARAMETERS",
      "- Column-grid radius: 4750 mm",
      "- Roof-eave radius: 6650 mm",
      "- Eave-purlin elevation: 8500 mm",
      "- Roof apex elevation: 10650 mm",
      "",
      "DISCLAIMER",
      "This is a procedural concept drawing derived from the interactive pavilion model.",
      "It is not a survey, structural calculation, permit set or construction document.",
      "",
    ].join("\r\n"),
    "utf8",
  ),
]);

await writeZipPackage(
  [
    "pavilion_plan_A101.dxf",
    "pavilion_front_elevation_A201.dxf",
    "pavilion_section_AA_A301.dxf",
    "pavilion_exploded_A401.dxf",
    "pavilion_drawing_set.dxf",
    "pavilion_drawing_set.svg",
    "pavilion_component_schedule.csv",
    "README.txt",
  ],
  resolve(OUTPUT_DIR, "pavilion_cad_package.zip"),
);

console.log(`Generated CAD package in ${OUTPUT_DIR}`);
