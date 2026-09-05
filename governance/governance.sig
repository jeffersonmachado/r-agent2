{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "3468f3f388760084e8a0b38b3a1040b6b064195ab23a4351e334ccee6ce871cf",
  "chainRoot": "3468f3f388760084e8a0b38b3a1040b6b064195ab23a4351e334ccee6ce871cf",
  "gitCommit": "aea8d1af313cba950128d06fefe62468ba0649d0",
  "timestamp": "2026-09-05T21:22:18.329Z",
  "seal": "9df4fc172c01d8bf877e2e0a90ee0832af900ab3810a85c3274c96192538abda",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
