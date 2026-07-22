# HCC OS

HCC OS is a human-governed control center embedded in Hermes Desktop and backed by the local command-center service.

## Endpoint ownership

HCC traffic is independent from the Hermes gateway connection. It defaults to `http://127.0.0.1:9200` and only changes through `HCC_API_URL`.

The optional `HCC_AUTH_TOKEN` applies only to command-center requests. Remote Hermes credentials are never forwarded to HCC endpoints.

## Native acceptance

The Windows acceptance harness opens every HCC workspace view through unique `HCC: <view>` UI Automation labels and rejects load errors or unavailable surfaces.

## Installer lifecycle

Release acceptance covers clean installation, upgrade from the latest prior official release, uninstall, rollback installation, launch, and cleanup.
