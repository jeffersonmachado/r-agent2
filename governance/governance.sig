{
  "signatureVersion": 2,
  "algorithm": "hmac-sha256",
  "keyDerivation": "hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)",
  "keyId": "fea81834859c0c61",
  "subject": "governance-chain",
  "sha256": "14d47f180ef05e60ecbb239beab349b5cbd451ae39af11a60c1334dbeaa02366",
  "chainRoot": "14d47f180ef05e60ecbb239beab349b5cbd451ae39af11a60c1334dbeaa02366",
  "gitCommit": "2a5a710af790a98366861299138f6c4dd1622d60",
  "timestamp": "2026-10-06T21:39:11.220Z",
  "seal": "ff6490cdf7d7a40eb5bda3e8f877cc96af4a89a04c21d8c03b6baa759bb43293",
  "governanceLevel": "LEVEL_4_IMMUTABLE",
  "verificationNote": "derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]",
  "extra": "links:10"
}
