{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "d4d308e3df80432ebec7489ee2fb5d2595410f9cea82f789a748e3505a53b8d6",
  "chainRoot": "d4d308e3df80432ebec7489ee2fb5d2595410f9cea82f789a748e3505a53b8d6",
  "gitCommit": "3e82c7152fdb0adf5efb359e0e4f15b19c81afee",
  "timestamp": "2026-09-14T21:44:39.886Z",
  "seal": "e8a7640c030e19b68be6a370736864a1164d5e07e574038c620ee561f010b5c3",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
