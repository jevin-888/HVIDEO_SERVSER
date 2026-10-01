//! Detect encrypted MP4 video sample entries without reading media payloads.
//! The encryptor writes CENC MP4 (.hvideo); legacy encrypted .mp4 is supported.
use std::{fs::File, io::{self, Read, Seek, SeekFrom}, path::Path};

fn invalid() -> io::Error { io::Error::new(io::ErrorKind::InvalidData, "Invalid MP4 box") }

fn sample_entries(file: &mut File, start: u64, end: u64, chain: &[[u8; 4]], budget: &mut usize) -> io::Result<Vec<[u8; 4]>> {
    let mut pos = start;
    let mut entries = Vec::new();
    while pos < end {
        if end - pos < 8 || *budget == 0 { return Err(invalid()); }
        *budget -= 1;
        file.seek(SeekFrom::Start(pos))?;
        let mut header = [0; 8];
        file.read_exact(&mut header)?;
        let mut size = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64;
        let kind: [u8; 4] = header[4..].try_into().unwrap();
        let mut header_size = 8;
        if size == 1 {
            if end - pos < 16 { return Err(invalid()); }
            let mut extended = [0; 8]; file.read_exact(&mut extended)?;
            size = u64::from_be_bytes(extended); header_size = 16;
        } else if size == 0 { size = end - pos; }
        if size < header_size || size > end - pos { return Err(invalid()); }
        let data = pos + header_size;
        let stop = pos + size;
        if chain.is_empty() {
            entries.push(kind);
        } else if kind == chain[0] {
            if chain.len() == 1 {
                if stop - data < 8 { return Err(invalid()); }
                file.seek(SeekFrom::Start(data))?;
                let mut info = [0; 8]; file.read_exact(&mut info)?;
                let count = u32::from_be_bytes(info[4..].try_into().unwrap()) as usize;
                let samples = sample_entries(file, data + 8, stop, &[], budget)?;
                if count != samples.len() { return Err(invalid()); }
                entries.extend(samples);
            } else {
                entries.extend(sample_entries(file, data, stop, &chain[1..], budget)?);
            }
        }
        pos = stop;
    }
    Ok(entries)
}

pub fn encrypted_video(path: &Path) -> bool {
    let read = || -> io::Result<bool> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        let entries = sample_entries(&mut file, 0, size, &[*b"moov", *b"trak", *b"mdia", *b"minf", *b"stbl", *b"stsd"], &mut 16_384)?;
        Ok(entries.contains(b"encv") && !entries.iter().any(|kind|
            matches!(kind, b"avc1" | b"avc3" | b"hvc1" | b"hev1" | b"mp4v" | b"vp09" | b"av01")))
    };
    // Missing, unreadable, malformed or merely renamed files never enable scoring.
    read().unwrap_or(false)
}

pub async fn score_enabled(path: &str) -> i32 {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || i32::from(encrypted_video(Path::new(&path))))
        .await.unwrap_or(0)
}

#[cfg(test)]
pub(crate) fn test_video(encrypted: bool) -> Vec<u8> {
    fn boxed(kind: &[u8; 4], content: Vec<u8>) -> Vec<u8> {
        let mut out = ((8 + content.len()) as u32).to_be_bytes().to_vec();
        out.extend(kind); out.extend(content); out
    }
    let mut stsd = vec![0,0,0,0,0,0,0,1];
    stsd.extend(boxed(if encrypted { b"encv" } else { b"avc1" }, vec![0; 78]));
    let mut out = boxed(b"stsd", stsd);
    for kind in [b"stbl", b"minf", b"mdia", b"trak", b"moov"] { out = boxed(kind, out); }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires local FFmpeg to produce real encrypted and unencrypted MP4 files"]
    fn detects_real_ffmpeg_cenc_and_plain_video() {
        let dir=tempfile::tempdir().unwrap();
        for (name,encrypted) in [("plain.hvideo",false),("encrypted.mp4",true)] {
            let path=dir.path().join(name);
            let mut cmd=std::process::Command::new("ffmpeg");
            cmd.args(["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=black:s=32x32:r=1:d=1","-c:v","libx264","-f","mp4"]);
            if encrypted { cmd.args(["-encryption_scheme","cenc-aes-ctr","-encryption_key","11111111111111111111111111111111","-encryption_kid","22222222222222222222222222222222"]); }
            let result=cmd.arg(&path).output().unwrap();
            assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
            assert_eq!(encrypted_video(&path),encrypted,"{name}");
        }
    }
    #[test]
    fn scoring_reads_container_not_extension_and_rejects_invalid_files() {
        let dir = tempfile::tempdir().unwrap();
        for (name, encrypted, expected) in [("1.hvideo",true,true),("old.mp4",true,true),("fake.hvideo",false,false),("plain.mp4",false,false)] {
            let p=dir.path().join(name); std::fs::write(&p,test_video(encrypted)).unwrap();
            assert_eq!(encrypted_video(&p),expected,"{name}");
        }
        let p=dir.path().join("broken.hvideo");
        for bytes in [b"encv".to_vec(),vec![0,0,0,7,b'm',b'o',b'o',b'v'],test_video(true)[..35].to_vec()] {
            std::fs::write(&p,bytes).unwrap(); assert!(!encrypted_video(&p));
        }
        assert!(!encrypted_video(&dir.path().join("missing.hvideo")));
    }
}
