declare module 'ws' {
  type RawData = string | ArrayBuffer | ArrayBufferView | Buffer | Buffer[];

  interface WebSocketLike {
    close(): void;
    send(data: string): void;
    addEventListener(type: 'error', listener: () => void): void;
    addEventListener(type: 'message', listener: (event: { data: RawData }) => void): void;
  }

  const WebSocket: {
    new (address: string): WebSocketLike;
  };

  export default WebSocket;
  export type { RawData };
}
