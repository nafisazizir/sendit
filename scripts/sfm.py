#!/usr/bin/env python3
"""
Sparse structure-from-motion over model/images with pycolmap (CPU).

  python3 scripts/sfm.py            # full run: features -> exhaustive matching -> mapping -> model/colmap/sparse-txt
  python3 scripts/sfm.py --skip-features --skip-matching   # re-run mapping only

Output: model/colmap/sparse-txt/{cameras,images,points3D}.txt for scripts/fit-faces.py
"""
import argparse, os, shutil, sys, time
import pycolmap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "model", "images")
WORK = os.path.join(ROOT, "model", "colmap")
DB = os.path.join(WORK, "database.db")
SPARSE = os.path.join(WORK, "sparse")
TXT = os.path.join(WORK, "sparse-txt")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-features", action="store_true")
    ap.add_argument("--skip-matching", action="store_true")
    ap.add_argument("--max-features", type=int, default=6000)
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    log("pycolmap", pycolmap.__version__, "images:", len(os.listdir(IMAGES)))

    if not a.skip_features:
        if os.path.exists(DB):
            os.remove(DB)
        opts = pycolmap.FeatureExtractionOptions()
        opts.sift.max_num_features = a.max_features
        opts.num_threads = -1
        opts.use_gpu = False
        log("extracting features")
        pycolmap.extract_features(DB, IMAGES, camera_mode=pycolmap.CameraMode.AUTO, camera_model="SIMPLE_RADIAL", extraction_options=opts, device=pycolmap.Device.cpu)

    if not a.skip_matching:
        log("matching (exhaustive)")
        mopts = pycolmap.FeatureMatchingOptions()
        mopts.num_threads = -1
        mopts.use_gpu = False
        pycolmap.match_exhaustive(DB, matching_options=mopts, device=pycolmap.Device.cpu)

    log("mapping")
    if os.path.exists(SPARSE):
        shutil.rmtree(SPARSE)
    os.makedirs(SPARSE)
    popts = pycolmap.IncrementalPipelineOptions()
    popts.min_model_size = 10
    maps = pycolmap.incremental_mapping(DB, IMAGES, SPARSE, options=popts)
    if not maps:
        log("no reconstruction")
        sys.exit(1)
    best_i, best = max(maps.items(), key=lambda kv: kv[1].num_reg_images())
    for i, rec in maps.items():
        log(f"model {i}: {rec.num_reg_images()} images, {rec.num_points3D()} points")
    log("best model", best_i, "summary:", best.summary())
    if os.path.exists(TXT):
        shutil.rmtree(TXT)
    os.makedirs(TXT)
    best.write_text(TXT)
    names = sorted(im.name for im in best.images.values())
    log("registered anchors:", [n for n in names if "anchor" in n])
    log("registered angles:", len([n for n in names if "angle" in n]), "video frames:", len([n for n in names if n.startswith("vid_")]))
    log("wrote", TXT)


if __name__ == "__main__":
    main()
