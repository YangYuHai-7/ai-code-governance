# Runtime assets

Runtime data is grouped by ownership and change semantics:

- `registries/` contains discoverable catalogs and routing data.
- `policies/` contains enforceable product policy baselines.
- `contracts/` contains versioned validation and acceptance contracts.

Code should reference assets through package-root-relative paths. Generated target-project paths remain part of the AICG compatibility contract and do not mirror this internal layout.
