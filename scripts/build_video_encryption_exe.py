"""Build a standalone Windows GUI, including Python/Tk and FFmpeg.

Build prerequisite: python -m pip install pyinstaller
Usage: python -B scripts/build_video_encryption_exe.py [--ffmpeg-dir PATH] [--output PATH]
"""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg-dir", type=Path)
    parser.add_argument("--output", type=Path, help="Destination EXE (allows delivery while the old EXE is running).")
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("Build on Windows for a Windows executable.")
    scripts = Path(__file__).resolve().parent
    root = scripts.parent
    binaries = []
    for name in ("ffmpeg.exe", "ffprobe.exe"):
        found = args.ffmpeg_dir / name if args.ffmpeg_dir else shutil.which(name)
        if not found or not Path(found).is_file():
            parser.error(f"Missing {name}; install FFmpeg or use --ffmpeg-dir.")
        binaries.append(Path(found).resolve())
    license_path = binaries[0].parent.parent / "LICENSE"
    if not license_path.is_file():
        parser.error("FFmpeg distribution must include its LICENSE in the parent of bin.")
    # All specs, analysis caches and intermediate executables are removed on exit.
    with tempfile.TemporaryDirectory(prefix="hvideo-exe-build-") as temporary:
        temp = Path(temporary)
        command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                   "--onefile", "--windowed", "--noupx", "--name", "视频加密工具",
                   "--distpath", str(temp / "dist"), "--workpath", str(temp / "build"),
                   "--specpath", str(temp), "--add-data",
                   f"{scripts / 'video_encryption_v1.json'}{os.pathsep}.",
                   "--add-data", f"{license_path}{os.pathsep}licenses/ffmpeg"]
        for binary in binaries:
            command.extend(["--add-binary", f"{binary}{os.pathsep}tools"])
        command.append(str(scripts / "video_encryption_ui.py"))
        subprocess.run(command, check=True, cwd=root)
        output = args.output.resolve() if args.output else root / "视频加密工具.exe"
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp / "dist" / "视频加密工具.exe", output)
        print(f"Built: {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
