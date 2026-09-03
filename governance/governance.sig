{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3e6a1a2e8a19873cd26278325714027b936267783957337d29133cd2693540ea",
  "chainRoot": "3e6a1a2e8a19873cd26278325714027b936267783957337d29133cd2693540ea",
  "gitCommit": "22ffaab0cafc781f329ca66eecf6764614d5a87a",
  "timestamp": "2026-09-03T16:51:21.597Z",
  "seal": "c70699e30c0a86290f8126cc1211944ac554160b3a572c9a6abafb4168b918b5",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
