#!/bin/bash
# Meshy exports are 13-22 MB apiece: up to 365k triangles and a 2048px JPEG
# atlas. The game needs a dozen of these standing at bus stops on a phone,
# so each is decimated hard and the atlas dropped to 256px WebP. At the size
# a pedestrian occupies on screen there is nothing to see in the difference.
#
# The clothing mask is baked in after decimation, into the alpha channel of
# the atlas the game actually ships — see cloth-mask.py for why alpha.
set -e
SRC=/mnt/user-data/uploads/models
OUT=/home/claude/bus3d/build-peds
WORK=/tmp/peds-work
DEST=/home/claude/bus3d/public/models
GT="npx --yes @gltf-transform/cli@4.4.2"
# Per-model, because the Meshy exports differ by nearly a factor of two in
# source density and what matters is the triangle count that ships. About
# 2500 apiece: at a bus stop a figure is a hundred pixels tall, and past
# that the extra triangles are smaller than a pixel.
ERR=${ERR:-0.01}
TEX=${TEX:-512}
mkdir -p "$OUT" "$WORK" "$DEST"

names=(adult-male adult-female young-female child)
ratios=(0.0128 0.0149 0.0071 0.0123)
files=(
  "Meshy_AI_Realistic_adult_male__0820155923_texture.glb"
  "Meshy_AI_Realistic_adult_femal_0820160216_texture.glb"
  "Meshy_AI_Realistic_young_femal_0820162151_texture.glb"
  "Meshy_AI_Realistic_10_year_old_0820162633_texture.glb"
)

for k in "${!names[@]}"; do
  name="${names[$k]}"
  src="$SRC/${files[$k]}"
  w="$WORK/$name"
  rm -rf "$w"; mkdir -p "$w"
  echo "== $name"

  # Mask and island-dilate at the atlas's native 2048 and only then shrink:
  # doing it the other way round bakes the neighbouring-island bleed in
  # before there is anything to dilate over.
  $GT simplify "$src" "$w/a.glb" --ratio "${ratios[$k]}" --error "$ERR" >/dev/null 2>&1
  $GT copy "$w/a.glb" "$w/m.gltf" >/dev/null 2>&1

  python3 /home/claude/bus3d/tools/cloth-mask.py "$w/m.gltf" "$w/mask.png" "$TEX"

  # swap the masked atlas in, and throw away everything a 20px-tall
  # pedestrian cannot show: tangents, normal map, roughness map
  python3 - "$w" <<'PY'
import json, sys, pathlib
w = pathlib.Path(sys.argv[1])
g = json.loads((w / "m.gltf").read_text())
mat = g["materials"][0]
tex = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
img = g["textures"][tex]["source"]
g["images"][img]["uri"] = "mask.png"
g["images"][img]["mimeType"] = "image/png"
mat.pop("normalTexture", None)
mat["pbrMetallicRoughness"].pop("metallicRoughnessTexture", None)
mat["pbrMetallicRoughness"]["roughnessFactor"] = 0.92
mat["pbrMetallicRoughness"]["metallicFactor"] = 0.0
for m in g["meshes"]:
    for p in m["primitives"]:
        p["attributes"].pop("TANGENT", None)
(w / "m.gltf").write_text(json.dumps(g))
PY

  $GT copy "$w/m.gltf" "$w/d.glb" >/dev/null 2>&1
  $GT prune "$w/d.glb" "$w/e.glb" >/dev/null 2>&1
  # near-lossless alpha: the mask must survive, the colour need not
  $GT webp "$w/e.glb" "$w/f.glb" --quality 80 --effort 6 >/dev/null 2>&1
  # quantised positions plus meshopt: the loader already handles both
  $GT meshopt "$w/f.glb" "$OUT/$name.glb" --level medium >/dev/null 2>&1
  cp "$OUT/$name.glb" "$DEST/passenger-$name.glb"
  ls -la "$DEST/passenger-$name.glb" | awk '{printf "   -> passenger-%s.glb  %.0f kB\n", "'"$name"'", $5/1024}'
done
