{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3ad141ca200a10ee7c137ec22c9423324a1521d3072b780409b82363eebfddc3",
  "chainRoot": "3ad141ca200a10ee7c137ec22c9423324a1521d3072b780409b82363eebfddc3",
  "gitCommit": "2c370178a198a2dd1807c976fd0046b445b08c99",
  "timestamp": "2026-09-27T02:17:44.561Z",
  "seal": "52d94285f2f98379dd3e20c6a27f3ebb1a8eb53d7ee52f3f01721384c820d109",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
