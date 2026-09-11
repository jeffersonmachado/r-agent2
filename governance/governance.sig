{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "00b535d6344b7b1e737a5a392f5c73b390f8a3f367f61ff19c1850f0fd085a8f",
  "chainRoot": "00b535d6344b7b1e737a5a392f5c73b390f8a3f367f61ff19c1850f0fd085a8f",
  "gitCommit": "82bc84a2f75966a3536f38f5f2a2d343b23d9642",
  "timestamp": "2026-09-11T17:09:01.547Z",
  "seal": "33ed09129f07abe653de305ff45ade06be45da2b30ee0cea791e230b51376e7d",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
