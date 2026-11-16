//! Localhost listeners for connection-failure tests.

use tokio::net::{TcpListener, TcpStream};

pub struct SilentListener {
    pub port: u16,
    accept_task: tokio::task::JoinHandle<()>,
}

impl SilentListener {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("should bind silent listener");
        let port = listener
            .local_addr()
            .expect("should read silent listener address")
            .port();
        let accept_task = tokio::spawn(hold_accepted_connections(listener));
        Self { port, accept_task }
    }
}

async fn hold_accepted_connections(listener: TcpListener) {
    let mut held_connections: Vec<TcpStream> = Vec::new();
    while let Ok((stream, _)) = listener.accept().await {
        held_connections.push(stream);
    }
}

impl Drop for SilentListener {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

pub fn closed_port() -> u16 {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("should bind an ephemeral port");
    listener
        .local_addr()
        .expect("should read ephemeral port address")
        .port()
}
