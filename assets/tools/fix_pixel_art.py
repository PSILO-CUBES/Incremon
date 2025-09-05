#!/usr/bin/env python3
"""
fix_pixel_art.py

Snap “fake” pixel-art to a true pixel grid and clamp shading so it matches sprites.

Supports:
  --coarsen N             : downscale 1/N then upscale ×N (nearest)
  --target WxH --scale S  : resize to WxH using integer upscale
  --palette K             : reduce to K colors (no dithering)
  --palette-from PATH     : use colors from reference image (overrides --palette)
  --posterize-bits N      : limit per-channel bits (e.g., 4 bits → 16 shades/channel)
  --value-steps N         : quantize brightness into N bands
  --outdir PATH           : force output root (ignored for _pre_processed inputs)

Output rules:
- If input path is under “…/_pre_processed/…”, outputs go to sibling “…/_processed/…”
  preserving subfolders.
- Else, outputs go to sibling “…/_processed” next to input folder.
"""

import argparse
import sys
from pathlib import Path
from typing import Tuple, List, Optional
from PIL import Image, ImageOps

VALID_EXTS = {'.png', '.jpg', '.jpeg'}


def parse_size(spec: str) -> Tuple[int, int]:
    if 'x' not in spec.lower():
        raise argparse.ArgumentError(None, "Size must be WxH, e.g., 3840x2160")
    w_str, h_str = spec.lower().split('x', 1)
    return int(w_str), int(h_str)


