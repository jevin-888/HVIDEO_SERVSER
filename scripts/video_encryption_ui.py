#!/usr/bin/env python3
"""Local desktop UI for the shared fixed-key encryption implementation."""
from __future__ import annotations

import os
from pathlib import Path
import queue
import shutil
import sys
import threading
import tkinter as tk
from tkinter import filedialog, font as tkfont, messagebox, ttk

sys.dont_write_bytecode = True
from encrypt_videos import Cancelled, JobControl, decrypt, encrypt, load_profile, plan

STAGES = {"probe": "检查源文件", "encrypt": "正在加密", "decrypt": "正在解密", "verify": "正在校验", "done": "已完成"}


def find_tool(tool, folder=""):
    filename = tool + (".exe" if os.name == "nt" else "")
    if folder:
        return str(Path(folder) / filename)
    bundled = Path(__file__).resolve().parent / "tools" / filename
    return str(bundled) if bundled.is_file() else shutil.which(tool)


def readable_error(error):
    text = str(error)
    translations = {
        "Unsupported subtitles, attachments or data tracks.": "当前支持一条 ASS 内嵌歌词。此文件含其他字幕格式、多条字幕、附件或数据轨，暂不支持；工具不会丢弃它们。",
        "Input is already encrypted": "文件已经加密，无需重复处理。",
        "Input has no video track": "所选文件没有可播放的视频轨。",
        "Only MKV input videos": "只支持 MKV 视频文件，其他格式不会处理。",
        "Only HVIDEO input videos": "解密只支持本工具生成的 .hvideo 加密视频。",
        "Input is not a supported encrypted HVideo file": "所选文件不是支持的 HVideo 加密视频。",
        "Encrypted input contains unsupported tracks": "加密文件包含不支持的轨道，已停止以避免丢失内容。",
        "Embedded ASS lyrics are invalid": "加密文件中的 ASS 歌词损坏，未生成解密文件。",
        "Decryption validation failed": "解密校验失败，未发布不完整的输出文件。",
        "Input and output directory trees": "输出目录不能是原视频目录的子目录或父目录；文件夹模式可以选择与原视频相同的目录。",
        "Duplicate output": "多个源文件将生成相同文件名，请调整源文件名后重试。",
        "Refusing to overwrite": "输出文件已经存在。请选择其他输出目录；工具不会覆盖文件。",
        "No supported MKV video files": "所选文件夹没有找到 MKV 视频文件，其他格式不会处理。",
        "No supported HVIDEO video files": "所选文件夹没有找到 .hvideo 加密视频。",
        "Input does not exist": "输入文件或目录不存在，请重新选择。",
    }
    for phrase, translation in translations.items():
        if phrase in text:
            return translation + "\n\n详细信息：" + text
    return text


