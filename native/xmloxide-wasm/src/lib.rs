#![allow(static_mut_refs)]

use serde_json::{json, Map, Value};
use std::mem;
use std::slice;
use xmloxide::html::parse_html;
use xmloxide::parser::{parse_str_with_options, ParseOptions};
use xmloxide::tree::NodeKind;
use xmloxide::{Document, NodeId};

static mut LAST_RESULT: Option<Vec<u8>> = None;

#[no_mangle]
pub extern "C" fn metidos_xmloxide_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn metidos_xmloxide_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
pub unsafe extern "C" fn metidos_xmloxide_result_ptr() -> *const u8 {
    match &LAST_RESULT {
        Some(result) => result.as_ptr(),
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn metidos_xmloxide_result_len() -> usize {
    match &LAST_RESULT {
        Some(result) => result.len(),
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn metidos_xmloxide_result_free() {
    LAST_RESULT = None;
}

#[no_mangle]
pub unsafe extern "C" fn metidos_xmloxide_parse(
    ptr: *const u8,
    len: usize,
    loose: u32,
    lowercase_names: u32,
    trim_text: u32,
    max_nodes: u32,
    max_depth: u32,
    max_text_chars: u32,
) -> i32 {
    let input = match std::str::from_utf8(slice::from_raw_parts(ptr, len)) {
        Ok(value) => value,
        Err(error) => {
            set_result(error_response(format!("XML input must be UTF-8: {error}")));
            return 0;
        }
    };

    let parsed = if loose != 0 {
        parse_loose(input)
    } else {
        parse_str_with_options(input, &ParseOptions::default()).map_err(|error| error.to_string())
    };

    match parsed {
        Ok(document) => match document.root_element() {
            Some(root) => match element_to_json(
                &document,
                root,
                ConvertOptions {
                    lowercase_names: lowercase_names != 0,
                    trim_text: trim_text != 0,
                    max_nodes: max_nodes as usize,
                    max_depth: max_depth as usize,
                    max_text_chars: max_text_chars as usize,
                },
            ) {
                Ok(root_json) => {
                    let diagnostics = document
                        .diagnostics
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>();
                    set_result(
                        json!({ "ok": true, "root": root_json, "diagnostics": diagnostics })
                            .to_string(),
                    );
                    1
                }
                Err(error) => {
                    set_result(error_response(error));
                    0
                }
            },
            None => {
                set_result(error_response("XML document must contain a root element."));
                0
            }
        },
        Err(error) => {
            set_result(error_response(error));
            0
        }
    }
}

fn parse_loose(input: &str) -> Result<Document, String> {
    let repaired = repair_loose_xml(input);
    let options = ParseOptions::default().recover(true);
    match parse_str_with_options(&repaired, &options) {
        Ok(document) => Ok(document),
        Err(xml_error) => parse_html(&repaired).map_err(|html_error| {
            format!("recovering XML parse failed: {xml_error}; HTML recovery failed: {html_error}")
        }),
    }
}

fn repair_loose_xml(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(active_quote) = quote {
            if ch == '<' {
                output.push_str("&lt;");
                for nested in chars.by_ref() {
                    match nested {
                        '<' => output.push_str("&lt;"),
                        '>' => {
                            output.push_str("&gt;");
                            break;
                        }
                        '&' => output.push_str("&amp;"),
                        '"' => output.push_str("&quot;"),
                        '\'' => output.push_str("&apos;"),
                        _ => output.push(nested),
                    }
                }
                continue;
            }
            if ch == '>' {
                output.push_str("&gt;");
                continue;
            }
            if ch == '&' && !starts_entity(&mut chars) {
                output.push_str("&amp;");
                continue;
            }
            if ch == active_quote {
                quote = None;
            }
            output.push(ch);
            continue;
        }

        match ch {
            '<' => {
                in_tag = true;
                output.push(ch);
            }
            '>' => {
                in_tag = false;
                output.push(ch);
            }
            '"' | '\'' if in_tag => {
                quote = Some(ch);
                output.push(ch);
            }
            '&' if !starts_entity(&mut chars) => output.push_str("&amp;"),
            _ => output.push(ch),
        }
    }
    output
}

fn starts_entity<I>(chars: &mut std::iter::Peekable<I>) -> bool
where
    I: Iterator<Item = char> + Clone,
{
    let mut lookahead = chars.clone();
    let mut name = String::new();
    for _ in 0..32 {
        let Some(ch) = lookahead.next() else {
            return false;
        };
        if ch == ';' {
            return is_xml_entity(&name);
        }
        if ch.is_whitespace() || ch == '<' || ch == '&' {
            return false;
        }
        name.push(ch);
    }
    false
}

fn is_xml_entity(name: &str) -> bool {
    matches!(name, "amp" | "lt" | "gt" | "apos" | "quot")
        || name.strip_prefix('#').is_some_and(|digits| {
            !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit())
        })
        || name
            .strip_prefix("#x")
            .is_some_and(|hex| !hex.is_empty() && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
}

#[derive(Clone, Copy)]
struct ConvertOptions {
    lowercase_names: bool,
    trim_text: bool,
    max_nodes: usize,
    max_depth: usize,
    max_text_chars: usize,
}

struct ConvertState {
    nodes: usize,
    text_chars: usize,
}

fn element_to_json(
    document: &Document,
    root: NodeId,
    options: ConvertOptions,
) -> Result<Value, String> {
    let mut state = ConvertState {
        nodes: 0,
        text_chars: 0,
    };
    node_to_json(document, root, 1, options, &mut state)
}

fn node_to_json(
    document: &Document,
    node_id: NodeId,
    depth: usize,
    options: ConvertOptions,
    state: &mut ConvertState,
) -> Result<Value, String> {
    if depth > options.max_depth {
        return Err(format!(
            "XML document exceeded depth {}.",
            options.max_depth
        ));
    }
    state.nodes += 1;
    if state.nodes > options.max_nodes {
        return Err(format!(
            "XML document exceeded {} elements.",
            options.max_nodes
        ));
    }

    let node = document.node(node_id);
    let NodeKind::Element {
        name, attributes, ..
    } = &node.kind
    else {
        return Err("XML root must be an element.".to_string());
    };

    let mut attrs = Map::new();
    for attr in attributes {
        attrs.insert(
            normalize_name(&attr.name, options.lowercase_names),
            json!(attr.value),
        );
    }

    let mut text = String::new();
    let mut children = Vec::new();
    for child_id in document.children(node_id) {
        match &document.node(child_id).kind {
            NodeKind::Element { .. } => {
                children.push(node_to_json(document, child_id, depth + 1, options, state)?);
            }
            NodeKind::Text { content } | NodeKind::CData { content } => {
                let value = if options.trim_text {
                    content.trim()
                } else {
                    content.as_str()
                };
                if !value.is_empty() {
                    text.push_str(value);
                }
            }
            NodeKind::EntityRef {
                value: Some(value), ..
            } => {
                text.push_str(value);
            }
            _ => {}
        }
    }
    state.text_chars += text.chars().count();
    if state.text_chars > options.max_text_chars {
        return Err(format!(
            "XML element text exceeded {} characters.",
            options.max_text_chars
        ));
    }

    Ok(json!({
        "attributes": Value::Object(attrs),
        "children": children,
        "name": normalize_name(name, options.lowercase_names),
        "text": text,
        "type": "element"
    }))
}

fn normalize_name(name: &str, lowercase: bool) -> String {
    if lowercase {
        name.to_lowercase()
    } else {
        name.to_string()
    }
}

fn set_result(value: String) {
    unsafe {
        LAST_RESULT = Some(value.into_bytes());
    }
}

fn error_response(message: impl Into<String>) -> String {
    json!({ "ok": false, "error": message.into() }).to_string()
}
