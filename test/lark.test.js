import test from "node:test";
import assert from "node:assert/strict";
import { LarkClient } from "../src/lark.js";

class FakeLarkClient extends LarkClient {
  constructor(pages) {
    super({ root: ".", larkCliEntry: "unused", baseToken: "base" });
    this.pages = pages;
    this.calls = [];
  }

  runJson(args) {
    this.calls.push(args);
    const offset = Number(args[args.indexOf("--offset") + 1] || 0);
    return this.pages[offset];
  }
}

test("listRecords reads every page instead of silently stopping at 200 rows", () => {
  const client = new FakeLarkClient({
    0: { ok: true, data: { fields: ["唯一ID"], data: [["a"], ["b"]], record_id_list: ["rec_a", "rec_b"], has_more: true } },
    2: { ok: true, data: { fields: ["唯一ID"], data: [["c"]], record_id_list: ["rec_c"], has_more: false } }
  });

  const output = client.listRecords("table", ["唯一ID"], { pageSize: 2 });

  assert.deepEqual(output.data.data, [["a"], ["b"], ["c"]]);
  assert.deepEqual(output.data.record_id_list, ["rec_a", "rec_b", "rec_c"]);
  assert.equal(client.calls.length, 2);
});

test("findRecordByField applies an exact cloud-side filter", () => {
  const client = new FakeLarkClient({
    0: { ok: true, data: { fields: ["批次ID"], data: [["batch_1"]], record_id_list: ["rec_1"], has_more: false } }
  });

  const record = client.findRecordByField("table", "批次ID", "batch_1", ["处理状态"]);
  const call = client.calls[0];

  assert.equal(record.record_id, "rec_1");
  assert.equal(call.includes("--filter-json"), true);
  assert.equal(call[call.indexOf("--filter-json") + 1], JSON.stringify({
    logic: "and",
    conditions: [["批次ID", "==", "batch_1"]]
  }));
});

