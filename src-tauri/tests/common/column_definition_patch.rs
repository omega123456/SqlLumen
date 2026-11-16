//! opensrv-mysql 0.7 always writes charset 33 and decimals 0; real servers send 63 for binary columns and 31 for plain FLOAT/DOUBLE.

use std::collections::HashMap;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{ready, Context, Poll};

use tokio::io::AsyncWrite;

const PACKET_HEADER_LENGTH: usize = 4;
const PAYLOAD_LENGTH_BYTES: usize = 3;
const COLUMN_DEFINITION_MARKER: [u8; 4] = [3, b'd', b'e', b'f'];
const STRINGS_BEFORE_NAME: usize = 4;
const FIXED_FIELDS_LENGTH_PREFIX: usize = 1;
const CHARACTER_SET_BYTES: usize = 2;
const MAX_LENGTH_BYTES: usize = 4;
const FLAGS_BYTES: usize = 2;
const TWO_BYTE_LENGTH_MARKER: u8 = 0xFC;
const THREE_BYTE_LENGTH_MARKER: u8 = 0xFD;
const EIGHT_BYTE_LENGTH_MARKER: u8 = 0xFE;
const SMALLEST_LENGTH_MARKER: u8 = 0xFB;

const BINARY_CHARACTER_SET: u16 = 63;
const NOT_FIXED_DECIMALS: u8 = 31;
const BINARY_FLAG: u16 = 128;
const FLOAT_TYPE: u8 = 4;
const DOUBLE_TYPE: u8 = 5;
const BINARY_CAPABLE_TYPES: [u8; 7] = [0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MockColumnOverride {
    pub character_set: Option<u16>,
    pub decimals: Option<u8>,
}

pub type ColumnOverrides = Arc<HashMap<&'static str, MockColumnOverride>>;

pub struct ColumnDefinitionPatch<W> {
    inner: W,
    overrides: ColumnOverrides,
    incomplete: Vec<u8>,
    outgoing: Vec<u8>,
}

impl<W: AsyncWrite + Unpin> ColumnDefinitionPatch<W> {
    pub fn new(inner: W, overrides: ColumnOverrides) -> Self {
        Self {
            inner,
            overrides,
            incomplete: Vec::new(),
            outgoing: Vec::new(),
        }
    }

    fn move_complete_packets_to_outgoing(&mut self) {
        while let Some(packet_length) = complete_packet_length(&self.incomplete) {
            let mut packet: Vec<u8> = self.incomplete.drain(..packet_length).collect();
            patch_column_definition(&mut packet[PACKET_HEADER_LENGTH..], &self.overrides);
            self.outgoing.extend_from_slice(&packet);
        }
    }

    fn poll_drain_outgoing(&mut self, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        while !self.outgoing.is_empty() {
            let written = ready!(self.poll_write_outgoing(context))?;
            self.outgoing.drain(..written);
        }
        Poll::Ready(Ok(()))
    }

    fn poll_write_outgoing(&mut self, context: &mut Context<'_>) -> Poll<io::Result<usize>> {
        let written = ready!(Pin::new(&mut self.inner).poll_write(context, &self.outgoing))?;
        if written == 0 {
            return Poll::Ready(Err(io::ErrorKind::WriteZero.into()));
        }
        Poll::Ready(Ok(written))
    }
}

impl<W: AsyncWrite + Unpin> AsyncWrite for ColumnDefinitionPatch<W> {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        let patch = self.get_mut();
        patch.incomplete.extend_from_slice(buffer);
        patch.move_complete_packets_to_outgoing();
        if let Poll::Ready(Err(error)) = patch.poll_drain_outgoing(context) {
            return Poll::Ready(Err(error));
        }
        Poll::Ready(Ok(buffer.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        let patch = self.get_mut();
        match patch.poll_drain_outgoing(context) {
            Poll::Ready(Ok(())) => Pin::new(&mut patch.inner).poll_flush(context),
            other => other,
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        let patch = self.get_mut();
        match patch.poll_drain_outgoing(context) {
            Poll::Ready(Ok(())) => Pin::new(&mut patch.inner).poll_shutdown(context),
            other => other,
        }
    }
}

fn complete_packet_length(buffered: &[u8]) -> Option<usize> {
    let header = buffered.get(..PAYLOAD_LENGTH_BYTES)?;
    let payload_length =
        usize::from(header[0]) | (usize::from(header[1]) << 8) | (usize::from(header[2]) << 16);
    let packet_length = PACKET_HEADER_LENGTH + payload_length;
    let is_complete = buffered.len() >= packet_length;
    is_complete.then_some(packet_length)
}

struct FixedFieldOffsets {
    character_set: usize,
    column_type: usize,
    flags: usize,
    decimals: usize,
}

fn patch_column_definition(
    payload: &mut [u8],
    overrides: &HashMap<&'static str, MockColumnOverride>,
) {
    if !payload.starts_with(&COLUMN_DEFINITION_MARKER) {
        return;
    }
    let Some((name, offsets)) = column_name_and_offsets(payload) else {
        return;
    };
    let explicit = overrides.get(name.as_str()).copied().unwrap_or_default();
    let character_set = explicit
        .character_set
        .unwrap_or_else(|| server_character_set(payload, &offsets));
    let decimals = explicit
        .decimals
        .unwrap_or_else(|| server_decimals(payload, &offsets));
    payload[offsets.character_set..offsets.character_set + CHARACTER_SET_BYTES]
        .copy_from_slice(&character_set.to_le_bytes());
    payload[offsets.decimals] = decimals;
}

fn server_character_set(payload: &[u8], offsets: &FixedFieldOffsets) -> u16 {
    let written = u16::from_le_bytes([
        payload[offsets.character_set],
        payload[offsets.character_set + 1],
    ]);
    let flags = u16::from_le_bytes([payload[offsets.flags], payload[offsets.flags + 1]]);
    let has_binary_flag = flags & BINARY_FLAG != 0;
    let can_hold_binary = BINARY_CAPABLE_TYPES.contains(&payload[offsets.column_type]);
    if has_binary_flag && can_hold_binary {
        return BINARY_CHARACTER_SET;
    }
    written
}

fn server_decimals(payload: &[u8], offsets: &FixedFieldOffsets) -> u8 {
    let written = payload[offsets.decimals];
    let is_floating_point = matches!(payload[offsets.column_type], FLOAT_TYPE | DOUBLE_TYPE);
    if is_floating_point && written == 0 {
        return NOT_FIXED_DECIMALS;
    }
    written
}

fn column_name_and_offsets(payload: &[u8]) -> Option<(String, FixedFieldOffsets)> {
    let mut position = 0;
    for _ in 0..STRINGS_BEFORE_NAME {
        position = skip_length_encoded_string(payload, position)?;
    }
    let (name_start, name_end) = length_encoded_string_bounds(payload, position)?;
    let name = String::from_utf8_lossy(&payload[name_start..name_end]).into_owned();
    position = skip_length_encoded_string(payload, name_end)?;
    let character_set = position + FIXED_FIELDS_LENGTH_PREFIX;
    let column_type = character_set + CHARACTER_SET_BYTES + MAX_LENGTH_BYTES;
    let flags = column_type + 1;
    let decimals = flags + FLAGS_BYTES;
    if decimals >= payload.len() {
        return None;
    }
    let offsets = FixedFieldOffsets {
        character_set,
        column_type,
        flags,
        decimals,
    };
    Some((name, offsets))
}

fn skip_length_encoded_string(payload: &[u8], position: usize) -> Option<usize> {
    length_encoded_string_bounds(payload, position).map(|(_, end)| end)
}

fn length_encoded_string_bounds(payload: &[u8], position: usize) -> Option<(usize, usize)> {
    let marker = *payload.get(position)?;
    let (length, prefix_length) = length_encoded_integer(payload, position, marker)?;
    let start = position + prefix_length;
    Some((start, start + length))
}

fn length_encoded_integer(payload: &[u8], position: usize, marker: u8) -> Option<(usize, usize)> {
    if marker < SMALLEST_LENGTH_MARKER {
        return Some((usize::from(marker), 1));
    }
    let byte_count = match marker {
        TWO_BYTE_LENGTH_MARKER => 2,
        THREE_BYTE_LENGTH_MARKER => 3,
        EIGHT_BYTE_LENGTH_MARKER => 8,
        _ => return None,
    };
    let bytes = payload.get(position + 1..position + 1 + byte_count)?;
    let length = bytes
        .iter()
        .rev()
        .fold(0usize, |value, byte| (value << 8) | usize::from(*byte));
    Some((length, 1 + byte_count))
}
