{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "39aa4b7f3fa2d4548a4e92525984e1f23ab0e377ba22172095c1abe2a567dbff",
  "chainRoot": "39aa4b7f3fa2d4548a4e92525984e1f23ab0e377ba22172095c1abe2a567dbff",
  "gitCommit": "37753e82510f375580b881551e55b6c4966fe48b",
  "timestamp": "2026-09-03T15:25:05.016Z",
  "seal": "dc0a68655202cf1a0611fe8d43da525fd4fec3a7c51f99df9271c075b2634406",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
