# Worker Contract

This document defines the TS-to-Python worker payload contract used by RemGo.

## Transport
- Internal backend-to-worker communication uses `stdio` JSON-RPC (`jsonrpc: "2.0"`).
- Supported worker methods:
1. `health`
2. `generate`
3. `progress`
4. `stop`
- Legacy worker HTTP mode remains only for temporary compatibility.

## Envelope
- Field: `fooocus_args_contract_version`
- Current value: `1`
- Field: `fooocus_args`
- Type: positional array
- Expected length: `152`

If `fooocus_args` is present, both sender and receiver must validate:
- contract version equality
- array length
- key field types

## Key Indexes (`fooocus_args`)
- `[0]` `boolean`: generate image grid
- `[1]` `string`: prompt
- `[2]` `string`: negative prompt
- `[3]` `string[]`: style selections
- `[4]` `string`: performance selection
- `[5]` `string`: aspect ratio
- `[6]` `number`: image number
- `[7]` `string`: output format
- `[8]` `number`: image seed
- `[9]` `boolean`: seed random
- `[10]` `number`: sharpness
- `[11]` `number`: guidance scale
- `[12]` `string`: base model name
- `[13]` `string`: refiner model name
- `[14]` `number`: refiner switch

## Compatibility Rule
- `fooocus_args` is required.
- Python worker rejects requests that omit `fooocus_args`.
- `fooocus_args` must pass contract version and shape validation.

## Change Management
- Any index/semantic change requires:
1. Increment `fooocus_args_contract_version`
2. Update this document
3. Update golden tests in `backend/src/tests`
