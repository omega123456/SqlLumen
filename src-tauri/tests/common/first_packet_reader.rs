//! Delivers the client's first MySQL packet to the fake server in a read of its own.

use std::io;
use std::pin::Pin;
use std::task::{ready, Context, Poll};
use tokio::io::{AsyncRead, ReadBuf};

const PACKET_HEADER_LENGTH: usize = 4;

enum FirstPacketProgress {
    Header { received: Vec<u8> },
    Payload { remaining: usize },
    Done,
}

impl FirstPacketProgress {
    fn read_limit(&self) -> Option<usize> {
        match self {
            Self::Header { received } => Some(PACKET_HEADER_LENGTH - received.len()),
            Self::Payload { remaining } => Some(*remaining),
            Self::Done => None,
        }
    }

    fn after_reading(self, bytes: &[u8]) -> Self {
        match self {
            Self::Header { mut received } => {
                received.extend_from_slice(bytes);
                header_progress(received)
            }
            Self::Payload { remaining } => payload_progress(remaining - bytes.len()),
            Self::Done => Self::Done,
        }
    }
}

fn header_progress(received: Vec<u8>) -> FirstPacketProgress {
    if received.len() < PACKET_HEADER_LENGTH {
        return FirstPacketProgress::Header { received };
    }
    let payload_length = u32::from_le_bytes([received[0], received[1], received[2], 0]);
    payload_progress(usize::try_from(payload_length).expect("packet length fits in usize"))
}

fn payload_progress(remaining: usize) -> FirstPacketProgress {
    if remaining == 0 {
        return FirstPacketProgress::Done;
    }
    FirstPacketProgress::Payload { remaining }
}

/// opensrv 0.7's `PacketReader` frees a buffer its returned packet still borrows if one read holds two packets.
pub struct FirstPacketReader<R> {
    inner: R,
    progress: FirstPacketProgress,
}

impl<R> FirstPacketReader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            progress: FirstPacketProgress::Header {
                received: Vec::new(),
            },
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for FirstPacketReader<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let reader = self.get_mut();
        let Some(limit) = reader.progress.read_limit() else {
            return Pin::new(&mut reader.inner).poll_read(context, buf);
        };
        let mut first_packet_bytes = vec![0; limit.min(buf.remaining())];
        let mut limited = ReadBuf::new(&mut first_packet_bytes);
        ready!(Pin::new(&mut reader.inner).poll_read(context, &mut limited))?;
        let progress = std::mem::replace(&mut reader.progress, FirstPacketProgress::Done);
        reader.progress = progress.after_reading(limited.filled());
        buf.put_slice(limited.filled());
        Poll::Ready(Ok(()))
    }
}
