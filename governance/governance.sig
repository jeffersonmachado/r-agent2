{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "afaf5ac0c211bec09e3dad4e402f57cd5b410272e399111b3bb1c851c637253b",
  "chainRoot": "afaf5ac0c211bec09e3dad4e402f57cd5b410272e399111b3bb1c851c637253b",
  "gitCommit": "e712b759cc6663d5a7bf73ce45181b8cfcaee1e8",
  "timestamp": "2026-09-06T08:36:42.017Z",
  "seal": "2eed3ee93276e8d03be63997405ca50b282fffb02ba0e90ffd12937b4e515e7f",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
