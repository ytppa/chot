export type UserRole = 'user' | 'admin';

export type UserStatus = 'pending' | 'active' | 'rejected' | 'disabled';

export type ClientEventEnvelope<TPayload = unknown> = {
  id: string;
  type: string;
  payload: TPayload;
  ts?: string;
};

export type ServerEventEnvelope<TPayload = unknown> = {
  id?: string;
  type: string;
  payload: TPayload;
  ts: string;
};

export type PingClientEvent = ClientEventEnvelope<Record<string, never>> & {
  type: 'ping';
};

export type PongServerEvent = ServerEventEnvelope<{
  ok: true;
  receivedAt: string;
}> & {
  type: 'pong';
};
