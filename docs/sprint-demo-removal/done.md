# Demo Code Removal — Done

## PR
https://github.com/Xuefeng-Zhu/SignalVault/pull/1

## What was done
- All demo adapter implementations deleted (apify, box, insforge, model)
- `lib/demo/` directory deleted entirely
- Factory simplified to live-only (no selection logic)
- `resolveRunMode()` and related types removed from config
- Auth DEMO_MODE bypass removed
- Demo UI elements removed (MockUploadDialog, "Use demo data" button, simulated Box warning)
- AI chat demo knowledge base removed
- Fallback verdict inlined in judge.ts
- Test fixture `tests/fixtures/in-memory-insforge.ts` created as replacement
- All tests updated to use new fixture
- Demo-only tests deleted

## Stats
- 53 files changed
- ~714 insertions, ~4362 deletions (net -3648 lines)

## Verification
- `npx tsc --noEmit` ✅
- `npm run build` ✅

## Follow-up opportunities
1. Simplify `RunMode` type to just `"live"` (remove `"demo"` option from union)
2. Simplify `ScanWorkflowContext.mode` to just `"live"`
3. Remove `Workspace.isDemo` field if no longer needed in DB
4. Remove `simulated` fields from capture/upload types if never true
5. Re-add route-level tests with proper auth mocking (not DEMO_MODE bypass)
