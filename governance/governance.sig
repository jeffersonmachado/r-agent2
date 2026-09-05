{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "c106feca233d66d68760643bbcfd27412f1206dd630ad0eb11211cbc082ec93e",
  "chainRoot": "c106feca233d66d68760643bbcfd27412f1206dd630ad0eb11211cbc082ec93e",
  "gitCommit": "bf3569d5f2388c08e2260da1edf667413dbf7d8d",
  "timestamp": "2026-09-05T17:26:01.432Z",
  "seal": "e8ceefc0171692797cb52349aa4964ec09c56d4599afa26fe51d1aa994392a26",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
