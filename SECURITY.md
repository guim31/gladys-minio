# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **access key and secret key** of a MinIO user, stored by Gladys in the
  integration configuration (never written to `/data`, never logged). The
  secret key never leaves the container: it signs a short-lived bearer token
  (one hour) for each metrics request, sent only to the address configured;
  redirects are not followed. A user restricted to the `admin:Prometheus`
  permission is recommended: it cannot read or write any object;
- an option to accept a self-signed certificate (TLS without verification of
  the authority), off by default;
- `/data/minio-state.json`: the address of the server, the numbers of drives
  and nodes last seen offline, and whether the free space was under the
  threshold (no secret);
- network: HTTP(S) GET requests to the two metrics pages of MinIO, nothing
  else; no port is opened. The integration never writes to MinIO.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and MinIO itself.