def find_images(path: str) -> List[Path]:
    p = Path(path)
    files: List[Path] = []
    if p.is_dir():
        for f in p.rglob("*"):
            if f.suffix.lower() in VALID_EXTS and f.is_file():
                files.append(f)
    else:
        if p.suffix.lower() in VALID_EXTS and p.exists():
            files.append(p)
    return files


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def coarsen_image(img: Image.Image, factor: int) -> Image.Image:
    if factor < 2:
        raise ValueError("coarsen factor must be >= 2")
    w, h = img.size
    base = img.resize((max(1, w // factor), max(1, h // factor)), Image.NEAREST)
    return base.resize((w, h), Image.NEAREST)


def target_with_integer_upscale(img: Image.Image, target: Tuple[int, int], scale: int) -> Image.Image:
    if scale < 1:
        raise ValueError("scale must be >= 1")
    tw, th = target
    if tw % scale != 0 or th % scale != 0:
        raise ValueError(f"target {tw}x{th} not divisible by scale {scale}")
    bw, bh = tw // scale, th // scale
    base = img.resize((bw, bh), Image.NEAREST)
    return base.resize((tw, th), Image.NEAREST)


def posterize_image(img: Image.Image, bits: int) -> Image.Image:
    bits = max(1, min(8, bits))
    rgb = img.convert('RGB')
    post = ImageOps.posterize(rgb, bits)
    out = post.convert('RGBA')
    if img.mode == 'RGBA':
        out.putalpha(img.split()[-1])
    return out


def value_quantize(img: Image.Image, steps: int) -> Image.Image:
    steps = max(2, steps)
    rgba = img.convert('RGBA')
    a = rgba.split()[-1]
    hsv = rgba.convert('RGB').convert('HSV')
    h, s, v = hsv.split()
    step = 255 // (steps - 1)
    v = v.point(lambda x, st=step: (x // st) * st)
    merged = Image.merge('HSV', (h, s, v)).convert('RGB').convert('RGBA')
    merged.putalpha(a)
    return merged


def reduce_palette(img: Image.Image, k: int) -> Image.Image:
    k = max(2, min(256, k))
    return img.convert('RGBA').quantize(colors=k, method=Image.FASTOCTREE, dither=Image.Dither.NONE).convert('RGBA')


def quantize_to_ref_palette(img: Image.Image, ref_path: Path, max_colors: Optional[int]) -> Image.Image:
    ref_img = Image.open(ref_path).convert('RGBA')
    if max_colors is None:
        pal_img = ref_img.convert('P', palette=Image.ADAPTIVE)
    else:
        pal_img = ref_img.quantize(colors=max_colors, method=Image.FASTOCTREE, dither=Image.Dither.NONE)
    return img.convert('RGBA').quantize(palette=pal_img, dither=Image.Dither.NONE).convert('RGBA')


def locate_pre_root(path_like: Path) -> Optional[Path]:
    base = path_like if path_like.is_dir() else path_like.parent
    parts = base.parts
    for i, part in enumerate(parts):
        if part == "_pre_processed":
            return Path(*parts[:i + 1])
    return None


def processed_root_for(arg_path: Path) -> Path:
    pre_root = locate_pre_root(arg_path)
    if pre_root:
        return pre_root.with_name("_processed")
    base = arg_path if arg_path.is_dir() else arg_path.parent
    return base.parent / "_processed"


def process_one(src: Path,
                arg_path: Path,
                coarsen: Optional[int],
                target: Optional[Tuple[int, int]],
                scale: int,
                poster_bits: Optional[int],
                val_steps: Optional[int],
                palette_k: Optional[int],
                palette_from: Optional[Path]) -> Path:
    img = Image.open(src).convert('RGBA')

    # Resample for grid
    if target is not None:
        img = target_with_integer_upscale(img, target, scale)
        suffix = f"_snap{scale}"
    elif coarsen is not None:
        img = coarsen_image(img, coarsen)
        suffix = f"_px{coarsen}"
    else:
        suffix = "_px"

    # Flatten shading
    if poster_bits is not None:
        img = posterize_image(img, poster_bits)
        suffix += f"_pst{poster_bits}"
    if val_steps is not None:
        img = value_quantize(img, val_steps)
        suffix += f"_val{val_steps}"

    # Palette quantization
    if palette_from is not None:
        img = quantize_to_ref_palette(img, palette_from, palette_k)
        suffix += "_pfrom"
    elif palette_k is not None:
        img = reduce_palette(img, palette_k)
        suffix += f"_pal{palette_k}"

    # Output path preserving structure
    out_root = processed_root_for(arg_path)
    pre_root = locate_pre_root(src)
    if pre_root:
        rel_sub = src.parent.relative_to(pre_root)
        out_dir = out_root / rel_sub
    else:
        base = arg_path if arg_path.is_dir() else arg_path.parent
        try:
            rel_sub = src.parent.relative_to(base)
            out_dir = out_root / rel_sub
        except ValueError:
            out_dir = out_root
    ensure_dir(out_dir)

    out_name = f"{src.stem}{suffix}.png"
    out_path = out_dir / out_name
    img.save(out_path, "PNG", optimize=True)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Make grid-perfect pixel art with shading control.")
    ap.add_argument("path", help="Input file or folder")
    ap.add_argument("--coarsen", type=int, help="Downscale 1/N then upscale ×N (N>=2).")
    ap.add_argument("--target", type=str, help="Final size WxH, used with --scale (integer).")
    ap.add_argument("--scale", type=int, default=2, help="Integer upscale factor for --target.")
    ap.add_argument("--posterize-bits", type=int, help="Posterize per-channel to N bits (e.g., 4).")
    ap.add_argument("--value-steps", type=int, help="Quantize brightness into N steps (e.g., 5).")
    ap.add_argument("--palette", type=int, help="Reduce to K colors (8..256).")
    ap.add_argument("--palette-from", type=str, help="Reference image to derive palette from (overrides --palette).")
    ap.add_argument("--outdir", type=str, help="Force output root (ignored if input under '_pre_processed').")

    args = ap.parse_args()

    target_size = None
    if args.target:
        try:
            target_size = parse_size(args.target)
        except Exception as e:
            print(f"[error] invalid --target: {e}", file=sys.stderr)
            sys.exit(2)

    if target_size is None and args.coarsen is None:
        print("[error] Provide either --coarsen or --target WxH (with --scale).", file=sys.stderr)
        sys.exit(2)

    arg_path = Path(args.path)
    inputs = find_images(args.path)
    if not inputs:
        print("[error] No images found.", file=sys.stderr)
        sys.exit(1)

    for src in inputs:
        out = process_one(
            src=src,
            arg_path=arg_path,
            coarsen=args.coarsen,
            target=target_size,
            scale=args.scale,
            poster_bits=args.posterize_bits,
            val_steps=args.value_steps,
            palette_k=args.palette,
            palette_from=Path(args.palette_from) if args.palette_from else None
        )
        print(f"[ok] {src} -> {out}")


if __name__ == "__main__":
    main()