class EncryptionApp:
    def __init__(self, root):
        self.root = root
        self.root.title("HVideo 视频加密工具 · 2026.09.26.1")
        self.decrypting = False
        self.unlock_clicks = 0
        self.decrypt_unlocked = False
        self.mode = tk.StringVar(value="file")
        self.source = tk.StringVar()
        self.destination = tk.StringVar()
        self.status = tk.StringVar(value="选择原视频和输出文件夹，然后开始加密。")
        self.current = tk.StringVar(value="等待开始")
        self.total_text = tk.StringVar(value="已完成 0 / 0")
        self.events = queue.Queue()
        self.worker = None
        self.control = None
        self.active = False
        self.closing = False
        self.completed = 0
        self.skipped = 0
        self.total = 0
        self.output_path = None
        self.editable = []
        self._build()
        self.root.update_idletasks()
        width = min(max(940, self.root.winfo_reqwidth()), self.root.winfo_screenwidth() - 60)
        height = min(max(760, self.root.winfo_reqheight()), self.root.winfo_screenheight() - 90)
        self.root.geometry(f"{width}x{height}")
        self.root.minsize(min(width, 900), height)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.poll_id = self.root.after(80, self.poll)

    def _build(self):
        style = ttk.Style(self.root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("TLabel", font=("Microsoft YaHei UI", 10))
        style.configure("TButton", font=("Microsoft YaHei UI", 10), padding=(10, 5))
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 22, "bold"))
        style.configure("Hint.TLabel", foreground="#586579")
        # Fonts use points (DPI-scaled), but Treeview rowheight uses pixels.
        # Measure the actual font instead of clipping scaled text to 24 pixels.
        self.table_font = tkfont.Font(root=self.root, family="Microsoft YaHei UI", size=10)
        row_padding = max(6, round(self.root.winfo_fpixels("6p")))
        style.configure("Encryption.Treeview", font=self.table_font,
                        rowheight=self.table_font.metrics("linespace") + row_padding)
        style.configure("Encryption.Treeview.Heading", font=self.table_font)
        body = ttk.Frame(self.root, padding=18)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(5, weight=1, minsize=110)
        self.title_label = ttk.Label(body, text="视频加密", style="Title.TLabel")
        self.title_label.grid(row=0, column=0, sticky="w")
        self.title_label.bind("<Button-1>", self.unlock_decryption)
        self.subtitle_label = ttk.Label(body, text="为 HVideo 播放器生成加密视频 · 支持本地和网络播放", style="Hint.TLabel")
        self.subtitle_label.grid(row=1, column=0, sticky="w", pady=(4, 20))

        form = ttk.LabelFrame(body, text="选择视频", padding=16)
        form.grid(row=2, column=0, sticky="ew")
        form.columnconfigure(1, weight=1)
        modes = ttk.Frame(form)
        modes.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 14))
        for value, label in (("file", "单个视频"), ("folder", "整个文件夹（含子目录）")):
            button = ttk.Radiobutton(modes, text=label, value=value, variable=self.mode, command=self.change_mode)
            button.pack(side="left", padx=(0, 24))
            self.editable.append(button)
        self.source_label = self.path_row(form, 1, "原视频", self.source, self.choose_source)
        self.path_row(form, 2, "输出文件夹", self.destination, self.choose_destination)

        progress = ttk.Frame(body)
        progress.grid(row=3, column=0, sticky="ew", pady=(18, 10))
        progress.columnconfigure(0, weight=1)
        ttk.Label(progress, textvariable=self.current).grid(row=0, column=0, sticky="w")
        ttk.Label(progress, textvariable=self.total_text).grid(row=0, column=1, sticky="e")
        self.bar = ttk.Progressbar(progress, maximum=100)
        self.bar.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(8, 0))

        actions = ttk.Frame(body)
        actions.grid(row=4, column=0, sticky="ew", pady=(0, 12))
        self.start_button = ttk.Button(actions, text="开始加密", command=self.start)
        self.start_button.pack(side="left")
        # Created but not laid out until the title has been clicked ten times.
        self.decrypt_button = ttk.Button(actions, text="解密视频", command=self.toggle_operation)
        self.editable.append(self.decrypt_button)
        self.stop_button = ttk.Button(actions, text="停止任务", command=self.stop, state="disabled")
        self.stop_button.pack(side="left", padx=10)
        self.open_button = ttk.Button(actions, text="打开输出文件夹", command=self.open_output, state="disabled")
        self.open_button.pack(side="right")

        results = ttk.Frame(body)
        results.grid(row=5, column=0, sticky="nsew")
        results.columnconfigure(0, weight=1)
        results.rowconfigure(0, weight=1)
        self.table = ttk.Treeview(results, style="Encryption.Treeview",
                                  columns=("name", "state"), show="headings", height=6)
        self.table.heading("name", text="文件")
        self.table.heading("state", text="处理状态")
        self.table.column("name", width=550, minwidth=200)
        self.table.column("state", width=max(145, self.table_font.measure("已存在，已跳过") + row_padding * 2), stretch=False)
        self.table.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(results, orient="vertical", command=self.table.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.table.configure(yscrollcommand=scroll.set)
        self.log = tk.Text(body, height=3, wrap="word", font=("Microsoft YaHei UI", 9),
                           background="#f3f6fa", foreground="#334155", relief="flat", padx=10, pady=8,
                           spacing1=2, spacing2=1, spacing3=2, state="disabled")
        self.log.grid(row=6, column=0, sticky="ew", pady=(10, 6))
        ttk.Label(body, textvariable=self.status, wraplength=850, style="Hint.TLabel").grid(row=7, column=0, sticky="w")

    def path_row(self, parent, row, title, variable, command):
        label = ttk.Label(parent, text=title)
        label.grid(row=row, column=0, sticky="w", padx=(0, 12), pady=5)
        entry = ttk.Entry(parent, textvariable=variable)
        entry.grid(row=row, column=1, sticky="ew", pady=5)
        button = ttk.Button(parent, text="浏览…", command=command)
        button.grid(row=row, column=2, padx=(10, 0), pady=5)
        self.editable.extend((entry, button))
        return label

    def change_mode(self):
        self.source.set("")

    def unlock_decryption(self, _event=None):
        if self.decrypt_unlocked:
            return
        self.unlock_clicks += 1
        if self.unlock_clicks == 10:
            self.decrypt_unlocked = True
            self.decrypt_button.pack(side="left", after=self.start_button, padx=(10, 0))

    def toggle_operation(self):
        if self.active or not self.decrypt_unlocked:
            return
        self.decrypting = not self.decrypting
        self.source.set("")
        self.title_label.configure(text="视频解密" if self.decrypting else "视频加密")
        self.source_label.configure(text="加密视频" if self.decrypting else "原视频")
        self.subtitle_label.configure(text=("将 HVideo 加密视频还原为 MKV · 保留音视频与 ASS 歌词" if self.decrypting
                                            else "为 HVideo 播放器生成加密视频 · 支持本地和网络播放"))
        self.decrypt_button.configure(text="切换加密" if self.decrypting else "解密视频")
        self.start_button.configure(text="开始解密" if self.decrypting else "开始加密")
        self.status.set("选择 .hvideo 文件或文件夹及输出文件夹，然后开始解密。" if self.decrypting
                        else "选择原视频和输出文件夹，然后开始加密。")

    def choose_source(self):
        title = "选择加密视频" if self.decrypting else "选择原视频"
        if self.mode.get() == "folder":
            path = filedialog.askdirectory(parent=self.root, title=title + "文件夹")
        else:
            path = filedialog.askopenfilename(parent=self.root, title=title, filetypes=[
                ("HVideo 加密视频", "*.hvideo") if self.decrypting else ("MKV 视频", "*.mkv")])
        if path:
            self.source.set(path)

    def choose_destination(self):
        path = filedialog.askdirectory(parent=self.root, title="选择输出文件夹（保留原片）", mustexist=False)
        if path:
            self.destination.set(path)

    def append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start(self):
        if self.active:
            return
        try:
            if not self.source.get().strip() or not self.destination.get().strip():
                raise ValueError("请先选择原视频和输出文件夹。")
            source = Path(self.source.get().strip()).resolve()
            destination = Path(self.destination.get().strip()).resolve()
            if (self.mode.get() == "file" and not source.is_file()) or (self.mode.get() == "folder" and not source.is_dir()):
                raise ValueError("所选路径与处理模式不符，请重新选择。")
            if destination.exists() and not destination.is_dir():
                raise ValueError("输出位置必须是文件夹。")
            suffix = ".mkv" if self.decrypting else ".hvideo"
            output = destination / (source.stem + suffix) if self.mode.get() == "file" else destination
            binaries = []
            for tool in ("ffmpeg", "ffprobe"):
                executable = find_tool(tool)
                if not executable or not Path(executable).is_file():
                    raise ValueError("未找到内置 FFmpeg 工具，请重新安装视频加密工具。")
                binaries.append(executable)
            profile = load_profile()
        except (OSError, ValueError) as error:
            messagebox.showerror("无法开始", readable_error(error), parent=self.root)
            return
        self.table.delete(*self.table.get_children())
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self.active = True
        self.completed = self.skipped = self.total = 0
        self.output_path = destination
        self.bar["value"] = 0
        self.current.set("正在扫描文件…")
        self.total_text.set("已完成 0 / 0")
        self.status.set("解密为 MKV 后会校验全部音视频。随时可停止，源文件和已完成文件会保留。" if self.decrypting
                        else "加密后会校验全部加密数据和音轨。随时可停止，已完成的文件会保留。")
        for widget in self.editable:
            widget.configure(state="disabled")
        self.start_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.open_button.configure(state="disabled")
        self.control = JobControl()
        self.worker = threading.Thread(target=self.process, args=(source, output, binaries, profile), daemon=False)
        self.worker.start()

    def process(self, source, output, binaries, profile):
        index = None
        try:
            jobs = plan(source, output, self.control, decrypting=self.decrypting)
            self.events.put(("planned", jobs))
            for index, (input_file, output_file) in enumerate(jobs):
                self.control.check()
                if output_file.is_file():
                    self.events.put(("skipped", index, str(output_file)))
                    continue
                self.control.on_progress = lambda stage, fraction, i=index: self.events.put(("progress", i, stage, fraction))
                operation = decrypt if self.decrypting else encrypt
                operation(input_file, output_file, *binaries, profile, self.control)
            self.events.put(("finished", "success", None, ""))
        except Cancelled as error:
            self.events.put(("finished", "cancelled", index, str(error)))
        except Exception as error:
            detail = readable_error(error)
            if index is not None:
                detail = f"文件：{jobs[index][0]}\n{detail}"
            self.events.put(("finished", "error", index, detail))

    def poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "planned":
                    jobs = event[1]
                    self.total = len(jobs)
                    self.total_text.set(f"已完成 0 / {self.total}")
                    for index, (source, _) in enumerate(jobs):
                        self.table.insert("", "end", iid=str(index), values=(str(source), "等待处理"))
                elif event[0] == "skipped":
                    _, index, output = event
                    self.skipped += 1
                    self.table.set(str(index), "state", "已存在，已跳过")
                    self.table.see(str(index))
                    self.bar["value"] = (index + 1) * 100 / max(1, self.total)
                    self.total_text.set(f"已{self.operation_label} {self.completed} · 已跳过 {self.skipped} / 共 {self.total}")
                    self.append_log(f"已存在，已跳过（未覆盖、未重新校验）：{output}")
                elif event[0] == "progress":
                    _, index, stage, fraction = event
                    title = STAGES[stage]
                    self.table.set(str(index), "state", title)
                    self.table.see(str(index))
                    weights = {"probe": 0, "encrypt": 0.05 + fraction * 0.4, "decrypt": 0.05 + fraction * 0.4, "verify": 0.45 + fraction * 0.54, "done": 1}
                    self.bar["value"] = (index + weights[stage]) * 100 / max(1, self.total)
                    self.current.set(f"{title} · 第 {index + 1} / {self.total} 个" + (f" · {fraction:.0%}" if stage in ("encrypt", "decrypt", "verify") else ""))
                    if stage == "done":
                        self.completed += 1
                        self.total_text.set(f"已{self.operation_label} {self.completed} · 已跳过 {self.skipped} / 共 {self.total}")
                        self.append_log("已完成：" + self.table.set(str(index), "name"))
                else:
                    self.finish(*event[1:])
        except queue.Empty:
            pass
        if self.closing and not self.active and not (self.worker and self.worker.is_alive()):
            self.root.destroy()
            return
        self.poll_id = self.root.after(80, self.poll)

    @property
    def operation_label(self):
        return "解密" if self.decrypting else "加密"

    def finish(self, outcome, index, detail):
        self.active = False
        for widget in self.editable:
            widget.configure(state="normal")
        self.start_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.open_button.configure(state="normal" if self.output_path and self.output_path.is_dir() else "disabled")
        if outcome == "success":
            self.bar["value"] = 100
            self.current.set("全部已存在，已跳过" if self.skipped == self.total else "处理完成")
            self.status.set(f"新{self.operation_label} {self.completed} 个，已存在跳过 {self.skipped} 个。已有文件未覆盖、未重新校验。")
            self.append_log(self.status.get())
        else:
            label = "已停止" if outcome == "cancelled" else "处理失败"
            self.current.set(label)
            self.status.set(f"{label}：已{self.operation_label} {self.completed}，已跳过 {self.skipped}，共 {self.total}。{detail.splitlines()[0] if detail else ''}")
            for item in self.table.get_children():
                if self.table.set(item, "state") not in ("已完成", "已存在，已跳过"):
                    self.table.set(item, "state", label if index is not None and item == str(index) else "未处理")
            self.append_log(detail)

    def stop(self):
        if self.active:
            self.control.cancelled.set()
            self.stop_button.configure(state="disabled")
            self.status.set("正在停止并清理未完成的文件，请稍候…")

    def open_output(self):
        if self.output_path and self.output_path.is_dir():
            try:
                os.startfile(self.output_path)
            except OSError as error:
                messagebox.showerror("无法打开文件夹", str(error), parent=self.root)

    def close(self):
        if self.active:
            self.closing = True
            self.stop()
        elif self.worker and self.worker.is_alive():
            self.closing = True
        else:
            self.root.after_cancel(self.poll_id)
            self.root.destroy()


def main():
    if os.name == "nt":
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except OSError:
            pass
    root = tk.Tk()
    EncryptionApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
