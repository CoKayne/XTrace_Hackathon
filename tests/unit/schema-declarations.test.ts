import assert from "node:assert/strict";
import test from "node:test";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { deals, scanRunSteps } from "../../db/schema";

const dialect = new PgDialect();

function checks(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((constraint) => ({
    name: constraint.name,
    definition: dialect.sqlToQuery(constraint.value).sql,
  }));
}

test("Deal status is declared only on Deals, never scan run steps", () => {
  assert.deepEqual(checks(scanRunSteps), []);
  assert.deepEqual(checks(deals), [{
    name: "deals_status_check",
    definition:
      `"deals"."status" in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')`,
  }]);
});
