import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { build as bundle } from "esbuild";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

const PROJECT_DIR = process.cwd();
const OUTPUT_DIR = resolve(PROJECT_DIR, "public/stl");
const COMPONENT_DIR = resolve(OUTPUT_DIR, "components");
const SYSTEM_DIR = resolve(OUTPUT_DIR, "systems");
const TEMP_BUNDLE = resolve(PROJECT_DIR, "work/stl/PavilionBuilder.bundle.mjs");
const MILLIMETRES_PER_MODEL_UNIT = 1000;
const ROOF_PANEL_THICKNESS = 0.09;

const SYSTEMS = [
  { file: "01_foundation.stl", types: ["FOUNDATION"], label: "Stone foundation" },
  { file: "02_column_bases.stl", types: ["COLUMN_BASE"], label: "Column bases" },
  { file: "03_columns.stl", types: ["COLUMN"], label: "Perimeter columns and kingpost" },
  { file: "04_beam_frame.stl", types: ["BEAM"], label: "Ring and cross beams" },
  { file: "05_dougong.stl", types: ["DOUGONG"], label: "Dougong bracket sets" },
  { file: "06_eave_purlins.stl", types: ["PURLIN"], label: "Octagonal eave purlins" },
  { file: "07_radial_rafters.stl", types: ["RAFTER"], label: "Radial rafters" },
  { file: "08_roof_panels.stl", types: ["ROOF_PANEL"], label: "Solidified roof panels" },
  { file: "09_ridges_and_finial.stl", types: ["RIDGE"], label: "Hip ridges and finial" },
  { file: "10_railings.stl", types: ["ENCLOSURE"], label: "Perimeter railings" },
];

function sanitizeFileName(value) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function solidTrianglePrism(geometry, thickness) {
  const source = geometry.toNonIndexed();
  const position = source.getAttribute("position");
  if (position.count < 3) return geometry.clone();

  const a = new THREE.Vector3().fromBufferAttribute(position, 0);
  const b = new THREE.Vector3().fromBufferAttribute(position, 1);
  const c = new THREE.Vector3().fromBufferAttribute(position, 2);
  const normal = new THREE.Vector3()
    .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
    .normalize()
    .multiplyScalar(thickness / 2);
  const points = [
    a.clone().add(normal),
    b.clone().add(normal),
    c.clone().add(normal),
    a.clone().sub(normal),
    b.clone().sub(normal),
    c.clone().sub(normal),
  ];
  const positions = new Float32Array(points.flatMap(({ x, y, z }) => [x, y, z]));
  const indices = [
    0, 1, 2,
    5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  source.dispose();
  return result;
}

function solidifyRoofPanels(root) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.name.startsWith("PAV-ROOF-")) return;
    object.geometry = solidTrianglePrism(object.geometry, ROOF_PANEL_THICKNESS);
  });
}

function createExportGroup(components, options = {}) {
  const group = new THREE.Group();
  const allowedTypes = options.types ? new Set(options.types) : null;
  components.forEach(({ object, data }) => {
    if (allowedTypes && !allowedTypes.has(data.componentType)) return;
    const clone = object.clone(true);
    clone.position.copy(options.exploded ? data.explodedPosition : data.originalPosition);
    group.add(clone);
  });
  solidifyRoofPanels(group);
  group.scale.setScalar(MILLIMETRES_PER_MODEL_UNIT);
  group.updateMatrixWorld(true);
  return group;
}

function createSingleComponentGroup(component) {
  const group = new THREE.Group();
  const clone = component.object.clone(true);
  clone.position.copy(component.data.originalPosition);
  group.add(clone);
  solidifyRoofPanels(group);
  group.scale.setScalar(MILLIMETRES_PER_MODEL_UNIT);
  group.updateMatrixWorld(true);
  return group;
}

function stlBuffer(object, label) {
  const exporter = new STLExporter();
  object.updateMatrixWorld(true);
  const view = exporter.parse(object, { binary: true });
  const buffer = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  buffer.fill(0, 0, 80);
  buffer.write(`MODULAR PAVILION | ${label} | MM`, 0, 80, "ascii");
  return buffer;
}

function inspectBinaryStl(buffer) {
  if (buffer.length < 84) throw new Error("STL buffer is shorter than the binary header.");
  const triangles = buffer.readUInt32LE(80);
  const expectedLength = 84 + triangles * 50;
  if (buffer.length !== expectedLength) {
    throw new Error(`Invalid STL length: expected ${expectedLength}, received ${buffer.length}.`);
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const faceOffset = 84 + triangle * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = faceOffset + 12 + vertex * 12;
      const x = buffer.readFloatLE(vertexOffset);
      const y = buffer.readFloatLE(vertexOffset + 4);
      const z = buffer.readFloatLE(vertexOffset + 8);
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }
  }
  const finite = [min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite);
  if (!finite || triangles === 0) throw new Error("STL contains no finite triangles.");
  return {
    triangles,
    bytes: buffer.length,
    boundsMm: {
      min: Object.fromEntries(Object.entries(min).map(([key, value]) => [key, Number(value.toFixed(3))])),
      max: Object.fromEntries(Object.entries(max).map(([key, value]) => [key, Number(value.toFixed(3))])),
      size: {
        x: Number((max.x - min.x).toFixed(3)),
        y: Number((max.y - min.y).toFixed(3)),
        z: Number((max.z - min.z).toFixed(3)),
      },
    },
  };
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

