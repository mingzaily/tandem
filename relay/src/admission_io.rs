use crate::protocol::MAX_HELLO;
use std::{
    io,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// Inspect admission frame headers before tungstenite can reserve their payload buffers.
/// After admission, tungstenite enforces the 4 MiB frame and message limits itself.
pub struct AdmissionIo<S> {
    inner: S,
    pub admitted: bool,
    header: [u8; 14],
    filled: usize,
    sent: usize,
    target: usize,
    payload: u64,
}

impl<S> AdmissionIo<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            admitted: false,
            header: [0; 14],
            filled: 0,
            sent: 0,
            target: 2,
            payload: 0,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for AdmissionIo<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.admitted || output.remaining() == 0 {
            return Pin::new(&mut this.inner).poll_read(cx, output);
        }
        if this.payload > 0 {
            let limit = output.remaining().min(this.payload as usize);
            let mut read = ReadBuf::new(output.initialize_unfilled_to(limit));
            std::task::ready!(Pin::new(&mut this.inner).poll_read(cx, &mut read))?;
            let length = read.filled().len();
            output.advance(length);
            this.payload -= length as u64;
            return Poll::Ready(Ok(()));
        }
        while this.filled < this.target {
            let mut read = ReadBuf::new(&mut this.header[this.filled..this.target]);
            std::task::ready!(Pin::new(&mut this.inner).poll_read(cx, &mut read))?;
            let length = read.filled().len();
            if length == 0 {
                return Poll::Ready(Ok(()));
            }
            this.filled += length;
            if this.filled == 2 {
                let extra = match this.header[1] & 0x7f {
                    126 => 2,
                    127 => 8,
                    _ => 0,
                };
                this.target = 2 + extra + if this.header[1] & 0x80 != 0 { 4 } else { 0 };
            }
        }
        let length = match this.header[1] & 0x7f {
            126 => u16::from_be_bytes([this.header[2], this.header[3]]) as u64,
            127 => u64::from_be_bytes(
                this.header[2..10]
                    .try_into()
                    .expect("extended length has eight bytes"),
            ),
            length => length as u64,
        };
        if length > MAX_HELLO as u64 {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "HELLO_TOO_LARGE",
            )));
        }
        let count = output.remaining().min(this.target - this.sent);
        output.put_slice(&this.header[this.sent..this.sent + count]);
        this.sent += count;
        if this.sent == this.target {
            this.filled = 0;
            this.sent = 0;
            this.target = 2;
            this.payload = length;
        }
        Poll::Ready(Ok(()))
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for AdmissionIo<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, bytes)
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn admission_rejects_a_header_without_waiting_for_the_payload() {
        let (client, server) = tokio::io::duplex(32);
        let mut gate = AdmissionIo::new(server);
        let mut client = client;
        client
            .write_all(&[0x81, 0xfe, 0x10, 0x01, 0, 0, 0, 0])
            .await
            .unwrap();
        let mut bytes = [0; 32];
        assert_eq!(
            gate.read(&mut bytes).await.unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
    }
    #[tokio::test]
    async fn admission_preserves_pipelined_frames_when_the_limit_changes() {
        let (mut client, server) = tokio::io::duplex(32);
        client
            .write_all(&[0x81, 0x81, 0, 0, 0, 0, b'a', 0x81, 0x81, 0, 0, 0, 0, b'b'])
            .await
            .unwrap();
        let mut gate = AdmissionIo::new(server);
        let mut first = [0; 7];
        gate.read_exact(&mut first).await.unwrap();
        gate.admitted = true;
        let mut second = [0; 7];
        gate.read_exact(&mut second).await.unwrap();
        assert_eq!(first[6], b'a');
        assert_eq!(second[6], b'b');
    }
}
