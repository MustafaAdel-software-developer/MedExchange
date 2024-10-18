/**
 * Self-check: array-key form unflatten (CreateOrder FormData shape).
 * Run: npx tsx src/common/unflatten-form.selfcheck.ts
 */
import { unflattenFormBody } from './unflatten-form';
import assert from 'assert';

const r = unflattenFormBody({
  OrderedEntityId: 'e1',
  'BillableItems[0].id': 'b1',
  'BillableItems[0].chargeAmount': '12.5',
  'BillableItems[1].id': 'b2',
  'BillableItems[1].units': '3',
  'RenderedLocations[0].locationId': 'l1',
  'RenderedLocations[0].isPreferredByPatient': 'true',
  'OrderDocumentsIds[0]': 'd1',
});

assert.strictEqual(r.orderedEntityId, 'e1');
assert.ok(Array.isArray(r.billableItems));
const items = r.billableItems as Array<Record<string, unknown>>;
assert.strictEqual(items[0].id, 'b1');
assert.strictEqual(items[0].chargeAmount, 12.5);
assert.strictEqual(items[1].id, 'b2');
assert.strictEqual(items[1].units, 3);
const locs = r.renderedLocations as Array<Record<string, unknown>>;
assert.strictEqual(locs[0].isPreferredByPatient, true);
assert.deepStrictEqual(r.orderDocumentsIds, ['d1']);

console.log('unflatten-form.selfcheck: ok');
