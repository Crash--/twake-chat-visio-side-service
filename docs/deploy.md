# Deploying

The service is a Matrix application service with no public route. Synapse
authenticates the user, then relays `POST
/_matrix/client/v1/rtc/livekit/get_token` (MSC4195) to the service, with the
`hs_token` of the registration (MSC4512).

```mermaid
sequenceDiagram
    participant C as Twake Chat
    participant S as Synapse
    participant V as Visio side service
    C->>S: POST /_matrix/client/v1/rtc/livekit/get_token
    S->>V: same request, Bearer hs_token, X-Matrix-User-Identifier
    V-->>S: {jwt}
    S-->>C: {jwt}
```

Synapse also relays the federation twin of the route
(`/_matrix/federation/v1/rtc/livekit/...`, from other homeservers), and this
cannot be turned off. The service does not serve it.

## Image

`ghcr.io/linagora/twake-chat-visio-side-service`, tagged `latest` from `main`
and `vX.Y.Z` from each release. It runs as a non-root user and listens on
port 8080.

## Probes

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`, 503 while Postgres does not answer within
  2 seconds.

Every other request needs the `hs_token`.

## Environment

- `HS_TOKEN` (required): the `hs_token` of the registration.
- `DATABASE_URL` (required): the Postgres database, for example
  `postgres://visio:secret@postgresql:5432/visio`.
- `PORT`: 8080 by default.

## Postgres

A database of its own. The service creates its single table, `call_rooms`
(the Meet room of each call slot of a Matrix room), at startup, so its user
needs the right to create tables. It exits when the database cannot be reached
at startup. Several replicas can share the database.

## Synapse

Synapse 1.161 or later. Copy
[`registration.example.yaml`](../registration.example.yaml), fill in the two
tokens and the service URL in `io.element.msc4512.proxy_url`, and list the
file in `app_service_config_files`. Then, in `homeserver.yaml`:

```yaml
experimental_features:
  msc4143_enabled: true # /rtc/transports
  msc4502_enabled: true # is_joined for application services
  msc4512_enabled: true # relays get_token to the service
matrix_rtc:
  transports:
    - type: livekit
      url: wss://livekit.example.com # the LiveKit of Meet
```

- Synapse reads the registration at startup only: restart it after any
  change.
- The registration lets the `as_token` act as any local user (the `users`
  namespace is `@.*`). Keep it as secret as an admin token.
- Synapse reaches the service through its outbound proxy when `http_proxy` is
  set: add the service host to `no_proxy`.