async function writeZipPackage(entries, destination) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosTimestamp(new Date());

  for (const entry of entries) {
    const source = await readFile(entry.absolutePath);
    const compressed = deflateRawSync(source, { level: 9 });
    const name = Buffer.from(entry.archivePath.replaceAll("\\", "/"), "utf8");
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
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(destination, Buffer.concat([...localParts, centralDirectory, end]));
}

await mkdir(resolve(PROJECT_DIR, "work/stl"), { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(COMPONENT_DIR, { recursive: true });
await mkdir(SYSTEM_DIR, { recursive: true });

await bundle({
  entryPoints: [resolve(PROJECT_DIR, "src/pavilion/PavilionBuilder.ts")],
  outfile: TEMP_BUNDLE,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["three"],
  logLevel: "silent",
});

const { PavilionBuilder } = await import(`${pathToFileURL(TEMP_BUNDLE).href}?v=${Date.now()}`);
const pavilion = new PavilionBuilder().build();
const manifest = {
  format: "Binary STL",
  units: "millimetres",
  modelSpaceScale: "1:1",
  sourceModel: "Abstract Octagonal Timber Pavilion",
  componentCount: pavilion.components.length,
  roofPanelSolidificationMm: ROOF_PANEL_THICKNESS * MILLIMETRES_PER_MODEL_UNIT,
  assembled: null,
  exploded: null,
  systems: [],
  components: [],
};
const archiveEntries = [];

async function writeStl(relativePath, object, label) {
  const absolutePath = resolve(OUTPUT_DIR, relativePath);
  const buffer = stlBuffer(object, label);
  const audit = inspectBinaryStl(buffer);
  await writeFile(absolutePath, buffer);
  archiveEntries.push({ absolutePath, archivePath: relativePath });
  return audit;
}

manifest.assembled = await writeStl(
  "pavilion_complete_assembled_mm.stl",
  createExportGroup(pavilion.components),
  "COMPLETE ASSEMBLED",
);
manifest.exploded = await writeStl(
  "pavilion_complete_exploded_mm.stl",
  createExportGroup(pavilion.components, { exploded: true }),
  "COMPLETE EXPLODED",
);

for (const system of SYSTEMS) {
  const matching = pavilion.components.filter(({ data }) => system.types.includes(data.componentType));
  const relativePath = `systems/${system.file}`;
  const audit = await writeStl(
    relativePath,
    createExportGroup(matching),
    system.label.toUpperCase(),
  );
  manifest.systems.push({
    ...system,
    path: relativePath,
    componentCount: matching.length,
    ...audit,
  });
}

for (const component of pavilion.components) {
  const relativePath = `components/${sanitizeFileName(component.data.componentId)}.stl`;
  const audit = await writeStl(
    relativePath,
    createSingleComponentGroup(component),
    component.data.componentId,
  );
  manifest.components.push({
    componentId: component.data.componentId,
    componentNameZh: component.data.componentNameZh,
    componentNameEn: component.data.componentNameEn,
    componentType: component.data.componentType,
    path: relativePath,
    originalPositionMm: component.data.originalPosition
      .toArray()
      .map((value) => Number((value * MILLIMETRES_PER_MODEL_UNIT).toFixed(3))),
    explodedPositionMm: component.data.explodedPosition
      .toArray()
      .map((value) => Number((value * MILLIMETRES_PER_MODEL_UNIT).toFixed(3))),
    ...audit,
  });
}

const manifestPath = resolve(OUTPUT_DIR, "pavilion_stl_manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
archiveEntries.push({ absolutePath: manifestPath, archivePath: "pavilion_stl_manifest.json" });

const readmePath = resolve(OUTPUT_DIR, "README.txt");
await writeFile(
  readmePath,
  [
    "OCTAGONAL PAVILION STL PACKAGE",
    "",
    "UNITS",
    "- All coordinates are exported in millimetres.",
    "- STL does not store a unit declaration. Choose millimetres when importing.",
    "",
    "PRIMARY FILES",
    "- pavilion_complete_assembled_mm.stl: complete pavilion in assembly coordinates",
    "- pavilion_complete_exploded_mm.stl: complete exploded-view mesh",
    "- systems/*.stl: ten building-system groups in assembly coordinates",
    "- components/*.stl: 91 individually selectable component meshes",
    "- pavilion_stl_manifest.json: component IDs, positions, triangle counts and bounds",
    "",
    "RHINO",
    "- File > Import, select STL, and set model units to millimetres.",
    "- Use SplitDisjointMesh or the system/component files when separate editing is needed.",
    "",
    "MESH NOTE",
    `- The eight programmatic roof surface sectors are solidified to ${ROOF_PANEL_THICKNESS * MILLIMETRES_PER_MODEL_UNIT} mm for STL export.`,
    "- Other pieces retain the original Three.js primitive geometry.",
    "",
    "DISCLAIMER",
    "- This is a procedural concept model, not a surveyed or construction-certified model.",
    "- Verify wall thicknesses, joints, tolerances and print scale before fabrication.",
    "",
  ].join("\r\n"),
  "utf8",
);
archiveEntries.push({ absolutePath: readmePath, archivePath: "README.txt" });

await writeZipPackage(archiveEntries, resolve(OUTPUT_DIR, "pavilion_stl_package_mm.zip"));

console.log(
  `Generated ${pavilion.components.length} component STL files, ${SYSTEMS.length} system STL files, and 2 complete STL files.`,
);
console.log(
  `Assembled mesh: ${manifest.assembled.triangles} triangles, ${manifest.assembled.boundsMm.size.x} x ${manifest.assembled.boundsMm.size.z} x ${manifest.assembled.boundsMm.size.y} mm (X x Z x Y).`,
);
