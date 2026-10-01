//! The dictionary workbook contract. Uses the existing ZIP/XML dependencies.
//! Codes are written as text; formulas are never evaluated on import.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Read, Write};

use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::dictionary_service::{DictImportRow, MAX_DICT_ROWS};
use crate::errors::{AppError, AppResult};
use crate::models::song_db_models::{DictEntry, UpsertDictRequest};

pub const MAX_XLSX_SIZE: usize = 5 * 1024 * 1024;
const MAX_XML_SIZE: u64 = 32 * 1024 * 1024;
const HEADERS: [&str; 5] = ["dictGroup", "dictCode", "dictName", "sortOrder", "visible"];
const NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

fn bad(message: impl Into<String>) -> AppError {
    AppError::BadRequest(message.into())
}

fn attribute(event: &BytesStart<'_>, name: &[u8]) -> AppResult<Option<String>> {
    for attr in event.attributes() {
        let attr = attr.map_err(|e| bad(format!("Excel属性错误：{e}")))?;
        if attr.key.local_name().as_ref() == name {
            return attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map(|v| Some(v.into_owned()))
                .map_err(|e| bad(e.to_string()));
        }
    }
    Ok(None)
}

fn read_xml(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> AppResult<String> {
    let file = archive
        .by_name(name)
        .map_err(|_| bad(format!("XLSX缺少必要文件：{name}")))?;
    let mut xml = String::new();
    file.take(MAX_XML_SIZE + 1)
        .read_to_string(&mut xml)
        .map_err(|_| bad("Excel XML内容损坏或编码无效"))?;
    if xml.len() as u64 > MAX_XML_SIZE {
        return Err(bad("字典工作表解压后过大"));
    }
    Ok(xml)
}

fn xml_event<'a>(reader: &mut Reader<&'a [u8]>) -> AppResult<Event<'a>> {
    let event = reader
        .read_event()
        .map_err(|e| bad(format!("Excel XML解析失败：{e}")))?;
    if matches!(event, Event::DocType(_)) {
        return Err(bad("XLSX不允许包含DTD"));
    }
    Ok(event)
}

fn event_text(event: &Event<'_>) -> AppResult<Option<String>> {
    match event {
        Event::Text(text) => Ok(Some(
            text.decode().map_err(|e| bad(e.to_string()))?.into_owned(),
        )),
        Event::CData(text) => Ok(Some(
            text.decode().map_err(|e| bad(e.to_string()))?.into_owned(),
        )),
        Event::GeneralRef(text) => {
            let entity = format!("&{};", text.decode().map_err(|e| bad(e.to_string()))?);
            Ok(Some(
                quick_xml::escape::unescape(&entity)
                    .map_err(|e| bad(e.to_string()))?
                    .into_owned(),
            ))
        }
        _ => Ok(None),
    }
}

