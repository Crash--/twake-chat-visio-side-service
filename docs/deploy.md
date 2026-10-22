# Deploying

The service is a Matrix application service with no public route. Synapse
authenticates the user, then relays `POST
/_matrix/client/v1/rtc/livekit/get_token` (MSC4195) to the service, with the
`hs_token` of the registration (MSC4512). The service checks the request,
then asks Meet for the LiveKit token, in the Meet room of the call slot.

```mermaid
sequenceDiagram
    participant C as Twake Chat
    participant S as Synapse
    participant V as Visio side service
    participant L as LDAP
    participant M as Meet
    C->>S: POST /_matrix/client/v1/rtc/livekit/get_token
    S->>V: same request, Bearer hs_token, X-Matrix-User-Identifier
    V->>S: is_joined, power levels, display name (as_token)
    V->>L: email and Twake instance of the user
    V->>M: Meet room of the slot (created once), then its livekit-token
    V-->>S: {jwt}
    S-->>C: {jwt}
```

The service refuses, before it asks Meet:

- a user who is not joined to the room (403 `M_FORBIDDEN`);
- an SFU other than `LIVEKIT_URL`, or the SFU of another homeserver (400
  `M_INVALID_PARAM`, 403 `M_FORBIDDEN`);
- a user without a single email in the directory (403 `M_FORBIDDEN`).

Meet refusing to act for the user (domain not allowed, no account) answers 403
`M_FORBIDDEN`. A failure of the homeserver, the directory, Postgres or Meet
answers 502, and so does a request still pending after 25 seconds. Moderators of
the room (power level 50 or more, or a creator from room version 12) join as
`administrator` of the Meet room, the others as `member`.

Synapse also relays the federation twin of the route
(`/_matrix/federation/v1/rtc/livekit/...`, from other homeservers), and this
cannot be turned off. The service answers it 404.

## Image

`ghcr.io/linagora/twake-chat-visio-side-service`, tagged `latest` from `main`
and `vX.Y.Z` from each release. It runs as a non-root user and listens on
port 8080. It logs one JSON line per refused token and per failure.

## Probes

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`, 503 while Postgres does not answer within
  2 seconds.

Every other request needs the `hs_token`.

## Environment

All required unless a default is given.

- `HS_TOKEN`, `AS_TOKEN`: the two tokens of the registration.
- `HOMESERVER_URL`: the client API of Synapse, for example
  `http://synapse:8008`.
- `LIVEKIT_URL`: the LiveKit of Meet, the `url` that `matrix_rtc.transports`
  of Synapse announces (below).
- `DATABASE_URL`: the Postgres database, for example
  `postgres://visio:secret@postgresql:5432/visio`.
- `MEET_URL`: Meet, for example `https://meet.example.com`.
- `MEET_CLIENT_ID`, `MEET_CLIENT_SECRET`: the application of the service in
  Meet.
- `MEET_SERVICE_ACCOUNT_EMAIL`: the owner of the Meet rooms of the calls.
- `LDAP_URL`, `LDAP_BASE`: the directory, and where its users are.
- `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`: a bind that may read `mail`,
  `twakeWorkspaceUrl` and `workspaceurl`, anonymous when unset. The password
  is required with a DN.
- `LDAP_UID_ATTRIBUTE`: the attribute that holds the Matrix localpart, `uid`
  by default.
- `PORT`: 8080 by default.

Every call to Synapse, the directory or Meet gives up after 5 seconds, and the
whole request after 25: Synapse gives it 30.

## Meet

- A `livekit-token/` route that takes the identity of MSC4195 with
  `matrix_user_id` and `matrix_member_id`. The route of
  [linto-ai/meet#6](https://github.com/linto-ai/meet/pull/6) at `e1502eb9`
  takes `@user:server:device` only: there, every token request answers 502.
- The external API on (`EXTERNAL_API_ENABLED`, `APPLICATION_ENABLED`).
- An application with the scopes `rooms:create` and `rooms:livekit_token`.
  When it has allowed domains, they must hold the domain of every user and of
  the service account.
- `APPLICATION_ALLOW_USER_CREATION`, so that a user who never signed in to
  Meet gets an account from their email.
- The route of `e1502eb9` ignores `twake_instance`. Until Meet stores it, Meet
  knows no Drive for a user who never signed in to it, so their recordings
  and transcripts are not delivered there.

## LDAP

One entry per Matrix user, found under `LDAP_BASE` by
`LDAP_UID_ATTRIBUTE=<localpart>`, with a single `mail`. `twakeWorkspaceUrl`
(or the older `workspaceurl`) goes to Meet as `twake_instance` when present.

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
      url: wss://livekit.example.com # LIVEKIT_URL
```

- Synapse reads the registration at startup only: restart it after any
  change.
- The registration lets the `as_token` act as any local user (the `users`
  namespace is `@.*`). Keep it as secret as an admin token.
- Synapse reaches the service through its outbound proxy when `http_proxy` is
  set: add the service host to `no_proxy`.
