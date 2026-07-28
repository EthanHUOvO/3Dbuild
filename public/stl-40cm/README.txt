OCTAGONAL PAVILION STL PACKAGE

UNITS AND SCALE
- All coordinates are exported in millimetres.
- STL does not store a unit declaration. Choose millimetres when importing.
- Export profile: Uniform 40 cm height export.
- Uniform scale from original: 0.030792918 (1:32.475000).
- Assembled bounds: 412.166 x 412.166 x 400 mm (X x Z x Y).
- The assembled base is translated to Y=0 and the highest point is Y=400 mm (40 cm).

PRIMARY FILES
- pavilion_complete_assembled_h40cm_mm.stl: complete pavilion in assembly coordinates
- pavilion_complete_exploded_h40cm_mm.stl: complete exploded-view mesh
- systems/*.stl: ten building-system groups in assembly coordinates
- components/*.stl: 91 individually selectable component meshes
- pavilion_stl_manifest.json: component IDs, positions, triangle counts and bounds

RHINO
- File > Import, select STL, and set model units to millimetres.
- Use SplitDisjointMesh or the system/component files when separate editing is needed.

MESH NOTE
- The eight roof sectors are solidified to 2.771 mm after uniform scaling.
- Other pieces retain the original Three.js primitive geometry.

DISCLAIMER
- This is a procedural concept model, not a surveyed or construction-certified model.
- Verify wall thicknesses, joints, tolerances and print scale before fabrication.
