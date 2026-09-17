{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "407e5f6e0109a483a975c264f9cfe700adde5f7fbf18c371d755eabdb323fd48",
  "chainRoot": "407e5f6e0109a483a975c264f9cfe700adde5f7fbf18c371d755eabdb323fd48",
  "gitCommit": "869fbc0defa17130a01674e8c36157df8cd723bd",
  "timestamp": "2026-09-17T17:46:28.974Z",
  "seal": "1b5e34cc3b3b9d53355fb29279298786ab877a9a91a182ab0804f044aba04fd9",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
