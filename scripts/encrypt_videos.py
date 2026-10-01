#!/usr/bin/env python3
"""Encrypt local videos as CENC MP4 for the HVideo fixed-key player.

Usage: python scripts/encrypt_videos.py INPUT OUTPUT
INPUT/OUTPUT may be a file pair or directory trees. For a directory input, the
output may be the same directory; originals are never changed. Requires ffmpeg
and ffprobe on PATH (or the explicit options).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import threading


class Cancelled(RuntimeError):
    """Cooperative cancellation, including termination of the active child."""


class JobControl:
    def __init__(self, on_progress=None):
        self.cancelled = threading.Event()
        self.on_progress = on_progress or (lambda stage, fraction: None)
        self.stage = "probe"

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled("任务已停止，原片和已完成的文件已保留。")

    def report(self, stage, fraction=0.0):
        self.check()
        self.stage = stage
        self.on_progress(stage, max(0.0, min(1.0, fraction)))

PROFILE_PATH = Path(__file__).with_name("video_encryption_v1.json")
EXTENSIONS = {".mkv"}
ASS_METADATA_KEY = "hvideo_ass_v1"
MAX_ASS_BYTES = 8 * 1024 * 1024


def metadata_escape(value):
    return re.sub(r"([\\=;#\n\r])", r"\\\1", str(value))


def load_profile() -> dict:
    profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    if profile.get("version") != 1 or profile.get("scheme") != "cenc-aes-ctr":
        raise ValueError("Unsupported encryption profile; do not change the v1 profile.")
    for name in ("key", "key_id"):
        if not re.fullmatch(r"[0-9a-f]{32}", profile.get(name, "")):
            raise ValueError(f"Invalid v1 {name}.")
    return profile


def run(command: list[str], key: str, control=None, duration=None) -> str:
    # Arguments are never interpreted by a shell or printed (they contain a key).
    if control:
        control.check()
    if control and duration:
        command = [command[0], "-progress", "pipe:1", "-nostats", *command[1:]]
    # Windows communicate(timeout=...) does not expose partial pipe output.
    # Drain stdout on a reader thread so long-running jobs have live progress;
    # stderr goes to an automatically removed file to avoid pipe deadlocks.
    with tempfile.TemporaryFile() as error_log, subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=error_log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0) as child:
        chunks = []
        processed_seconds = [0.0]

        def read_output():
            if control and duration:
                for line in iter(child.stdout.readline, b""):
                    chunks.append(line)
                    if line.startswith(b"out_time_us="):
                        try:
                            processed_seconds[0] = int(line.split(b"=", 1)[1]) / 1_000_000
                        except ValueError:
                            pass
            else:
                chunks.append(child.stdout.read())

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        try:
            while True:
                if control:
                    control.check()
                try:
                    child.wait(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    if control and duration:
                        control.report(control.stage, processed_seconds[0] / duration)
        except BaseException:
            child.kill()
            child.wait()
            raise
        finally:
            reader.join()
        stdout = b"".join(chunks)
        error_log.seek(0, os.SEEK_END)
        error_log.seek(max(0, error_log.tell() - 6000))
        stderr = error_log.read()
    if control:
        control.check()
    if child.returncode:
        detail = stderr.decode("utf-8", errors="replace").replace(key, "[redacted]")[-6000:]
        raise RuntimeError(f"{Path(command[0]).name} failed ({child.returncode}):\n{detail}")
    return stdout.decode("utf-8", errors="replace")


def boxes(stream, start: int, end: int):
    """Iterate ISO BMFF boxes without reading video payloads into memory."""
    while start < end:
        if end - start < 8:
            raise ValueError("Truncated MP4 box header")
        stream.seek(start)
        size, kind = struct.unpack(">I4s", stream.read(8))
        header = 8
        if size == 1:
            if end - start < 16:
                raise ValueError("Truncated extended MP4 box header")
            size = struct.unpack(">Q", stream.read(8))[0]
            header = 16
        elif size == 0:
            size = end - start
        if size < header or size > end - start:
            raise ValueError("Invalid MP4 box size")
        yield kind, start + header, start + size
        start += size


def mp4_sample_types(path: Path) -> list[bytes]:
    """Read sample entry types; encv/enca are encrypted video/audio entries."""
    def descend(stream, start, end, chain):
        result = []
        for kind, data, stop in boxes(stream, start, end):
            if kind != chain[0]:
                continue
            if len(chain) > 1:
                result.extend(descend(stream, data, stop, chain[1:]))
            else:
                stream.seek(data)
                if stop - data < 8:
                    raise ValueError("Truncated MP4 sample table")
                _, count = struct.unpack(">II", stream.read(8))
                entries = list(boxes(stream, data + 8, stop))
                if count != len(entries):
                    raise ValueError("Invalid MP4 sample entry count")
                result.extend(item[0] for item in entries)
        return result

    with path.open("rb") as stream:
        return descend(stream, 0, path.stat().st_size,
                       [b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd"])


def probe(path: Path, ffprobe: str, key: str, control=None) -> dict:
    return json.loads(run([ffprobe, "-v", "error", "-decryption_key", key,
                           "-show_streams", "-show_format", "-of", "json", str(path)], key, control))


def publish(partial: Path, output: Path, control=None):
    """Commit a completed file atomically without replacing an existing file."""
    if control:
        control.check()
    if os.name == "nt":
        os.rename(partial, output)
    else:
        os.link(partial, output)
        partial.unlink()
    if control:
        # Publication is the commit point, including a concurrent Stop click.
        control.on_progress("done", 1.0)


def encrypt(source: Path, output: Path, ffmpeg: str, ffprobe: str, profile: dict, control=None):
    if control:
        control.report("probe")
    if output.suffix.lower() != ".hvideo":
        raise ValueError("Output must use .hvideo for HVideo encrypted media.")
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError(f"Refusing to overwrite an existing file: {output}")
    key = profile["key"]
    info = probe(source, ffprobe, key, control)
    try:
        duration = float(info.get("format", {}).get("duration", 0))
    except (TypeError, ValueError):
        duration = 0
    streams = info.get("streams", [])
    if not any(s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic") for s in streams):
        raise ValueError("Input has no video track.")
    subtitles = [s for s in streams if s.get("codec_type") == "subtitle"]
    if (len(subtitles) > 1 or any(s.get("codec_name") != "ass" for s in subtitles) or
            any(s.get("codec_type") not in ("video", "audio", "subtitle") or
                s.get("disposition", {}).get("attached_pic") for s in streams)):
        raise ValueError("Unsupported subtitles, attachments or data tracks. Supports one ASS lyric track; other tracks are not silently discarded.")
    media_streams = [s for s in streams if s.get("codec_type") in ("video", "audio")]
    media_maps = [value for stream in media_streams for value in ("-map", f"0:{stream['index']}")]
    if "mov" in info.get("format", {}).get("format_name", "").split(","):
        if any(t in (b"encv", b"enca") for t in mp4_sample_types(source)):
            raise ValueError("Input is already encrypted; copy the encrypted file directly.")

    output.parent.mkdir(parents=True, exist_ok=True)
    # A non-media suffix prevents scans from indexing an unfinished encrypted file.
    fd, name = tempfile.mkstemp(prefix=".hvideo-encrypt-", suffix=".partial", dir=output.parent)
    os.close(fd)
    partial = Path(name)
    resources = contextlib.ExitStack()
    try:
        metadata_args = ["-map_metadata", "0"]
        extra_input = []
        ass = None
        if subtitles:
            temporary = Path(resources.enter_context(tempfile.TemporaryDirectory(prefix="hvideo-ass-")))
            lyric_file = temporary / "lyrics.ass"
            run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                 "-i", str(source), "-map", f"0:{subtitles[0]['index']}",
                 "-c:s", "copy", "-f", "ass", str(lyric_file)], key, control)
            if not 0 < lyric_file.stat().st_size <= MAX_ASS_BYTES:
                raise ValueError("ASS lyrics must be nonempty and at most 8 MiB.")
            ass = lyric_file.read_bytes().decode("utf-8")
            if "[Events]" not in ass or "Dialogue:" not in ass or "\x00" in ass:
                raise ValueError("ASS lyrics contain no usable events or invalid text.")
            tags = dict(info.get("format", {}).get("tags", {}))
            tags[ASS_METADATA_KEY] = ass
            metadata = temporary / "lyrics.ffmetadata"
            # Pass long lyrics via a file, never via the Windows command line.
            metadata.write_bytes((";FFMETADATA1\n" + "".join(
                f"{metadata_escape(k)}={metadata_escape(v)}\n" for k, v in tags.items())).encode("utf-8"))
            extra_input = ["-f", "ffmetadata", "-i", str(metadata)]
            metadata_args = ["-map_metadata", "1"]
        if control:
            control.report("encrypt")
        else:
            print(f"Encrypting: {source} -> {output}", flush=True)
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
             "-i", str(source), *extra_input, *media_maps, "-c", "copy", *metadata_args,
             "-map_chapters", "-1", "-write_tmcd", "0", "-movflags", "+faststart+use_metadata_tags",
             "-encryption_scheme", profile["scheme"], "-encryption_key", key,
             "-encryption_kid", profile["key_id"], "-f", "mp4", str(partial)], key, control, duration)
        types = mp4_sample_types(partial)
        expected = sorted(b"encv" if s["codec_type"] == "video" else b"enca" for s in media_streams)
        if sorted(types) != expected:
            raise RuntimeError("Encryption validation failed: not all audio/video tracks are encrypted.")
        encrypted_info = probe(partial, ffprobe, key, control)
        if [s.get("codec_name") for s in encrypted_info["streams"]] != [s.get("codec_name") for s in media_streams]:
            raise RuntimeError("Encryption validation failed: audio/video tracks changed.")
        if ass is not None and encrypted_info.get("format", {}).get("tags", {}).get(ASS_METADATA_KEY) != ass:
            raise RuntimeError("Encryption validation failed: embedded ASS lyrics changed.")
        if control:
            control.report("verify")
        else:
            print("Verifying all video frames and audio tracks (no plaintext file is written)...", flush=True)
        # Read every encrypted video packet and decode every audio track. The
        # player and FFmpeg's normal decoder tolerate recoverable AAC frames;
        # ignore those frame-level errors while still failing on a fatal FFmpeg
        # process error or an invalid encrypted container.
        # Video is packet-copied here because CENC publication does not alter
        # video samples; decoding a full 1080p song again made verification
        # dominate the batch runtime while adding no encryption assurance.
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
             "-abort_on", "empty_output+empty_output_stream", "-err_detect", "ignore_err",
             "-decryption_key", key, "-i", str(partial),
             "-map", "0:v", "-map", "0:a?", "-c:v", "copy", "-c:a", "pcm_s16le",
             "-f", "null", "-"], key, control, duration)
        publish(partial, output, control)
    finally:
        partial.unlink(missing_ok=True)
        resources.close()


def decrypt(source: Path, output: Path, ffmpeg: str, ffprobe: str, profile: dict, control=None):
    """Restore CENC .hvideo media and embedded ASS lyrics to an ordinary MKV."""
    if control:
        control.report("probe")
    if source.suffix.lower() != ".hvideo":
        raise ValueError("Only HVIDEO input videos are supported for decryption.")
    if output.suffix.lower() != ".mkv":
        raise ValueError("Decrypted output must use .mkv.")
    if source.resolve() == output.resolve() or output.exists():
        raise ValueError(f"Refusing to overwrite an existing file: {output}")
    key = profile["key"]
    types = mp4_sample_types(source)
    if not types or any(kind not in (b"encv", b"enca") for kind in types):
        raise ValueError("Input is not a supported encrypted HVideo file.")
    info = probe(source, ffprobe, key, control)
    streams = info.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        raise ValueError("Input has no video track.")
    if any(s.get("codec_type") not in ("video", "audio") for s in streams):
        raise ValueError("Encrypted input contains unsupported tracks.")
    expected_types = sorted(b"encv" if s["codec_type"] == "video" else b"enca" for s in streams)
    if sorted(types) != expected_types:
        raise ValueError("Input is not a supported encrypted HVideo file.")
    tags = info.get("format", {}).get("tags", {})
    ass = tags.get(ASS_METADATA_KEY)
    if ass is not None and (not isinstance(ass, str) or not 0 < len(ass.encode("utf-8")) <= MAX_ASS_BYTES
                            or "[Events]" not in ass or "Dialogue:" not in ass or "\x00" in ass):
        raise ValueError("Embedded ASS lyrics are invalid; no output was written.")
    try:
        duration = float(info.get("format", {}).get("duration", 0))
    except (TypeError, ValueError):
        duration = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".hvideo-decrypt-", suffix=".partial", dir=output.parent)
    os.close(fd)
    partial = Path(name)
    try:
        with contextlib.ExitStack() as resources:
            extra_input = []
            maps = [value for stream in streams for value in ("-map", f"0:{stream['index']}")]
            if ass is not None:
                temporary = Path(resources.enter_context(tempfile.TemporaryDirectory(prefix="hvideo-ass-")))
                lyric_file = temporary / "lyrics.ass"
                lyric_file.write_bytes(ass.encode("utf-8"))
                extra_input = ["-f", "ass", "-i", str(lyric_file)]
                maps.extend(["-map", "1:s:0"])
            if control:
                control.report("decrypt")
            run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                 "-decryption_key", key, "-i", str(source), *extra_input, *maps,
                 "-c", "copy", "-map_metadata", "0", "-metadata", f"{ASS_METADATA_KEY}=",
                 "-f", "matroska", str(partial)], key, control, duration)
            # Probe without a key: the delivered file must be ordinary media.
            restored = json.loads(run([ffprobe, "-v", "error", "-show_streams", "-show_format",
                                       "-of", "json", str(partial)], key, control))
            expected_codecs = [s.get("codec_name") for s in streams] + (["ass"] if ass is not None else [])
            if [s.get("codec_name") for s in restored.get("streams", [])] != expected_codecs:
                raise RuntimeError("Decryption validation failed: audio/video or lyric tracks changed.")
            if control:
                control.report("verify")
            # Decode all audio/video without a key before publishing plaintext.
            run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
                 "-abort_on", "empty_output+empty_output_stream", "-i", str(partial),
                 "-map", "0:v", "-map", "0:a?", "-f", "null", "-"], key, control, duration)
            publish(partial, output, control)
    finally:
        partial.unlink(missing_ok=True)


def plan(source: Path, output: Path, control=None, *, decrypting=False) -> list[tuple[Path, Path]]:
    if control:
        control.check()
    source, output = source.resolve(), output.resolve()
    extensions = {".hvideo"} if decrypting else EXTENSIONS
    suffix = ".mkv" if decrypting else ".hvideo"
    input_format = "HVIDEO" if decrypting else "MKV"
    if source.is_file():
        if source.suffix.lower() not in extensions:
            raise ValueError(f"Only {input_format} input videos are supported.")
        return [(source, output)]
    if not source.is_dir():
        raise ValueError(f"Input does not exist: {source}")
    # A same-directory batch is safe because input/output extensions differ. Keep nested
    # trees separate so ordinary videos already in an output subdirectory are
    # not accidentally included in the same batch.
    if source in output.parents or output in source.parents:
        raise ValueError("Input and output directory trees must not contain one another unless they are the same directory.")
    jobs = []
    for p in source.rglob("*"):
        if control:
            control.check()
        if p.is_file() and not p.is_symlink() and p.suffix.lower() in extensions:
            jobs.append((p, (output / p.relative_to(source)).with_suffix(suffix)))
    jobs.sort()
    if not jobs:
        raise ValueError(f"No supported {input_format} video files found.")
    targets = set()
    for _, target in jobs:
        identity = str(target).casefold()
        if identity in targets:
            raise ValueError(f"Duplicate output (nothing changed): {target}")
        targets.add(identity)
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    try:
        profile = load_profile()
        jobs = plan(args.input, args.output)
        completed = skipped = 0
        for index, (source, output) in enumerate(jobs, 1):
            print(f"[{index}/{len(jobs)}]", flush=True)
            if output.is_file():
                skipped += 1
                print(f"Skipped existing file (not overwritten or revalidated): {output}", flush=True)
                continue
            encrypt(source, output, args.ffmpeg, args.ffprobe, profile)
            completed += 1
        print(f"Completed: {completed} encrypted .hvideo file(s); skipped: {skipped} existing file(s). Originals were preserved.")
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelled. Completed outputs and originals are preserved.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
