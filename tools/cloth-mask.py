#!/usr/bin/env python3
"""Bake a clothing mask into the alpha channel of a Meshy person's atlas.

Meshy exports one mesh with one material: skin, hair, eyes, shoes and
clothes all live in a single base-colour texture, so there is no clothing
material to recolour. What there *is* is geometry — the atlas is a UV
unwrap of a body, and a body's shirt and trousers occupy known heights on
it. Rasterising each triangle into texture space gives every texel the
height it came from; combining that with the texel's own colour separates
cloth from skin without ever touching a face.

The mask goes in alpha because the material is opaque and nothing else is
using it: no second texture, no second sampler, no extra download.
  alpha 0.00  leave exactly as authored (skin, hair, eyes, shoes)
  alpha 0.50  trousers
  alpha 1.00  shirt
"""
import base64
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SHIRT_LO, SHIRT_HI = 0.545, 0.815   # fraction of body height
LEG_LO, LEG_HI = 0.085, 0.520


def read_accessor(gltf, buf, idx):
    acc = gltf["accessors"][idx]
    view = gltf["bufferViews"][acc["bufferView"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt = {5120: np.int8, 5121: np.uint8, 5122: np.int16,
           5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc["componentType"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or ncomp * np.dtype(fmt).itemsize
    n = acc["count"]
    out = np.empty((n, ncomp), dtype=fmt)
    for k in range(n):
        off = start + k * stride
        out[k] = np.frombuffer(buf, dtype=fmt, count=ncomp, offset=off)
    return out.astype(np.float64) if fmt == np.float32 else out


def is_skin(rgb):
    """Skin, in the loose sense that covers every tone in these models."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    warm = (r >= g - 6) & (g >= b - 8)          # red >= green >= blue
    chroma = mx - mn
    lit = mx > 46
    # dark browns (hair, dark skin) and mid tans alike, but not grey or blue
    return warm & lit & (chroma > 12) & (chroma < 165)


def main(gltf_path, out_png, size=0):
    root = Path(gltf_path).parent
    gltf = json.loads(Path(gltf_path).read_text())
    bufdef = gltf["buffers"][0]
    uri = bufdef.get("uri", "")
    if uri.startswith("data:"):
        buf = base64.b64decode(uri.split(",", 1)[1])
    else:
        buf = (root / uri).read_bytes()

    prim = gltf["meshes"][0]["primitives"][0]
    pos = read_accessor(gltf, buf, prim["attributes"]["POSITION"])
    uv = read_accessor(gltf, buf, prim["attributes"]["TEXCOORD_0"])
    idx = read_accessor(gltf, buf, prim["indices"]).reshape(-1).astype(np.int64)
    tris = idx.reshape(-1, 3)

    mat = gltf["materials"][0]
    tex_i = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img_i = gltf["textures"][tex_i]["source"]
    img_uri = gltf["images"][img_i]["uri"]
    img = Image.open(root / img_uri).convert("RGB")
    W, H = img.size
    px = np.asarray(img).astype(np.int16)

    y = pos[:, 1]
    y0, y1 = y.min(), y.max()
    hnorm = (y - y0) / max(1e-6, y1 - y0)

    # ---- rasterise triangles into texture space, carrying body height ----
    height_map = np.full((H, W), -1.0, dtype=np.float32)
    u = uv[:, 0] * (W - 1)
    v = uv[:, 1] * (H - 1)          # glTF UV origin is top-left, as is PIL
    for a, b, c in tris:
        ux, uy = u[[a, b, c]], v[[a, b, c]]
        x0 = max(0, int(np.floor(ux.min())) - 1)
        x1 = min(W - 1, int(np.ceil(ux.max())) + 1)
        yy0 = max(0, int(np.floor(uy.min())) - 1)
        yy1 = min(H - 1, int(np.ceil(uy.max())) + 1)
        if x1 < x0 or yy1 < yy0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(yy0, yy1 + 1))
        d = ((uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]))
        if abs(d) < 1e-9:
            continue
        w0 = ((uy[1] - uy[2]) * (gx - ux[2]) + (ux[2] - ux[1]) * (gy - uy[2])) / d
        w1 = ((uy[2] - uy[0]) * (gx - ux[2]) + (ux[0] - ux[2]) * (gy - uy[2])) / d
        w2 = 1.0 - w0 - w1
        # a small negative tolerance closes the seams between adjacent islands
        inside = (w0 > -0.06) & (w1 > -0.06) & (w2 > -0.06)
        if not inside.any():
            continue
        hh = w0 * hnorm[a] + w1 * hnorm[b] + w2 * hnorm[c]
        sel = np.where(inside)
        height_map[gy[sel], gx[sel]] = hh[sel]

    covered = height_map >= 0
    skin = is_skin(px)
    shirt = covered & (height_map >= SHIRT_LO) & (height_map <= SHIRT_HI) & ~skin
    trous = covered & (height_map >= LEG_LO) & (height_map <= LEG_HI) & ~skin

    alpha = np.zeros((H, W), dtype=np.uint8)
    alpha[trous] = 128
    alpha[shirt] = 255

    # Meshy's unwrap is hundreds of small islands, and a quarter of the
    # atlas is the gaps between them. Shrink the atlas and bilinear
    # filtering drags those gaps -- and whatever island sits across them --
    # into the island edges, which is why faces came out flecked with
    # shoe-white. Growing each island a few texels outwards over its own
    # dead space gives the filter something correct to blend with.
    rgb = np.asarray(img).astype(np.uint8).copy()
    grow = covered.copy()
    for _ in range(4):
        src = grow
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            shifted = np.roll(np.roll(src, dy, axis=0), dx, axis=1)
            fill = shifted & ~grow
            if not fill.any():
                continue
            rgb[fill] = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)[fill]
            alpha[fill] = np.roll(np.roll(alpha, dy, axis=0), dx, axis=1)[fill]
            grow = grow | fill

    # Downsample here rather than letting the glTF toolchain do it. Every
    # image pipeline premultiplies alpha when it resizes, and premultiplying
    # by a mask that is zero over skin turns every face black. Averaging the
    # mask is wrong too: half of "shirt" and half of "nothing" is exactly the
    # value that means "trousers", which would fringe every collar. So the
    # two bands are resized as separate coverage fields and re-thresholded.
    if size and size != W:
        img_s = Image.fromarray(rgb, "RGB").resize((size, size), Image.LANCZOS)
        sh = Image.fromarray((shirt * 255).astype(np.uint8)).resize((size, size), Image.BOX)
        tr = Image.fromarray((trous * 255).astype(np.uint8)).resize((size, size), Image.BOX)
        rgb = np.asarray(img_s)
        alpha = np.zeros((size, size), dtype=np.uint8)
        alpha[np.asarray(tr) > 118] = 128
        alpha[np.asarray(sh) > 118] = 255

    rgba = np.dstack([rgb, alpha])
    Image.fromarray(rgba, "RGBA").save(out_png)
    pctc = covered.mean() * 100
    print(json.dumps({
        "texture": f"{W}x{H}", "out": f"{alpha.shape[1]}x{alpha.shape[0]}",
        "tris": int(len(tris)),
        "coveredPct": round(pctc, 1),
        "shirtPct": round(shirt.sum() / max(1, covered.sum()) * 100, 1),
        "trousersPct": round(trous.sum() / max(1, covered.sum()) * 100, 1),
        "untouchedPct": round((covered & ~shirt & ~trous).sum() / max(1, covered.sum()) * 100, 1),
    }))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 0)
