"""Real Tk/FFmpeg coverage of resuming encryption with existing outputs."""
from pathlib import Path
import gc
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


class ExistingOutputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hvideo-existing-")
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = self.folder / "a.mkv"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=160x90:rate=10:duration=0.5", "-c:v", "libx264",
                        str(self.source)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        self.root = tk.Tk()
        self.root.withdraw()
        self.app = ui.EncryptionApp(self.root)
        self.addCleanup(self.dispose)
        self.app.mode.set("folder")
        self.app.source.set(str(self.folder))
        self.app.destination.set(str(self.folder))

    def dispose(self):
        if self.app.worker:
            self.app.control.cancelled.set()
            self.app.worker.join(10)
        self.root.after_cancel(self.app.poll_id)
        self.root.destroy()
        self.app = self.root = None
        gc.collect()

    def run_ui(self):
        self.app.start_button.invoke()
        deadline = time.monotonic() + 15
        while self.app.active:
            self.assertLess(time.monotonic(), deadline)
            self.root.update()
            time.sleep(0.01)
        if self.app.worker:
            self.app.worker.join(5)

    def test_mixed_batch_skips_existing_and_encrypts_remaining_then_all_skip(self):
        existing = self.folder / "a.hvideo"
        existing.write_bytes(b"existing output must not change")
        original = self.source.read_bytes()
        (self.folder / "b.mkv").write_bytes(original)
        (self.folder / "ignored.mp4").write_bytes(original)
        self.run_ui()
        self.assertEqual((self.app.completed, self.app.skipped, self.app.total), (1, 1, 2))
        self.assertEqual(self.app.table.set("0", "state"), "已存在，已跳过")
        self.assertEqual(self.app.table.set("1", "state"), "已完成")
        self.assertEqual(core.mp4_sample_types(self.folder / "b.hvideo"), [b"encv"])
        self.assertEqual(existing.read_bytes(), b"existing output must not change")
        self.assertEqual(self.source.read_bytes(), original)
        self.assertIn(str(existing), self.app.log.get("1.0", "end"))
        self.assertIn("已跳过 1", self.app.total_text.get())
        with patch.object(ui, "encrypt") as encrypt:
            self.run_ui()
            encrypt.assert_not_called()
        self.assertEqual((self.app.completed, self.app.skipped), (0, 2))
        self.assertEqual(self.app.current.get(), "全部已存在，已跳过")
        self.assertEqual(float(self.app.bar["value"]), 100)
        self.assertNotIn("disabled", self.app.start_button.state())
        self.assertNotIn("disabled", self.app.open_button.state())

    def test_single_existing_is_visible(self):
        (self.folder / "a.hvideo").write_bytes(b"keep")
        self.app.mode.set("file")
        self.app.source.set(str(self.source))
        with patch.object(ui, "encrypt") as encrypt:
            self.run_ui()
            encrypt.assert_not_called()
        self.assertEqual((self.app.total, self.app.skipped), (1, 1))
        self.assertIn("全部已存在", self.app.current.get())

    def test_failure_after_skip_preserves_skip_status(self):
        (self.folder / "a.hvideo").write_bytes(b"keep")
        (self.folder / "b.mkv").write_bytes(b"invalid video")
        self.run_ui()
        self.assertEqual(self.app.current.get(), "处理失败")
        self.assertEqual(self.app.table.set("0", "state"), "已存在，已跳过")
        self.assertEqual(self.app.table.set("1", "state"), "处理失败")
        self.assertIn("b.mkv", self.app.log.get("1.0", "end"))
        self.assertFalse((self.folder / "b.hvideo").exists())

    def test_cancel_after_skip_preserves_skip_status(self):
        (self.folder / "a.hvideo").write_bytes(b"keep")
        (self.folder / "b.mkv").write_bytes(self.source.read_bytes())
        with patch.object(ui, "encrypt", side_effect=core.Cancelled("任务已停止")):
            self.run_ui()
        self.assertEqual(self.app.current.get(), "已停止")
        self.assertEqual(self.app.table.set("0", "state"), "已存在，已跳过")
        self.assertEqual(self.app.table.set("1", "state"), "已停止")

    def test_target_directory_is_error_not_skipped(self):
        (self.folder / "a.hvideo").mkdir()
        self.run_ui()
        self.assertEqual(self.app.current.get(), "处理失败")
        self.assertEqual(self.app.skipped, 0)

    def test_cli_resume_and_overwrite_guard(self):
        (self.folder / "a.hvideo").write_bytes(b"keep")
        (self.folder / "b.mkv").write_bytes(self.source.read_bytes())
        result = subprocess.run([sys.executable, "-B", core.__file__, str(self.folder), str(self.folder)],
                                capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("skipped: 1", result.stdout)
        self.assertEqual((self.folder / "a.hvideo").read_bytes(), b"keep")
        self.assertEqual(core.mp4_sample_types(self.folder / "b.hvideo"), [b"encv"])
        # A file created after planning still cannot be overwritten by encrypt().
        with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
            core.encrypt(self.source, self.folder / "a.hvideo", "ffmpeg", "ffprobe", core.load_profile())
        self.assertEqual(list(self.folder.glob("*.partial")), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
