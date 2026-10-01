"""Real FFmpeg/Tk coverage for hidden single and batch HVideo decryption."""
from pathlib import Path
import gc
import json
import subprocess
import sys
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import encrypt_videos as core
import video_encryption_ui as ui


class DecryptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        cls.fixtures = tempfile.TemporaryDirectory(prefix="hvideo-decrypt-fixture-")
        cls.addClassCleanup(cls.fixtures.cleanup)
        cls.folder = Path(cls.fixtures.name)
        cls.profile = core.load_profile()
        cls.source = cls.folder / "original.mkv"
        ass = cls.folder / "lyrics.ass"
        ass.write_text("""[Script Info]
ScriptType: v4.00+
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,中文歌词 {\\k20}测试
""", encoding="utf-8")
        cls.run_command(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                         "testsrc2=size=160x90:rate=10:duration=0.6", "-f", "lavfi", "-i",
                         "sine=frequency=440:duration=0.6", "-f", "lavfi", "-i",
                         "sine=frequency=880:duration=0.6", "-i", str(ass),
                         "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s",
                         "-c:v", "libx264", "-c:a", "aac", "-c:s", "copy", str(cls.source)])
        cls.encrypted = cls.folder / "song.hvideo"
        core.encrypt(cls.source, cls.encrypted, "ffmpeg", "ffprobe", cls.profile, core.JobControl())

    @staticmethod
    def run_command(command):
        return subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8",
                              creationflags=subprocess.CREATE_NO_WINDOW).stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hvideo-decrypt-test-")
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)

    def decrypt(self, source=None, target=None, control=None, profile=None):
        core.decrypt(source or self.encrypted, target or self.output / "restored.mkv",
                     "ffmpeg", "ffprobe", profile or self.profile, control or core.JobControl())

    def make_app(self):
        self.root = tk.Tk()
        self.app = ui.EncryptionApp(self.root)
        self.addCleanup(self.dispose_app)
        self.root.update()

    def dispose_app(self):
        if self.app.worker:
            self.app.control.cancelled.set()
            self.app.worker.join(15)
        self.root.after_cancel(self.app.poll_id)
        self.root.destroy()
        self.root = self.app = None
        gc.collect()

    def unlock(self):
        for _ in range(10):
            self.app.title_label.event_generate("<Button-1>")
        self.app.decrypt_button.invoke()

    def run_ui(self):
        with patch.object(ui.messagebox, "showerror") as errors:
            self.app.start_button.invoke()
            errors.assert_not_called()
        deadline = time.monotonic() + 30
        while self.app.active:
            self.assertLess(time.monotonic(), deadline)
            self.root.update()
            time.sleep(0.01)
        self.app.worker.join(5)

    def test_roundtrip_preserves_decoded_video_both_audio_tracks_and_ass(self):
        original = self.encrypted.read_bytes()
        self.decrypt()
        restored = self.output / "restored.mkv"
        info = json.loads(self.run_command(["ffprobe", "-v", "error", "-show_streams",
                                          "-show_format", "-of", "json", str(restored)]))
        self.assertEqual([s["codec_name"] for s in info["streams"]], ["h264", "aac", "aac", "ass"])
        self.assertNotIn(core.ASS_METADATA_KEY, {k.lower() for k in info["format"].get("tags", {})})
        hashes = []
        for source, options in ((self.encrypted, ["-decryption_key", self.profile["key"]]), (restored, [])):
            hashes.append(self.run_command(["ffmpeg", "-v", "error", *options, "-i", str(source),
                                            "-map", "0:v", "-map", "0:a", "-f", "streamhash", "-"]))
        self.assertEqual(hashes[0], hashes[1])
        lyrics = self.run_command(["ffmpeg", "-v", "error", "-i", str(restored), "-map", "0:s",
                                   "-c:s", "copy", "-f", "ass", "-"])
        saved = core.probe(self.encrypted, "ffprobe", self.profile["key"])["format"]["tags"][core.ASS_METADATA_KEY]
        self.assertEqual([line for line in lyrics.splitlines() if line.startswith("Dialogue:")],
                         [line for line in saved.splitlines() if line.startswith("Dialogue:")])
        self.assertEqual(self.encrypted.read_bytes(), original)
        self.assertEqual(list(self.output.glob("*.partial")), [])

    def test_tenth_click_reveals_button_and_single_decryption_runs(self):
        self.make_app()
        self.assertEqual(self.app.decrypt_button.winfo_manager(), "")
        self.app.toggle_operation()
        self.assertFalse(self.app.decrypting)
        for _ in range(9):
            self.app.title_label.event_generate("<Button-1>")
        self.assertEqual(self.app.decrypt_button.winfo_manager(), "")
        self.app.title_label.event_generate("<Button-1>")
        self.assertEqual(self.app.decrypt_button.winfo_manager(), "pack")
        self.app.decrypt_button.invoke()
        self.assertTrue(self.app.decrypting)
        self.app.source.set(str(self.encrypted))
        self.app.destination.set(str(self.output))
        self.run_ui()
        self.assertEqual((self.app.completed, self.app.skipped, self.app.total), (1, 0, 1))
        self.assertTrue((self.output / "song.mkv").is_file())
        self.assertIn("新解密 1", self.app.status.get())
        self.app.decrypt_button.invoke()
        self.assertFalse(self.app.decrypting)
        self.assertEqual(str(self.app.start_button["text"]), "开始加密")

    def test_video_without_audio_or_lyrics_decrypts(self):
        source = self.output / "silent.mkv"
        encrypted = self.output / "silent.hvideo"
        restored = self.output / "restored.mkv"
        self.run_command(["ffmpeg", "-v", "error", "-i", str(self.source),
                          "-map", "0:v", "-c", "copy", str(source)])
        core.encrypt(source, encrypted, "ffmpeg", "ffprobe", self.profile, core.JobControl())
        self.decrypt(source=encrypted, target=restored)
        info = json.loads(self.run_command(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(restored)]))
        self.assertEqual([s["codec_name"] for s in info["streams"]], ["h264"])

    def test_batch_keeps_subfolders_skips_existing_and_ignores_plaintext(self):
        incoming = self.output / "incoming"
        (incoming / "sub").mkdir(parents=True)
        (incoming / "a.hvideo").write_bytes(self.encrypted.read_bytes())
        (incoming / "a.mkv").write_bytes(b"existing original")
        (incoming / "sub" / "b.HVIDEO").write_bytes(self.encrypted.read_bytes())
        (incoming / "ignore.mp4").write_bytes(b"ignore")
        self.make_app()
        self.unlock()
        self.app.mode.set("folder")
        self.app.source.set(str(incoming))
        self.app.destination.set(str(incoming))
        self.run_ui()
        self.assertEqual((self.app.completed, self.app.skipped, self.app.total), (1, 1, 2))
        self.assertEqual((incoming / "a.mkv").read_bytes(), b"existing original")
        self.assertTrue((incoming / "sub" / "b.mkv").is_file())
        self.assertEqual(self.app.table.set("0", "state"), "已存在，已跳过")
        self.run_ui()
        self.assertEqual((self.app.completed, self.app.skipped), (0, 2))

    def test_invalid_input_and_wrong_key_do_not_publish_or_leave_partial_files(self):
        invalid = self.output / "invalid.hvideo"
        invalid.write_bytes(b"not encrypted")
        with self.assertRaises(ValueError):
            self.decrypt(source=invalid)
        with self.assertRaises((ValueError, RuntimeError)):
            self.decrypt(profile={**self.profile, "key": "00" * 16})
        self.assertFalse((self.output / "restored.mkv").exists())
        self.assertEqual(list(self.output.glob("*.partial")), [])

    def test_cancel_during_decryption_cleans_partial_and_locks_operation(self):
        control = core.JobControl()
        def cancel(stage, _fraction):
            if stage == "decrypt":
                control.cancelled.set()
        control.on_progress = cancel
        with self.assertRaises(core.Cancelled):
            self.decrypt(control=control)
        self.assertEqual(list(self.output.iterdir()), [])
        self.make_app()
        self.unlock()
        self.app.active = True
        self.app.toggle_operation()
        self.assertTrue(self.app.decrypting)
        self.app.active = False

    def test_existing_and_concurrently_created_outputs_never_overwritten(self):
        target = self.output / "restored.mkv"
        target.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
            self.decrypt()
        target.unlink()
        def create_output(stage, _fraction):
            if stage == "verify":
                target.write_bytes(b"created during decryption")
        with self.assertRaises(FileExistsError):
            self.decrypt(control=core.JobControl(create_output))
        self.assertEqual(target.read_bytes(), b"created during decryption")
        self.assertEqual(list(self.output.glob("*.partial")), [])

    def test_plan_filters_extensions_preserves_tree_and_rejects_nested_destination(self):
        incoming = self.output / "in"
        (incoming / "sub").mkdir(parents=True)
        (incoming / "sub" / "song.hvideo").touch()
        (incoming / "plain.mkv").touch()
        destination = self.output / "out"
        self.assertEqual(core.plan(incoming, destination, decrypting=True),
                         [(incoming / "sub" / "song.hvideo", destination / "sub" / "song.mkv")])
        with self.assertRaisesRegex(ValueError, "directory trees"):
            core.plan(incoming, incoming / "nested", decrypting=True)
        with self.assertRaisesRegex(ValueError, "Only HVIDEO"):
            core.plan(incoming / "plain.mkv", destination / "plain.mkv", decrypting=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
