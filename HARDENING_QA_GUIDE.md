# Hardening Features - Quick Reference

## For Operators & QA

### Testing Tag Generation with Custom Keywords

**Endpoint**: `POST /api/support/tags/suggest`

**Example - Sales Keywords**:
```bash
curl -X POST http://localhost:3001/api/support/tags/suggest \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "upgrade urgente do plano de vendas",
    "tenantKeywords": {
      "sales": ["upgrade", "vendas", "plano"],
      "cancel": ["cancelar"],
      "billing": []
    }
  }'
```

**Expected**: Tags should include `intent:sales` based on custom keywords.

### Testing Entity Extraction Debug

**Endpoint**: `POST /debug/entities/extract`

**Example - Extract Multiple Entity Types**:
```bash
curl -X POST http://localhost:3001/debug/entities/extract \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Boleto vencido em 25/12/2024, valor R$ 150,00. Email: cliente@example.com, Fone: (11) 98765-4321",
    "tenant_id": "your-tenant-id",
    "channel": "whatsapp",
    "tenantKeywords": ["boleto", "vencido"]
  }'
```

**Expected**: 
- Extracts email, phone, money, date entities
- Enforces max 20 values per entity type
- Returns only one "boleto" match (deduplication)

### Testing Quick Reply Limit Enforcement

**Endpoint**: `POST /quick-replies/search`

**Example - Excessive Limit (Should Be Clamped)**:
```bash
curl -X POST http://localhost:3001/quick-replies/search \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "context": "como fazer upgrade do plano",
    "limit": 999
  }'
```

**Expected**: Limit clamped to max 20, actual results limited to safe range.

---

## Known Behaviors

### 1. Word-Boundary Keyword Matching
- ✅ "upgrade" matches in "upgrade do plano"
- ❌ "pro" does NOT match in "profile" (word boundary enforced)
- ✅ "vendas" matches in "plano de vendas"

### 2. Entity Extraction Limits
```
Max 20 values per entity type:
- email: max 20
- phone: max 20
- money: max 20
- cpf/cnpj: max 20
- order_id/ticket_id/etc: max 20
```

### 3. Quick Reply Limit Ranges
```
Input Limit → Clamped To:
1-20 → Used as-is (safe)
0 → 5 (default)
21 → 20 (max clamped)
999 → 20 (max clamped)
-1 → 1 (min clamped)
```

### 4. Tenant Isolation
- Debug endpoint requires your tenant_id
- Cross-tenant requests return `403 Forbidden`
- This is **intentional** for data privacy

---

## Common Issues & Solutions

### Issue: "tenant_mismatch" error on debug endpoint
**Cause**: You provided a different tenant_id than your authenticated user's tenant
**Solution**: Use the correct tenant_id for your authenticated user

### Issue: No results from tag suggestion
**Possible Causes**:
1. No keywords match the input text
2. Keywords provided aren't matching with word boundaries
**Solution**: Check text contains word-bounded matches (see examples above)

### Issue: Quick reply search returns 0 results
**Possible Causes**:
1. No quick replies configured for that context
2. Correct - that's expected if none match
**Solution**: This is normal behavior

---

## Files to Monitor

For alerts/monitoring on these hardening features:

1. **`api/support/tagRules.js`**
   - Monitor: Tag suggestion accuracy
   - Alert on: Frequent `intent:unknown` tags

2. **`api/entities/entityExtractor.js`**
   - Monitor: Entity extraction limit hits
   - Alert on: Repeated max-20-value scenarios

3. **`api/services/quickRepliesService.js`**
   - Monitor: Limit clamping frequency
   - Alert on: Excessive limit values (>50) in requests

4. **`api/server.js`**
   - Monitor: Debug endpoint access logs
   - Alert on: Failed tenant_mismatch attempts (potential scanning)

---

## Deployment & Version

**Current Version**: 0.1.2

**Deployed Features**:
- ✅ Word-boundary keyword matching
- ✅ Per-key entity limits (max 20)
- ✅ Quick reply limit clamping [1-20]
- ✅ Debug entity extraction endpoint
- ✅ Tenant isolation enforcement
- ✅ Metadata propagation in message flow

**Last Updated**: 2026-02-26

---

## Emergency Procedures

### To Disable Limit Clamping (NOT RECOMMENDED)
Not recommended. Limits exist for security. Contact DevOps if disabled.

### To Revert Tag Generation Changes
Edit `api/support/tagRules.js` and remove word-boundary regex from `keywordMatchesText()`.

### To Reset Entity Limits
Set `DEFAULT_MAX_VALUES_PER_KEY` in `api/entities/entityExtractor.js` to higher value (e.g., 100).

---

## Testing Checklist

- [ ] Tag suggestion returns tags with custom tenantKeywords
- [ ] Entity extraction respects 20-value-per-key limit
- [ ] Quick reply search clamps limit to max 20
- [ ] Debug endpoint denies cross-tenant access
- [ ] Word-boundary matching works (no false positives)
- [ ] Tenant mismatch error for invalid tenants
- [ ] All API endpoints respond with 200 OK for valid requests

---

## Support

For issues or questions about these features:

1. Check `HARDENING_IMPLEMENTATION_FINAL.md` for detailed technical info
2. Check `SMOKE_TEST_REPORT.md` for validation results
3. Review test files in `api/*/__tests__/` for expected behavior
4. Contact the development team with specific error messages
