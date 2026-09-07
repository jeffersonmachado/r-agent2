{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "0ea5a2277af560e76009147b6b5a285de03dfcdc49b50d46fab44500d01b42dd",
  "chainRoot": "0ea5a2277af560e76009147b6b5a285de03dfcdc49b50d46fab44500d01b42dd",
  "gitCommit": "ec6ed4e143d5d44324cceb4d7eac51e3f9ed4032",
  "timestamp": "2026-09-07T17:15:16.928Z",
  "seal": "fae172abda484fa1ef7452b598a029c0d772054efe9ea2f9432f2c6020d51afa",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
