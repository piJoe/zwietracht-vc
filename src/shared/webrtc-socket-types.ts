export interface WebRtcServerToClientEvents {}

export interface WebRtcClientToServerEvents {}

export interface WebRtcSocketData {}

export interface WebRtcSocketHandshakeAuth {
  userid: string; // TODO: we want to fetch the userid based on the token, maybe?
  token: string;
}
