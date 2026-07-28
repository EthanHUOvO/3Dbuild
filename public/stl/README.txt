OCTAGONAL PAVILION STL PACKAGE

UNITS
- All coordinates are exported in millimetres.
- STL does not store a unit declaration. Choose millimetres when importing.

PRIMARY FILES
- pavilion_complete_assembled_mm.stl: complete pavilion in assembly coordinates
- pavilion_complete_exploded_mm.stl: complete exploded-view mesh
- systems/*.stl: ten building-system groups in assembly coordinates
- components/*.stl: 91 individually selectable component meshes
- pavilion_stl_manifest.json: component IDs, positions, triangle counts and bounds

RHINO
- File > Import, select STL, and set model units to millimetres.
- Use SplitDisjointMesh or the system/component files when separate editing is needed.

MESH NOTE
- The eight programmatic roof surface sectors are solidified to 90 mm for STL export.
- Other pieces retain the original Three.js primitive geometry.

DISCLAIMER
- This is a procedural concept model, not a surveyed or construction-certified model.
- Verify wall thicknesses, joints, tolerances and print scale before fabrication.
