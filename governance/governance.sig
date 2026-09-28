{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "422b06bffc99b80e8c56a21f4d37fcd99f715da81a5305b32a1be31722ba8bf9",
  "chainRoot": "422b06bffc99b80e8c56a21f4d37fcd99f715da81a5305b32a1be31722ba8bf9",
  "gitCommit": "eec1e0b9cc8483fdc11d70b0c36693e705617029",
  "timestamp": "2026-09-28T14:30:18.445Z",
  "seal": "d616dfda334a8d3ecbb09cab7f34c1b84355f0e469cf9619259a036b468d0dd7",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
