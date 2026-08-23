{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "e1150c2f58808005bfee01462375178010b8fa648d063ad27818c2076615dc78",
  "chainRoot": "e1150c2f58808005bfee01462375178010b8fa648d063ad27818c2076615dc78",
  "gitCommit": "e1faf34b",
  "timestamp": "2026-08-23T19:35:05.667Z",
  "seal": "4ba84be935d7d006f2988135c8cfbc4ea7e44b18bddce19bcd7f0369b4a8f578",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