fn worksheet_path(archive: &mut ZipArchive<Cursor<&[u8]>>) -> AppResult<String> {
    let workbook = read_xml(archive, "xl/workbook.xml")?;
    let mut reader = Reader::from_str(&workbook);
    let mut sheets = Vec::new();
    loop {
        match xml_event(&mut reader)? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"sheet" => {
                sheets.push((
                    attribute(&e, b"name")?.unwrap_or_default(),
                    attribute(&e, b"id")?.unwrap_or_default(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let selected = if let Some(index) = sheets.iter().position(|(name, _)| name == "字典数据") {
        &sheets[index]
    } else if sheets.len() == 1 {
        &sheets[0]
    } else {
        return Err(bad(
            "多工作表文件必须包含名为“字典数据”的工作表；说明和映射表不会导入",
        ));
    };
    let relationships = read_xml(archive, "xl/_rels/workbook.xml.rels")?;
    let mut reader = Reader::from_str(&relationships);
    loop {
        match xml_event(&mut reader)? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"Relationship" => {
                if attribute(&e, b"Id")?.as_deref() != Some(selected.1.as_str()) {
                    continue;
                }
                if attribute(&e, b"TargetMode")?.as_deref() == Some("External")
                    || !attribute(&e, b"Type")?
                        .unwrap_or_default()
                        .ends_with("/worksheet")
                {
                    return Err(bad("字典工作表关系无效"));
                }
                let target = attribute(&e, b"Target")?.unwrap_or_default();
                let target = if target.starts_with('/') {
                    target.trim_start_matches('/').to_owned()
                } else {
                    format!("xl/{target}")
                };
                let mut parts = Vec::new();
                for part in target.split('/') {
                    match part {
                        "" | "." => {}
                        ".." => {
                            if parts.pop().is_none() {
                                return Err(bad("字典工作表路径无效"));
                            }
                        }
                        _ => parts.push(part),
                    }
                }
                let path = parts.join("/");
                if !path.starts_with("xl/worksheets/")
                    || !path.ends_with(".xml")
                    || path.contains('\\')
                {
                    return Err(bad("字典工作表路径无效"));
                }
                return Ok(path);
            }
            Event::Eof => return Err(bad("无法定位字典工作表")),
            _ => {}
        }
    }
}

// Decode Excel's escaped Unicode once, so a literal `_x0041_` stays literal when
// exported as `_x005F_x0041_`. UTF-16 pairs are supported for supplementary text.
fn excel_unescape(value: &str) -> String {
    let mut units = Vec::new();
    let mut offset = 0;
    while offset < value.len() {
        let tail = &value[offset..];
        if tail.len() >= 7
            && tail.starts_with("_x")
            && tail.as_bytes()[6] == b'_'
            && tail.as_bytes()[2..6].iter().all(u8::is_ascii_hexdigit)
        {
            units.push(u16::from_str_radix(&tail[2..6], 16).unwrap());
            offset += 7;
        } else {
            let ch = tail.chars().next().unwrap();
            units.extend(ch.encode_utf16(&mut [0; 2]).iter().copied());
            offset += ch.len_utf8();
        }
    }
    String::from_utf16_lossy(&units)
}

fn shared_strings(archive: &mut ZipArchive<Cursor<&[u8]>>) -> AppResult<Vec<String>> {
    if !archive.file_names().any(|n| n == "xl/sharedStrings.xml") {
        return Ok(Vec::new());
    }
    let xml = read_xml(archive, "xl/sharedStrings.xml")?;
    let mut reader = Reader::from_str(&xml);
    let mut strings = Vec::new();
    let mut value = String::new();
    let mut in_text = false;
    let mut phonetic = false;
    loop {
        match xml_event(&mut reader)? {
            Event::Start(e) if e.local_name().as_ref() == b"si" => value.clear(),
            Event::Start(e) if e.local_name().as_ref() == b"rPh" => phonetic = true,
            Event::Start(e) if e.local_name().as_ref() == b"t" && !phonetic => in_text = true,
            Event::End(e) if e.local_name().as_ref() == b"rPh" => phonetic = false,
            Event::End(e) if e.local_name().as_ref() == b"t" => in_text = false,
            Event::End(e) if e.local_name().as_ref() == b"si" => {
                strings.push(excel_unescape(&value))
            }
            Event::Empty(e) if e.local_name().as_ref() == b"si" => strings.push(String::new()),
            Event::Eof => break,
            event if in_text => {
                if let Some(text) = event_text(&event)? {
                    value.push_str(&text);
                }
            }
            _ => {}
        }
    }
    Ok(strings)
}

fn column(reference: &str, row: usize) -> AppResult<usize> {
    let letter_count = reference.bytes().take_while(u8::is_ascii_uppercase).count();
    if letter_count == 0 || reference[letter_count..].parse::<usize>().ok() != Some(row) {
        return Err(bad(format!("第{row}行单元格坐标无效")));
    }
    let col = reference
        .bytes()
        .take(letter_count)
        .try_fold(0usize, |n, c| {
            n.checked_mul(26)?.checked_add((c - b'A' + 1) as usize)
        });
    col.filter(|c| *c > 0 && *c <= 16384)
        .map(|c| c - 1)
        .ok_or_else(|| bad("Excel列坐标无效"))
}

fn parse_rows(xml: &str, shared: &[String]) -> AppResult<Vec<DictImportRow>> {
    let mut reader = Reader::from_str(xml);
    // Empty styled cells still occupy a column, including when cell references are omitted.
    reader.config_mut().expand_empty_elements = true;
    let mut headers = HashMap::new();
    let mut cells = BTreeMap::new();
    let mut rows = Vec::new();
    let mut row = 0;
    let mut col = 0;
    let mut cell_type = String::new();
    let mut value = String::new();
    let mut in_value = false;
    let mut phonetic = false;
    let mut closed = false;
    loop {
        match xml_event(&mut reader)? {
            Event::Start(e) if e.local_name().as_ref() == b"row" => {
                let next = attribute(&e, b"r")?
                    .map(|r| r.parse::<usize>())
                    .transpose()
                    .map_err(|_| bad("Excel行号无效"))?
                    .unwrap_or(row + 1);
                if next <= row || next > 1_048_576 {
                    return Err(bad("Excel行号重复或超出范围"));
                }
                row = next;
                cells.clear();
                col = 0;
            }
            Event::Start(e) if e.local_name().as_ref() == b"c" => {
                col = attribute(&e, b"r")?
                    .map(|r| column(&r, row))
                    .transpose()?
                    .unwrap_or(col);
                cell_type = attribute(&e, b"t")?.unwrap_or_default();
                value.clear();
            }
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"f" => {
                return Err(bad(format!("第{row}行含公式，请粘贴为值后导入")))
            }
            Event::Start(e) if e.local_name().as_ref() == b"rPh" => phonetic = true,
            Event::End(e) if e.local_name().as_ref() == b"rPh" => phonetic = false,
            Event::Start(e) if matches!(e.local_name().as_ref(), b"v" | b"t") && !phonetic => {
                in_value = true
            }
            Event::End(e) if matches!(e.local_name().as_ref(), b"v" | b"t") => in_value = false,
            Event::End(e) if e.local_name().as_ref() == b"c" => {
                let text = match cell_type.as_str() {
                    "s" => shared
                        .get(
                            value
                                .parse::<usize>()
                                .map_err(|_| bad(format!("第{row}行共享字符串索引无效")))?,
                        )
                        .cloned()
                        .ok_or_else(|| bad(format!("第{row}行共享字符串丢失")))?,
                    "" | "n" | "inlineStr" | "str" => excel_unescape(&value),
                    _ => {
                        return Err(bad(format!(
                            "第{row}行含不支持的单元格类型，请使用文本或整数"
                        )))
                    }
                };
                // Bound decoded values too: shared strings can otherwise amplify a small sheet.
                if text.chars().count() > 256 {
                    return Err(bad(format!("第{row}行单元格内容超过256个字符")));
                }
                if cells.insert(col, text).is_some() {
                    return Err(bad(format!("第{row}行有重复单元格")));
                }
                col += 1;
            }
            Event::End(e) if e.local_name().as_ref() == b"row" => {
                if row == 1 {
                    for (col, header) in &cells {
                        let header = header.trim();
                        if header.is_empty() {
                            continue;
                        }
                        if !HEADERS.contains(&header) {
                            return Err(bad(format!(
                                "未知字典表头：{header}，请使用导出文件的字段"
                            )));
                        }
                        if headers.insert(header.to_owned(), *col).is_some() {
                            return Err(bad(format!("重复表头：{header}")));
                        }
                    }
                    let missing: Vec<_> = HEADERS
                        .iter()
                        .filter(|h| !headers.contains_key(**h))
                        .copied()
                        .collect();
                    if !missing.is_empty() {
                        return Err(bad(format!("第一行缺少字典字段：{}", missing.join(", "))));
                    }
                } else if cells.values().any(|v| !v.trim().is_empty()) {
                    if headers.is_empty() {
                        return Err(bad("第一行必须是字典字段名"));
                    }
                    if cells.iter().any(|(col, value)| {
                        !value.trim().is_empty() && !headers.values().any(|c| c == col)
                    }) {
                        return Err(bad(format!("第{row}行含没有表头的数据列")));
                    }
                    let get = |key: &str| {
                        headers
                            .get(key)
                            .and_then(|col| cells.get(col))
                            .map(|v| v.trim())
                            .unwrap_or("")
                    };
                    let integer = |key: &str| {
                        get(key)
                            .parse::<i32>()
                            .map_err(|_| bad(format!("第{row}行{key}必须为整数")))
                    };
                    rows.push(DictImportRow {
                        row_number: row,
                        group: get("dictGroup").to_owned(),
                        request: UpsertDictRequest {
                            dict_code: get("dictCode").to_owned(),
                            dict_name: get("dictName").to_owned(),
                            sortOrder: Some(integer("sortOrder")?),
                            visible: Some(integer("visible")?),
                        },
                    });
                    if rows.len() > MAX_DICT_ROWS {
                        return Err(bad(format!("字典不能超过{MAX_DICT_ROWS}条")));
                    }
                }
            }
            Event::End(e) if e.local_name().as_ref() == b"worksheet" => closed = true,
            Event::Eof => break,
            event if in_value => {
                if let Some(text) = event_text(&event)? {
                    value.push_str(&text);
                }
            }
            _ => {}
        }
    }
    if !closed || headers.is_empty() {
        return Err(bad("字典工作表不完整或缺少表头"));
    }
    Ok(rows)
}

pub fn import_xlsx(bytes: &[u8]) -> AppResult<Vec<DictImportRow>> {
    if bytes.len() > MAX_XLSX_SIZE {
        return Err(bad("XLSX文件不能超过5MB"));
    }
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|_| bad("文件不是有效的XLSX工作簿"))?;
    if archive.len() > 256 {
        return Err(bad("XLSX包含过多文件，请仅保留字典工作表"));
    }
    let mut names = HashSet::new();
    let mut size = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|_| bad("XLSX文件损坏"))?;
        if !names.insert(entry.name().to_owned()) {
            return Err(bad("XLSX包含重复文件"));
        }
        size = size.saturating_add(entry.size());
        if size > MAX_XML_SIZE {
            return Err(bad("XLSX解压大小超过32MB，请仅保留字典工作表"));
        }
    }
    let path = worksheet_path(&mut archive)?;
    let shared = shared_strings(&mut archive)?;
    parse_rows(&read_xml(&mut archive, &path)?, &shared)
}

fn escape_cell(value: &str) -> String {
    // Protect literal Excel escape sequences without changing the saved value.
    let mut safe = String::new();
    for (index, ch) in value.char_indices() {
        let tail = &value[index..];
        if ch == '_'
            && tail.len() >= 7
            && tail.starts_with("_x")
            && tail.as_bytes()[6] == b'_'
            && tail.as_bytes()[2..6].iter().all(u8::is_ascii_hexdigit)
        {
            safe.push_str("_x005F_");
        } else {
            safe.push(ch);
        }
    }
    quick_xml::escape::escape(&safe).into_owned()
}

pub fn export_xlsx(items: &[DictEntry]) -> AppResult<Vec<u8>> {
    let mut sheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{NS}"><dimension ref="A1:E{}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="32" customWidth="1"/><col min="4" max="5" width="14" customWidth="1"/></cols><sheetData>"#,
        items.len() + 1
    );
    for row in 0..=items.len() {
        sheet.push_str(&format!(r#"<row r="{}">"#, row + 1));
        let values = if row == 0 {
            HEADERS.map(str::to_owned).to_vec()
        } else {
            let d = &items[row - 1];
            vec![
                d.dict_group.clone().unwrap_or_default(),
                d.dict_code.clone().unwrap_or_default(),
                d.dict_name.clone().unwrap_or_default(),
                d.sortOrder.unwrap_or(0).to_string(),
                d.visible.unwrap_or(1).to_string(),
            ]
        };
        for (col, value) in values.iter().enumerate() {
            let reference = format!("{}{}", (b'A' + col as u8) as char, row + 1);
            let style = if row == 0 { 1 } else { 0 };
            if row > 0 && [3, 4].contains(&col) && !value.is_empty() {
                sheet.push_str(&format!(
                    r#"<c r="{reference}" s="{style}"><v>{value}</v></c>"#
                ));
            } else {
                sheet.push_str(&format!(r#"<c r="{reference}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,escape_cell(value)));
            }
        }
        sheet.push_str("</row>");
    }
    sheet.push_str(&format!(
        r#"</sheetData><autoFilter ref="A1:E{}"/></worksheet>"#,
        items.len() + 1
    ));
    let parts = [
        ("[Content_Types].xml",r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#.to_owned()),
        ("_rels/.rels",r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_owned()),
        ("xl/workbook.xml",format!(r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="字典数据" sheetId="1" r:id="rId1"/></sheets></workbook>"#)),
        ("xl/_rels/workbook.xml.rels",r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.to_owned()),
        ("xl/styles.xml",format!(r#"<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{NS}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="0" numFmtId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#)),
        ("xl/worksheets/sheet1.xml",sheet),
    ];
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, xml) in parts {
        zip.start_file(name, options)
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        zip.write_all(xml.as_bytes())?;
    }
    Ok(zip
        .finish()
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?
        .into_inner())
}
