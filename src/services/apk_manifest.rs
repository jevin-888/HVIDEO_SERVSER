//! Minimal, bounds-checked Android binary XML reader for release APK metadata.
use anyhow::{bail, ensure, Context, Result};
use std::{collections::HashMap, io::Read, path::Path};

#[derive(Clone, Debug)]
pub struct ApkManifest {
    pub package: String,
    pub version_code: i32,
    pub version_name: String,
    pub hardware: String,
}

fn u16_at(b: &[u8], p: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        b.get(p..p + 2).context("truncated XML")?.try_into()?,
    ))
}
fn u32_at(b: &[u8], p: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        b.get(p..p + 4).context("truncated XML")?.try_into()?,
    ))
}
fn length(b: &[u8], p: &mut usize, utf8: bool) -> Result<usize> {
    let unit = if utf8 { 1 } else { 2 };
    let first = if utf8 {
        *b.get(*p).context("string length")? as usize
    } else {
        u16_at(b, *p)? as usize
    };
    *p += unit;
    let flag = if utf8 { 0x80 } else { 0x8000 };
    if first & flag == 0 {
        return Ok(first);
    }
    let second = if utf8 {
        *b.get(*p).context("string length")? as usize
    } else {
        u16_at(b, *p)? as usize
    };
    *p += unit;
    Ok(((first & (flag - 1)) << (unit * 8)) | second)
}

pub fn read(path: &Path) -> Result<ApkManifest> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    let mut manifest = zip.by_name("AndroidManifest.xml")?;
    ensure!(manifest.size() <= 2 * 1024 * 1024, "manifest too large");
    let mut bytes = Vec::new();
    manifest.read_to_end(&mut bytes)?;
    parse(&bytes)
}

fn parse(bytes: &[u8]) -> Result<ApkManifest> {
    ensure!(
        u16_at(bytes, 0)? == 3 && u32_at(bytes, 4)? as usize == bytes.len(),
        "invalid binary XML"
    );
    let mut strings = Vec::new();
    let mut result = ApkManifest {
        package: String::new(),
        version_code: 0,
        version_name: String::new(),
        hardware: String::new(),
    };
    let mut pos = u16_at(bytes, 2)? as usize;
    ensure!(pos >= 8, "invalid XML header");
    while pos < bytes.len() {
        let size = u32_at(bytes, pos + 4)? as usize;
        let header = u16_at(bytes, pos + 2)? as usize;
        ensure!(size >= header && header >= 8, "invalid chunk size");
        let b = bytes
            .get(pos..pos.checked_add(size).context("overflow")?)
            .context("truncated chunk")?;
        match u16_at(b, 0)? {
            1 => {
                ensure!(strings.is_empty() && header >= 28, "invalid string pool");
                let count = u32_at(b, 8)? as usize;
                let start = u32_at(b, 20)? as usize;
                ensure!(
                    count <= 65536 && start <= size && header + count * 4 <= start,
                    "invalid string offsets"
                );
                let utf8 = u32_at(b, 16)? & 0x100 != 0;
                for i in 0..count {
                    let mut p = start + u32_at(b, header + i * 4)? as usize;
                    let n = length(b, &mut p, utf8)?;
                    let value = if utf8 {
                        let n = length(b, &mut p, true)?;
                        ensure!(b.get(p + n) == Some(&0), "unterminated string");
                        std::str::from_utf8(b.get(p..p + n).context("string bounds")?)?.to_owned()
                    } else {
                        let raw = b.get(p..p + n * 2).context("string bounds")?;
                        ensure!(u16_at(b, p + n * 2)? == 0, "unterminated string");
                        String::from_utf16(
                            &raw.chunks_exact(2)
                                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                                .collect::<Vec<_>>(),
                        )?
                    };
                    strings.push(value);
                }
            }
            0x102 => {
                ensure!(header >= 16, "invalid element");
                let s = |index: u32| -> Result<&str> {
                    Ok(strings
                        .get(index as usize)
                        .context("invalid string index")?
                        .as_str())
                };
                let name = s(u32_at(b, header + 4)?)?;
                if name == "manifest" || name == "meta-data" {
                    let start = header + u16_at(b, header + 8)? as usize;
                    let stride = u16_at(b, header + 10)? as usize;
                    let count = u16_at(b, header + 12)? as usize;
                    ensure!(
                        stride >= 20 && start + count * stride <= size,
                        "invalid attributes"
                    );
                    let mut attrs = HashMap::new();
                    for i in 0..count {
                        let p = start + stride * i;
                        let key = s(u32_at(b, p + 4)?)?;
                        let data = u32_at(b, p + 16)?;
                        let value = match b[p + 15] {
                            3 => s(data)?.to_owned(),
                            0x10 | 0x11 => data.to_string(),
                            _ => continue,
                        };
                        attrs.insert(key, value);
                    }
                    if name == "manifest" {
                        result.package = attrs.remove("package").context("missing package")?;
                        result.version_code = attrs
                            .remove("versionCode")
                            .context("missing versionCode")?
                            .parse()?;
                        result.version_name = attrs
                            .remove("versionName")
                            .context("versionName must be literal")?;
                        ensure!(
                            attrs.get("versionCodeMajor").is_none_or(|v| v == "0"),
                            "unsupported long versionCode"
                        );
                    } else if attrs.get("name").map(String::as_str)
                        == Some("com.hsvj.engine.HARDWARE")
                    {
                        result.hardware = attrs.remove("value").context("missing hardware")?;
                    }
                }
            }
            _ => {}
        }
        pos += size;
    }
    if result.package != "com.hsvj.engine"
        || result.version_code <= 0
        || result.version_name.is_empty()
        || !matches!(result.hardware.as_str(), "hw81" | "hw82")
    {
        bail!("not a supported player release APK (package/version/hardware)");
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_truncated_and_invalid_xml_without_panicking() {
        for n in 0..128 {
            assert!(super::parse(&vec![0; n]).is_err());
        }
        assert!(super::parse(b"<manifest/>").is_err());
    }
}
