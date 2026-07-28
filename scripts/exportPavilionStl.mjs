import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { build as bundle } from "esbuild";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

const PROJECT_DIR = process.cwd();
const OUTPUT_DIR = resolve(PROJECT_DIR, "public/stl");
const SCALED_OUTPUT_DIR = resolve(PROJECT_DIR, "public/stl-40cm");
const TEMP_BUNDLE = resolve(PROJECT_DIR, "work/stl/PavilionBuilder.bundle.mjs");
const MILLIMETRES_PER_MODEL_UNIT = 1000;
const ROOF_PANEL_THICKNESS = 0.09;
const TARGET_ASSEMBLED_HEIGHT_MM = 400;

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
  group.scale.setScalar(options.modelToMillimetres ?? MILLIMETRES_PER_MODEL_UNIT);
  group.position.y = options.translateYMm ?? 0;
  group.updateMatrixWorld(true);
  return group;
}

function createSingleComponentGroup(component, options = {}) {
  const group = new THREE.Group();
  const clone = component.object.clone(true);
  clone.position.copy(component.data.originalPosition);
  group.add(clone);
  solidifyRoofPanels(group);
  group.scale.setScalar(options.modelToMillimetres ?? MILLIMETRES_PER_MODEL_UNIT);
  group.position.y = options.translateYMm ?? 0;
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
const sourceAssembled = createExportGroup(pavilion.components, { modelToMillimetres: 1 });
const sourceBounds = new THREE.Box3().setFromObject(sourceAssembled);
const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
const scaledModelToMillimetres = TARGET_ASSEMBLED_HEIGHT_MM / sourceHeight;
const scaledTranslateYMm = -sourceBounds.min.y * scaledModelToMillimetres;

const PROFILES = [
  {
    name: "Original full-size export",
    outputDir: OUTPUT_DIR,
    assembledFile: "pavilion_complete_assembled_mm.stl",
    explodedFile: "pavilion_complete_exploded_mm.stl",
    packageFile: "pavilion_stl_package_mm.zip",
    modelToMillimetres: MILLIMETRES_PER_MODEL_UNIT,
    translateYMm: 0,
    targetHeightMm: null,
  },
  {
    name: "Uniform 40 cm height export",
    outputDir: SCALED_OUTPUT_DIR,
    assembledFile: "pavilion_complete_assembled_h40cm_mm.stl",
    explodedFile: "pavilion_complete_exploded_h40cm_mm.stl",
    packageFile: "pavilion_stl_package_h40cm_mm.zip",
    modelToMillimetres: scaledModelToMillimetres,
    translateYMm: scaledTranslateYMm,
    targetHeightMm: TARGET_ASSEMBLED_HEIGHT_MM,
  },
];

function scalePosition(position, profile) {
  return position.toArray().map((value, index) => {
    const translated = value * profile.modelToMillimetres
      + (index === 1 ? profile.translateYMm : 0);
    return Number(translated.toFixed(3));
  });
}

async function exportProfile(profile) {
  const componentDir = resolve(profile.outputDir, "components");
  const systemDir = resolve(profile.outputDir, "systems");
  await mkdir(profile.outputDir, { recursive: true });
  await mkdir(componentDir, { recursive: true });
  await mkdir(systemDir, { recursive: true });

  const uniformScaleFromOriginal = profile.modelToMillimetres / MILLIMETRES_PER_MODEL_UNIT;
  const manifest = {
    format: "Binary STL",
    units: "millimetres",
    importUnits: "millimetres",
    sourceModel: "Abstract Octagonal Timber Pavilion",
    exportProfile: profile.name,
    componentCount: pavilion.components.length,
    uniformScaleFromOriginal: Number(uniformScaleFromOriginal.toFixed(9)),
    approximateScaleRatio: `1:${(1 / uniformScaleFromOriginal).toFixed(6)}`,
    targetAssembledHeightMm: profile.targetHeightMm,
    assembledBaseAtYZero: profile.targetHeightMm !== null,
    roofPanelSolidificationMm: Number(
      (ROOF_PANEL_THICKNESS * profile.modelToMillimetres).toFixed(3),
    ),
    assembled: null,
    exploded: null,
    systems: [],
    components: [],
  };
  const archiveEntries = [];

  async function writeStl(relativePath, object, label) {
    const absolutePath = resolve(profile.outputDir, relativePath);
    const buffer = stlBuffer(object, label);
    const audit = inspectBinaryStl(buffer);
    await writeFile(absolutePath, buffer);
    archiveEntries.push({ absolutePath, archivePath: relativePath });
    return audit;
  }

  const transform = {
    modelToMillimetres: profile.modelToMillimetres,
    translateYMm: profile.translateYMm,
  };
  manifest.assembled = await writeStl(
    profile.assembledFile,
    createExportGroup(pavilion.components, transform),
    profile.targetHeightMm ? "COMPLETE ASSEMBLED H40CM" : "COMPLETE ASSEMBLED",
  );
  manifest.exploded = await writeStl(
    profile.explodedFile,
    createExportGroup(pavilion.components, { ...transform, exploded: true }),
    profile.targetHeightMm ? "COMPLETE EXPLODED H40CM" : "COMPLETE EXPLODED",
  );

  for (const system of SYSTEMS) {
    const matching = pavilion.components.filter(({ data }) => system.types.includes(data.componentType));
    const relativePath = `systems/${system.file}`;
    const audit = await writeStl(
      relativePath,
      createExportGroup(matching, transform),
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
      createSingleComponentGroup(component, transform),
      component.data.componentId,
    );
    manifest.components.push({
      componentId: component.data.componentId,
      componentNameZh: component.data.componentNameZh,
      componentNameEn: component.data.componentNameEn,
      componentType: component.data.componentType,
      path: relativePath,
      originalPositionMm: scalePosition(component.data.originalPosition, profile),
      explodedPositionMm: scalePosition(component.data.explodedPosition, profile),
      ...audit,
    });
  }

  const manifestPath = resolve(profile.outputDir, "pavilion_stl_manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  archiveEntries.push({ absolutePath: manifestPath, archivePath: "pavilion_stl_manifest.json" });

  const readmePath = resolve(profile.outputDir, "README.txt");
  const size = manifest.assembled.boundsMm.size;
  await writeFile(
    readmePath,
    [
      "OCTAGONAL PAVILION STL PACKAGE",
      "",
      "UNITS AND SCALE",
      "- All coordinates are exported in millimetres.",
      "- STL does not store a unit declaration. Choose millimetres when importing.",
      `- Export profile: ${profile.name}.`,
      `- Uniform scale from original: ${uniformScaleFromOriginal.toFixed(9)} (${manifest.approximateScaleRatio}).`,
      `- Assembled bounds: ${size.x} x ${size.z} x ${size.y} mm (X x Z x Y).`,
      ...(profile.targetHeightMm
        ? [
            `- The assembled base is translated to Y=0 and the highest point is Y=${profile.targetHeightMm} mm (${profile.targetHeightMm / 10} cm).`,
          ]
        : []),
      "",
      "PRIMARY FILES",
      `- ${profile.assembledFile}: complete pavilion in assembly coordinates`,
      `- ${profile.explodedFile}: complete exploded-view mesh`,
      "- systems/*.stl: ten building-system groups in assembly coordinates",
      "- components/*.stl: 91 individually selectable component meshes",
      "- pavilion_stl_manifest.json: component IDs, positions, triangle counts and bounds",
      "",
      "RHINO",
      "- File > Import, select STL, and set model units to millimetres.",
      "- Use SplitDisjointMesh or the system/component files when separate editing is needed.",
      "",
      "MESH NOTE",
      `- The eight roof sectors are solidified to ${manifest.roofPanelSolidificationMm} mm after uniform scaling.`,
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

  await writeZipPackage(archiveEntries, resolve(profile.outputDir, profile.packageFile));
  return manifest;
}

const exportedProfiles = [];
for (const profile of PROFILES) {
  exportedProfiles.push({ profile, manifest: await exportProfile(profile) });
}

for (const { profile, manifest } of exportedProfiles) {
  const size = manifest.assembled.boundsMm.size;
  console.log(
    `${profile.name}: ${pavilion.components.length} components, ${SYSTEMS.length} systems, `
      + `${manifest.assembled.triangles} triangles, ${size.x} x ${size.z} x ${size.y} mm (X x Z x Y).`,
  );
}
