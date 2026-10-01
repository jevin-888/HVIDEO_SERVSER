"""Check rendered task rows at Windows display scales, without media fixtures."""
from pathlib import Path
import gc
import sys
import tkinter as tk
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from video_encryption_ui import EncryptionApp


class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)

    def test_rendered_rows_fit_font_at_display_scales(self):
        for percent in (100, 125, 150, 200, 250, 300):
            with self.subTest(scale=percent):
                root = tk.Tk()
                root.tk.call("tk", "scaling", (96 / 72) * percent / 100)
                app = EncryptionApp(root)
                try:
                    for index in range(25):
                        app.table.insert("", "end", iid=str(index), values=(
                            f"D:/歌曲/song001/{60000104 + index}.mkv",
                            ("已完成", "正在校验", "等待处理")[index % 3]))
                    root.update()
                    font_height = app.table_font.metrics("linespace")
                    first, second = app.table.bbox("0"), app.table.bbox("1")
                    self.assertTrue(first and second, "First rows must be visible")
                    self.assertGreaterEqual(first[3], font_height + 6)
                    self.assertGreaterEqual(second[1] - first[1], font_height + 6)
                    self.assertGreaterEqual(second[1], first[1] + first[3])
                    self.assertGreaterEqual(app.table.column("state", "width"),
                                            app.table_font.measure("已存在，已跳过"))
                    for _ in range(10):
                        app.title_label.event_generate("<Button-1>")
                    app.decrypt_button.invoke()
                    root.update()
                    self.assertTrue(app.decrypt_button.winfo_ismapped())
                    self.assertLessEqual(app.decrypt_button.winfo_x() + app.decrypt_button.winfo_width(),
                                         app.stop_button.winfo_x())
                    self.assertLessEqual(app.stop_button.winfo_x() + app.stop_button.winfo_width(),
                                         app.open_button.winfo_x())
                    app.table.see("24")
                    root.update()
                    last = app.table.bbox("24")
                    self.assertTrue(last, "Last row must be reachable by scrolling")
                    self.assertGreaterEqual(last[3], font_height + 6)
                    print(f"scale={percent}% font={font_height}px row={first[3]}px scroll=PASS", flush=True)
                finally:
                    root.after_cancel(app.poll_id)
                    root.destroy()
                    del app, root
                    gc.collect()


if __name__ == "__main__":
    unittest.main(verbosity=2)
