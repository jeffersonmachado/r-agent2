{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "67df264714bab069a36ce9a8e1e391ecd3e405068f73872b3d6d05b5f0691453",
  "chainRoot": "67df264714bab069a36ce9a8e1e391ecd3e405068f73872b3d6d05b5f0691453",
  "gitCommit": "c452dd8c06326f83025a7c5dd24584efc73872f4",
  "timestamp": "2026-09-20T19:51:35.487Z",
  "seal": "7f7803f627074d740ea9869554ac883fb140ab16a7726aac068ee75f63bcdb33",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
