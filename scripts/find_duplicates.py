import os
import hashlib

def get_file_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        buf = f.read()
        hasher.update(buf)
    return hasher.hexdigest()

def find_duplicates(root_dir):
    hashes = {}
    duplicates = []
    for root, dirs, files in os.walk(root_dir):
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if 'target' in dirs:
            dirs.remove('target')
        for filename in files:
            if filename.endswith('.js') or filename.endswith('.rs') or filename.endswith('.html'):
                filepath = os.path.join(root, filename)
                file_hash = get_file_hash(filepath)
                if file_hash in hashes:
                    duplicates.append((filepath, hashes[file_hash]))
                else:
                    hashes[file_hash] = filepath
    return duplicates

if __name__ == "__main__":
    root = r"d:\Hvideo_server"
    dupes = find_duplicates(root)
    if dupes:
        print("发现完全相同的重复文件:")
        for d in dupes:
            print(f"{d[0]} <==> {d[1]}")
    else:
        print("未发现完全相同的代码文件。")
