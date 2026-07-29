import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import { GET } from "../../app/api/deals/route";

test("Deals API filters by and returns the synthetic decision reason", async () => {
  const response = await GET(new Request(
    "http://localhost/api/deals?q=broad%20travel-collaboration%20proposition",
  ));

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Array<{
      companyName: string;
      fixture?: { decisionReason: string };
    }>;
  };
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].companyName, "Fellowtrip");
  assert.match(payload.data[0].fixture?.decisionReason ?? "", /travel-collaboration/i);
});
