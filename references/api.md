# DeBox API Notes

Reference source: https://docs.debox.pro/zh/category/apis--sdks

This file is a local implementation note for the skill. When it conflicts with the official DeBox docs, follow the official docs.

## Base URL

`https://open.debox.pro/openapi`

## Auth

The current skill sends `X-API-KEY`.

## Endpoints Used By This Skill

### `GET /group/info`

- Primary input: `group_invite_url`

### `GET /group/is_join`

- Skill sends both legacy and newer field names for compatibility:
- `walletAddress`
- `wallet_address`
- `url`
- `group_invite_url`
- `chain_id`

### `GET /user/info`

- `user_id`

### `GET /vote/info`

- Official docs now describe group-url-based access.
- The skill sends:
- `wallet_address`
- `walletAddress`
- `group_invite_url`
- `group_id` as a compatibility fallback
- `chain_id`

### `GET /lucky_draw/info`

- Official docs now describe group-url-based access.
- The skill sends:
- `wallet_address`
- `walletAddress`
- `group_invite_url`
- `group_id` as a compatibility fallback
- `chain_id`

### `GET /moment/praise_info`

- `wallet_address`
- `chain_id`

## Response Handling

The skill normalizes both of these patterns before making decisions:

- direct payloads like `{ is_join: true }`
- wrapped payloads like `{ code: 200, data: { is_join: true } }`

This matters for:

- membership checks
- `verify`
- vote counts
- lottery counts
- CLI print helpers
- `--json` automation output

## Rate Limit Strategy

- Batch verification is intentionally serial.
- Default delay is `650ms`, which stays below a conservative 100 RPM ceiling.
- Use `--delay-ms` or `defaultBatchDelayMs` if DeBox publishes a different limit for your application tier.

## Known Gaps

- DeBox docs and live API behavior may vary by app tier or endpoint version.
- The skill prefers the documented group URL flow, but still sends selected legacy fields to preserve compatibility.
